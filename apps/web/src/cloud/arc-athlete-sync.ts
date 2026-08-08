import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiftState, ProgressState, Settings } from '@hybrid/engine';
import type { ProgressionProposal } from '../coach/progression';
import type { TrendSeries, HardBudget } from '../coach/trends';

/*
 * The BACKEND -> ATHLETE half of the ARC loop.
 *
 * Everything built earlier today (supabase/migrations/20260808_arc_*.sql,
 * apps/web/src/cloud/coach-repository.ts) is the COACH -> BACKEND half: a
 * coach approves a proposal or publishes a workout, and a row lands in
 * Supabase. Nothing pulled it back until this file. It closes three loops:
 *
 *   1. PUSH — the athlete's device has always computed progression proposals
 *      and trend series locally (progression.ts, trends.ts). This adds a
 *      best-effort copy to the backend so a coach can review them, without
 *      changing anything about how they already work locally.
 *   2. PULL + APPLY — a coach's decision on a pushed proposal writes a
 *      receipt. This reads it, REVALIDATES the proposal's `before` value
 *      against the athlete's CURRENT local baseline (the athlete may have
 *      trained again since the push), and only then applies it through the
 *      same `applyApprovedProposal`-shaped mutation the local self-coach
 *      flow already uses. A mismatch is left alone, not overwritten.
 *   3. Assignment accept/decline — thin RPC callers.
 *
 * EVERYTHING HERE IS BEST-EFFORT AND SILENT ON FAILURE, deliberately. An
 * athlete with no coach (the overwhelming majority of local/self-coach
 * usage) has no organisation membership at all, and every one of these
 * calls is expected to refuse for them — that must never surface as an
 * error banner on a screen that has nothing to do with coaching. Only the
 * pull+apply path's OWN correctness (never silently dropping a real
 * decision, never double-applying, never overwriting a fresher local value)
 * is asserted by the tests in this file; the network calls themselves are
 * exercised by `checks/migrations-apply.mjs` against the real RPCs.
 */

const PROCESSED_RECEIPTS_KEY = 'hybrid-arc-processed-receipts-v1';
const ORG_CACHE_KEY = 'hybrid-arc-my-org-v1';

function loadProcessedReceipts(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(PROCESSED_RECEIPTS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveProcessedReceipts(ids: Set<string>): void {
  try {
    // Unbounded growth is a real risk over a long-lived account; capped to the
    // most recent 500 so this never becomes the reason localStorage fills up.
    localStorage.setItem(PROCESSED_RECEIPTS_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* Worst case: a receipt already applied gets re-evaluated next sync.
       `applyServerProgression` below is idempotent against that — a receipt
       whose proposal is no longer 'pending' server-side simply has nothing
       left to apply. */
  }
}

/**
 * Structural equality for the two small flat shapes this file compares
 * (`LiftState`, `ProgressState`) — NOT `JSON.stringify`. A value pushed
 * locally and read back through Postgres jsonb does not preserve key order
 * (jsonb normalises it), so a naive `JSON.stringify` comparison would call a
 * freshly-matching value "stale" purely because `{kg,at,reps}` came back as
 * `{at,kg,reps}`, and every coach-approved progression would silently fail
 * to apply. This compares fields, not serialised text.
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
 */
export function applyServerProgression(
  domain: 'strength' | 'conditioning',
  clientKey: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  settings: Settings,
): Settings | null {
  if (domain === 'strength') {
    const current = settings.liftProgress?.[clientKey] ?? null;
    if (!structurallyEqual(current as Record<string, unknown> | null, before)) return null;
    return { ...settings, liftProgress: { ...settings.liftProgress, [clientKey]: after as unknown as LiftState } };
  }
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

/**
 * The athlete's own organisation membership, or null. Cached in
 * `sessionStorage` (not `localStorage`: this is allowed to go stale across
 * app restarts, since a fresh session refetches it) purely so an account
 * with no coach — the common case — does not re-run this query on every
 * sync tick.
 */
export async function getMyArcOrgId(client: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const cached = sessionStorage.getItem(ORG_CACHE_KEY);
    if (cached) return cached === 'none' ? null : cached;
  } catch { /* fall through to a live query */ }

  const { data, error } = await client
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('role', 'athlete')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  const orgId = error || !data ? null : (data as { organization_id: string }).organization_id;
  try { sessionStorage.setItem(ORG_CACHE_KEY, orgId ?? 'none'); } catch { /* non-fatal */ }
  return orgId;
}

/** Best-effort. An athlete with no coach has no org, every call refuses, and
 *  that must never surface as an error on a screen unrelated to coaching. */
export async function pushProgressionProposals(client: SupabaseClient, orgId: string, proposals: ProgressionProposal[]): Promise<void> {
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

interface TrendSnapshotInput {
  kind: 'lift_trend' | 'erg_trend' | 'hard_budget';
  points: readonly Record<string, unknown>[];
}

/** Serialises the three locally-computed trend shapes for the push RPC.
 *  Pure and separately testable — the network call itself is not. */
export function trendSnapshotInputs(lifts: TrendSeries[], erg: TrendSeries | null, hard: HardBudget): TrendSnapshotInput[] {
  const inputs: TrendSnapshotInput[] = [];
  if (lifts.length) inputs.push({ kind: 'lift_trend', points: lifts as unknown as Record<string, unknown>[] });
  if (erg) inputs.push({ kind: 'erg_trend', points: [erg as unknown as Record<string, unknown>] });
  inputs.push({ kind: 'hard_budget', points: [hard as unknown as Record<string, unknown>] });
  return inputs;
}

export async function pushTrendSnapshots(client: SupabaseClient, orgId: string, lifts: TrendSeries[], erg: TrendSeries | null, hard: HardBudget): Promise<void> {
  const generatedAt = new Date().toISOString();
  for (const input of trendSnapshotInputs(lifts, erg, hard)) {
    try {
      await client.rpc('push_trend_snapshot', {
        p_organization_id: orgId,
        p_kind: input.kind,
        p_points: input.points,
        p_generated_at: generatedAt,
      });
    } catch {
      /* Best-effort, same reasoning as pushProgressionProposals. */
    }
  }
}

/**
 * Pull unprocessed decision receipts and apply any progression approvals
 * whose `before` still matches. Returns a settings PATCH to fold into the
 * draft (or null if nothing changed) plus counts for a caller that wants to
 * say something about it — this function does not itself touch `useDb()`,
 * keeping it callable from a plain async context (SyncProvider's reconcile)
 * rather than requiring a hook.
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

export interface PendingAssignment {
  id: string;
  organizationId: string;
  preferredStartDate: string;
  preferredWeekdays: number[];
  state: 'draft' | 'ready-for-coordinator';
  templateVersionId: string;
}

export async function listPendingAssignments(client: SupabaseClient, userId: string): Promise<readonly PendingAssignment[]> {
  const { data, error } = await client
    .from('program_assignments')
    .select('id, organization_id, preferred_start_date, preferred_weekdays, state, template_version_id')
    .eq('athlete_user_id', userId)
    .in('state', ['draft', 'ready-for-coordinator']);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    preferredStartDate: row.preferred_start_date as string,
    preferredWeekdays: row.preferred_weekdays as number[],
    state: row.state as PendingAssignment['state'],
    templateVersionId: row.template_version_id as string,
  }));
}

export async function acceptAssignment(client: SupabaseClient, orgId: string, assignmentId: string): Promise<void> {
  const { error } = await client.rpc('accept_program_assignment', {
    p_organization_id: orgId,
    p_assignment_id: assignmentId,
    p_idempotency_key: `accept:${assignmentId}`,
  });
  if (error) throw error;
}

export async function declineAssignment(client: SupabaseClient, orgId: string, assignmentId: string): Promise<void> {
  const { error } = await client.rpc('decline_program_assignment', {
    p_organization_id: orgId,
    p_assignment_id: assignmentId,
    p_idempotency_key: `decline:${assignmentId}`,
  });
  if (error) throw error;
}
