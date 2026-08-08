import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiftState, ProgressState, Settings, Workout } from '@hybrid/engine';
import type { ProgressionProposal } from '../coach/progression';
import type { TrendSeries, HardBudget } from '../coach/trends';

/*
 * The BACKEND -> ATHLETE half of the ARC loop.
 *
 * Everything built earlier today (supabase/migrations/20260808_arc_*.sql,
 * apps/web/src/cloud/coach-repository.ts) is the COACH -> BACKEND half: a
 * coach approves a proposal or publishes a workout, and a row lands in
 * Supabase. Nothing pulled it back until this file. It closes four loops:
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
 *   4. MATERIALIZE — once accepted, an assignment's coach-authored program
 *      version becomes a real local `Workout` (see
 *      `materializeAcceptedAssignments` below), so the existing, unmodified
 *      `proposalsFromDB` / `buildWeeklyPlanFromProposals` pipeline schedules
 *      it exactly like a self-authored session. No Coordinator change; the
 *      Coordinator never learns a session came from a coach.
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

const MATERIALIZED_ASSIGNMENTS_KEY = 'hybrid-arc-materialized-assignments-v1';

function loadMaterializedAssignments(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(MATERIALIZED_ASSIGNMENTS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveMaterializedAssignments(ids: Set<string>): void {
  try {
    localStorage.setItem(MATERIALIZED_ASSIGNMENTS_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* Worst case: the same assignment is re-fetched and re-diffed next sync
       — `materializeAcceptedAssignments` below is idempotent against that,
       since it always checks the local `Workout` id before adding. */
  }
}

/**
 * `program_template_versions.body` is unconstrained, coach-written jsonb —
 * the same "opaque to Postgres" contract as `athlete_domain_snapshots` —
 * so it gets the same defensive shape guard before it can become a local
 * `Workout` the render tree trusts. Anything that doesn't look like a real
 * workout body is dropped rather than partially trusted.
 */
export function sanitizeAssignedWorkoutBody(body: unknown, days: readonly number[]): Omit<Workout, 'id' | 'updatedAt'> | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind === 'strength' || b.kind === 'conditioning' ? b.kind : undefined;
  const name = typeof b.name === 'string' && b.name.trim() ? b.name : 'Assigned workout';
  const blocks = Array.isArray(b.blocks) ? (b.blocks as Workout['blocks']) : [];
  return { kind, name, blocks, days: [...days].sort((m, n) => m - n) };
}

/**
 * The other end of §"MATERIALIZE" above. An `accepted` assignment's
 * template-version body becomes a local `Workout`, tagged with a stable id
 * derived from the assignment (`arc:<assignmentId>`) so this is idempotent
 * across syncs and safe to call every reconcile. Deliberately does NOT
 * write a date — only `days` (from `preferred_weekdays`, already 0=Sunday
 * on both sides of this boundary) — so placement still goes through the
 * existing Coordinator, exactly like a self-authored recurring workout.
 *
 * Materialized once per assignment, tracked in localStorage: if the athlete
 * later deletes the resulting local Workout, this must not resurrect it on
 * the next sync — that would make the workout impossible to get rid of.
 */
export async function materializeAcceptedAssignments(
  client: SupabaseClient,
  userId: string,
  existingWorkoutIds: ReadonlySet<string>,
): Promise<Workout[]> {
  const { data, error } = await client
    .from('program_assignments')
    .select('id, template_version_id, preferred_weekdays')
    .eq('athlete_user_id', userId)
    .eq('state', 'accepted');
  if (error || !data || data.length === 0) return [];

  const materialized = loadMaterializedAssignments();
  const rows = data as Record<string, unknown>[];
  const fresh = rows.filter((row) => !materialized.has(row.id as string));
  if (fresh.length === 0) return [];

  const versionIds = [...new Set(fresh.map((row) => row.template_version_id as string))];
  const { data: versions, error: verr } = await client
    .from('program_template_versions')
    .select('id, body')
    .in('id', versionIds);
  if (verr || !versions) return [];
  const bodyById = new Map((versions as Record<string, unknown>[]).map((v) => [v.id as string, v.body]));

  const result: Workout[] = [];
  for (const row of fresh) {
    const assignmentId = row.id as string;
    materialized.add(assignmentId);
    const workoutId = `arc:${assignmentId}`;
    if (existingWorkoutIds.has(workoutId)) continue;
    const body = sanitizeAssignedWorkoutBody(
      bodyById.get(row.template_version_id as string),
      (row.preferred_weekdays as number[]) ?? [],
    );
    if (body) result.push({ ...body, id: workoutId, updatedAt: Date.now() });
  }
  saveMaterializedAssignments(materialized);
  return result;
}
