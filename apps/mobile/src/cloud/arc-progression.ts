import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProgressState, Settings } from '@hybrid/engine';
import type { ProgressionProposal } from '../lib/progression';
import { storage } from '../store/storage';

/*
 * The ARC progression loop, on the phone: PUSH the athlete's locally-computed
 * progression proposals so a coach can review them, and PULL + APPLY the
 * coach's decisions on the next sync.
 *
 * DELIBERATELY DUPLICATED from apps/web/src/cloud/arc-athlete-sync.ts
 * (`pushProgressionProposals`, `applyServerProgression`,
 * `applyPendingArcDecisions`) rather than imported or extracted — the same
 * call arc-assignments.ts already made and records: apps/mobile may not
 * import from apps/web, and the web original is built on browser globals
 * (`localStorage`) this file cannot use. The processed-receipt bookkeeping
 * goes through the engine's MMKV-backed Storage port instead. The pure parts
 * (`structurallyEqual`, `applyServerProgression`) are byte-for-byte the web's
 * and are the strongest candidates for a shared package — recorded as
 * follow-up, not done now.
 *
 * The RULES are the web file's and must stay identical, because both clients
 * apply into the same athlete's `Settings.conProgress`:
 *
 *   - EVERYTHING HERE IS BEST-EFFORT AND SILENT ON FAILURE. An athlete with
 *     no coach — the overwhelming majority — has no organisation membership,
 *     every call refuses, and that must never surface as an error banner on
 *     the training sync it rides alongside.
 *   - A coach's approval is REVALIDATED against the athlete's CURRENT local
 *     baseline before it applies (the athlete may have trained again since
 *     the push). A mismatch is left alone, not overwritten.
 *   - A receipt is processed at most once, tracked on disk; and the apply is
 *     idempotent against losing that bookkeeping, because a re-evaluated
 *     receipt whose `before` no longer matches simply has nothing to apply.
 */

const PROCESSED_RECEIPTS_KEY = 'hybrid-arc-processed-receipts-v1';

function loadProcessedReceipts(): Set<string> {
  try {
    const raw = JSON.parse(storage.getItem(PROCESSED_RECEIPTS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveProcessedReceipts(ids: Set<string>): void {
  try {
    // Unbounded growth is a real risk over a long-lived account; capped to the
    // most recent 500 so this never becomes the reason storage fills up.
    storage.setItem(PROCESSED_RECEIPTS_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* Worst case: a receipt already applied gets re-evaluated next sync.
       `applyServerProgression` below is idempotent against that — a proposal
       already applied no longer matches its own `before`, so nothing is
       applied twice. */
  }
}

/** Test seam, same reason arc-assignments has one: the storage port under
 *  jest is the in-memory shim and a suite has to be able to put it back. */
export function resetArcProgressionForTests(): void {
  try {
    storage.removeItem(PROCESSED_RECEIPTS_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Structural equality for the small flat shape this file compares
 * (`ProgressState`) — NOT `JSON.stringify`. A value pushed locally and read
 * back through Postgres jsonb does not preserve key order (jsonb normalises
 * it), so a naive `JSON.stringify` comparison would call a freshly-matching
 * value "stale" purely because `{level,miss}` came back as `{miss,level}`,
 * and every coach-approved progression would silently fail to apply. This
 * compares fields, not serialised text.
 */
export function structurallyEqual(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/**
 * The core of the apply step, pulled out as a pure function so the
 * revalidate-then-apply decision is testable without a network or a
 * component. Returns the updated Settings, or null when the proposal's
 * `before` no longer matches the athlete's current baseline — the same
 * "stale, refuse rather than overwrite" rule `proposalIsStale` enforces for
 * the local-only flow, applied here across the network boundary.
 *
 * `domain` still admits `'strength'` because the backend was NOT changed
 * (CLAUDE.md) — a `progression_proposal_snapshots` row written before the
 * strength engine's deletion can still say `domain: 'strength'`, and this
 * function is read from live Supabase rows, not a type it controls. There is
 * no `Settings.liftProgress` to write any more, so a strength row is refused
 * exactly like a stale one: nothing local to apply it to, nothing changed.
 */
export function applyServerProgression(
  domain: 'strength' | 'conditioning',
  clientKey: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  settings: Settings,
): Settings | null {
  if (domain === 'strength') return null;
  const current = (settings.conProgress?.[clientKey] ?? { level: 0, miss: 0 }) as unknown as Record<string, unknown>;
  if (!structurallyEqual(current, before ?? { level: 0, miss: 0 })) return null;
  return { ...settings, conProgress: { ...settings.conProgress, [clientKey]: after as unknown as ProgressState } };
}

interface ReceiptRow {
  id: string;
  organization_id: string;
  athlete_user_id: string;
  decision_id: string;
}
interface DecisionRow {
  id: string;
  kind: string;
  payload: { proposal_id?: string };
}
interface SnapshotRow {
  id: string;
  domain: 'strength' | 'conditioning';
  client_key: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

export interface ApplyDecisionsResult {
  applied: number;
  /** A coach-approved change whose `before` no longer matched — real, and
   *  worth a human eventually seeing, not silently swallowed. */
  stale: number;
}

/** Best-effort. An athlete with no coach has no org, every call refuses, and
 *  that must never surface as an error on a screen unrelated to coaching. */
export async function pushProgressionProposals(client: SupabaseClient, orgId: string, proposals: readonly ProgressionProposal[]): Promise<void> {
  for (const proposal of proposals) {
    try {
      await client.rpc('push_progression_proposal', {
        p_organization_id: orgId,
        p_domain: proposal.domain,
        p_subject: proposal.subject,
        p_client_key: proposal.key,
        p_before: proposal.before,
        p_after: proposal.after,
        p_confidence: proposal.confidence,
        p_hard: proposal.direction === 'review',
        p_direction: proposal.direction,
        p_source_at: new Date(proposal.sourceAt).toISOString(),
      });
    } catch {
      /* Best-effort — the local ledger this proposal already lives in is the
         source of truth regardless of whether the push succeeded. */
    }
  }
}

/**
 * Pull unprocessed decision receipts and apply any progression approvals
 * whose `before` still matches. Returns a settings PATCH to fold into the
 * store (or null if nothing changed) plus counts for a caller that wants to
 * say something about it — this function does not itself touch `useDb()`,
 * keeping it callable from SyncProvider's reconcile rather than requiring a
 * hook.
 */
export async function applyPendingArcDecisions(
  client: SupabaseClient,
  userId: string,
  settings: Settings,
): Promise<{ settings: Settings | null; result: ApplyDecisionsResult }> {
  const processed = loadProcessedReceipts();
  const result: ApplyDecisionsResult = { applied: 0, stale: 0 };

  const { data: receipts, error } = await client
    .from('decision_receipts')
    .select('id, organization_id, athlete_user_id, decision_id')
    .eq('athlete_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error || !receipts?.length) return { settings: null, result };

  const unprocessed = (receipts as ReceiptRow[]).filter((r) => !processed.has(r.id));
  if (!unprocessed.length) return { settings: null, result };

  let working = settings;
  let changed = false;

  for (const receipt of unprocessed) {
    processed.add(receipt.id);

    const { data: decision } = await client
      .from('coach_decisions')
      .select('id, kind, payload')
      .eq('id', receipt.decision_id)
      .maybeSingle();
    const decisionRow = decision as DecisionRow | null;
    if (!decisionRow || decisionRow.kind !== 'progression_approved') continue;

    const proposalId = decisionRow.payload?.proposal_id;
    if (!proposalId) continue;

    const { data: snapshot } = await client
      .from('progression_proposal_snapshots')
      .select('id, domain, client_key, before, after')
      .eq('id', proposalId)
      .maybeSingle();
    const snapshotRow = snapshot as SnapshotRow | null;
    if (!snapshotRow) continue;

    const applied = applyServerProgression(snapshotRow.domain, snapshotRow.client_key, snapshotRow.before, snapshotRow.after, working);
    if (applied) {
      working = applied;
      changed = true;
      result.applied += 1;
    } else {
      result.stale += 1;
    }
  }

  saveProcessedReceipts(processed);
  return { settings: changed ? working : null, result };
}
