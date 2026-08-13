import type { SupabaseClient } from '@supabase/supabase-js';
import type { Workout } from '@hybrid/engine';
import { storage } from '../store/storage';

/*
 * The COACH -> ATHLETE half of the ARC loop, on the phone.
 *
 * A coach assigns a program through the bench (`create_program_assignment`,
 * see apps/web/src/cloud/coach-repository.ts) and a row lands in
 * `program_assignments`. Until this file nothing on Android ever looked for
 * it: apps/mobile/src/cloud read `app_state` and the three ecosystem tables
 * and nothing else, so an assignment could sit unanswered forever on the only
 * athlete client this product still ships.
 *
 * DELIBERATELY DUPLICATED from apps/web/src/cloud/arc-athlete-sync.ts rather
 * than imported or extracted into a package — the same call made by the R2
 * port (autocoach/ledger.ts, policy.ts, consent.ts, applyResolution.ts).
 * apps/mobile may not import from apps/web (checks/lane-contract.mjs guards
 * the reverse crossing on web's side, and this repo's rule is that the two
 * apps stand on packages/*, never on each other), and the web original is
 * built on browser globals this file cannot use:
 *
 *   - `localStorage`/`sessionStorage` do not exist on React Native. The
 *     idempotency bookkeeping here goes through the engine's Storage port,
 *     which is MMKV (../store/storage) — synchronous, survives a cold start.
 *     The org-id cache was `sessionStorage` on web precisely because it is
 *     allowed to die with the JS context; the native equivalent of that is a
 *     module-level variable, which is what it uses.
 *
 * The RULES are the ones the web file already proved and must stay identical,
 * because both clients write into the same athlete's store:
 *
 *   - EVERYTHING HERE IS BEST-EFFORT. An athlete with no coach — the
 *     overwhelming majority — has no organisation membership at all and every
 *     call below refuses. That must never surface as an error banner on a
 *     training sync that has nothing to do with coaching.
 *   - An accepted assignment becomes a local `Workout` with `days` and NO
 *     date. It is a PROPOSAL into the Coordinator's week, not a week: placement
 *     still goes through the existing coordinator-adapter pipeline exactly as
 *     for a self-authored recurring workout, and the Coordinator never learns
 *     a session came from a coach.
 *   - Materialisation happens once per assignment, tracked on disk. If the
 *     athlete later deletes the resulting workout, the next sync must not
 *     resurrect it — that would make it impossible to get rid of.
 */

export interface PendingAssignment {
  id: string;
  organizationId: string;
  preferredStartDate: string;
  preferredWeekdays: number[];
  state: 'draft' | 'ready-for-coordinator';
  templateVersionId: string;
}

/*
 * The athlete's own organisation membership, or null.
 *
 * Cached in memory only. On web this is `sessionStorage`, chosen because the
 * value is ALLOWED to go stale across restarts — a fresh session refetches
 * it. A module-level variable has exactly those semantics on native, and
 * avoids putting a coaching relationship into MMKV where it would outlive a
 * sign-out. The cache exists purely so the no-coach case does not re-run this
 * query on every sync tick; `null` is a real, cacheable answer, so a separate
 * "have we asked" flag carries it.
 */
let orgCache: { userId: string; orgId: string | null } | null = null;

export async function getMyArcOrgId(client: SupabaseClient, userId: string): Promise<string | null> {
  if (orgCache && orgCache.userId === userId) return orgCache.orgId;
  const { data, error } = await client
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('role', 'athlete')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  // A FAILED query is not an answer. Caching it would pin an athlete with a
  // real coach to "no coach" for the rest of the app's life on a single
  // network blip, which is exactly the failure the web version's storage-write
  // try/catch also refuses to make permanent.
  if (error) return null;
  const orgId = data ? ((data as { organization_id: string }).organization_id ?? null) : null;
  orgCache = { userId, orgId };
  return orgId;
}

/** Sign-out must forget the coaching relationship — the next account on this
 *  device is not the same athlete. Called from SyncProvider's signOut. */
export function clearArcOrgCache(): void {
  orgCache = null;
}

export async function listPendingAssignments(
  client: SupabaseClient,
  userId: string,
): Promise<readonly PendingAssignment[]> {
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
    preferredWeekdays: (row.preferred_weekdays as number[]) ?? [],
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
    const raw = JSON.parse(storage.getItem(MATERIALIZED_ASSIGNMENTS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveMaterializedAssignments(ids: Set<string>): void {
  try {
    // Unbounded growth is a real risk over a long-lived account; capped to the
    // most recent 500 so this never becomes the reason storage fills up.
    storage.setItem(MATERIALIZED_ASSIGNMENTS_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* Worst case: the same assignment is re-fetched and re-diffed next sync —
       `materializeAcceptedAssignments` is idempotent against that, since it
       always checks the local `Workout` id before adding. */
  }
}

/** Test seam: the module-level caches above are process-wide, and the storage
 *  port under jest is the in-memory shim, so a suite has to be able to put
 *  both back. */
export function resetArcAssignmentsForTests(): void {
  orgCache = null;
  try {
    storage.removeItem(MATERIALIZED_ASSIGNMENTS_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * `program_template_versions.body` is unconstrained, coach-written jsonb —
 * the same "opaque to Postgres" contract as `athlete_domain_snapshots` — so it
 * gets the same defensive shape guard before it can become a local `Workout`
 * the render tree trusts. Anything that doesn't look like a real workout body
 * is dropped rather than partially trusted.
 */
export function sanitizeAssignedWorkoutBody(
  body: unknown,
  days: readonly number[],
): Omit<Workout, 'id' | 'updatedAt'> | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind === 'strength' || b.kind === 'conditioning' ? b.kind : undefined;
  const name = typeof b.name === 'string' && b.name.trim() ? b.name : 'Assigned workout';
  const blocks = Array.isArray(b.blocks) ? (b.blocks as Workout['blocks']) : [];
  return { kind, name, blocks, days: [...days].sort((m, n) => m - n) };
}

/**
 * An `accepted` assignment's template-version body becomes a local `Workout`,
 * tagged with a stable id derived from the assignment (`arc:<assignmentId>`)
 * so this is idempotent across syncs and safe to call every reconcile.
 *
 * Deliberately does NOT write a date — only `days`, from `preferred_weekdays`,
 * which is already 0=Sunday on both sides of this boundary. The Coordinator
 * decides where in the week it actually lands.
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
  // A failed version read must not burn the assignments: leaving them out of
  // the materialized set is what makes the next sync try again.
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
