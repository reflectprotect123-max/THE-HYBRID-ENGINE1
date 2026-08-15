import type { SupabaseClient } from '@supabase/supabase-js';
import { clearArcOrgCache } from './arc-assignments';
import { clearArcNameCache } from './arc-roster';

/*
 * THE ATHLETE'S CONSENT CONTROLS, on the phone.
 *
 * `set_nutrition_read_grant` (20260808) and `set_readiness_read_grant`
 * (20260810) have existed, been granted to `authenticated` and been exercised
 * by `checks/migrations-apply.mjs` since the day they were written, and until
 * this file NOTHING CALLED EITHER. The coach bench reads an athlete's
 * nutrition window and readiness trend through grants the athlete had no way
 * to give and no way to take back: a consent model that existed only in the
 * database is not a consent model, it is a column.
 *
 * WHY THIS IS ON ANDROID AND NOWHERE ELSE. Both RPCs derive the granting
 * athlete from `auth.uid()` — there is no parameter for whose data is being
 * shared, deliberately, and this module must never grow one. The athlete is on
 * the phone (CLAUDE.md, 13 August 2026: `apps/mobile` IS the athlete product),
 * so the phone is the only surface where the caller can be the athlete.
 *
 * `end_coach_relationship` (20260814) is here for the same reason and one
 * more. The RPC lets EITHER party end the link, because "leaving must not
 * require the permission of the person you are leaving" — a rule that means
 * nothing while only the coach's client can call it.
 *
 * DELIBERATELY DUPLICATED rather than shared with `apps/web`: same precedent
 * as ./arc-roster.ts and ./arc-assignments.ts, and in any case the web half of
 * `end_coach_relationship` is the COACH's, addressed to a different person.
 *
 * The read/write split is arc-roster.ts's, unchanged and for its reasons:
 *
 *   - THE READS ARE BEST-EFFORT. An athlete with no coach — most of them — is
 *     refused by RLS on every query below, and that must render as "you have
 *     no coach", never as an error on a settings screen.
 *   - THE WRITES THROW. The athlete pressed a consent control and is owed the
 *     truth about whether it landed. A revoke that silently failed is the
 *     worst outcome this file can produce.
 *
 * NOTHING IS CACHED HERE. arc-roster caches names and arc-assignments caches
 * the org id because both are stable and cheap to be slightly stale about. A
 * GRANT is neither: a stale "on" tells the athlete their coach can see their
 * food diary when they have just turned it off, and a stale "off" is a promise
 * of privacy the server is not keeping. Every read goes to the server.
 */

/** The one active coaching relationship this athlete is in. */
export interface CoachLink {
  organizationId: string;
  coachUserId: string;
}

/** What this athlete's coach may currently read beyond the training summary
 *  every coach gets. Both default to FALSE — an absent row is no grant, and
 *  the phone must render absence as absence rather than as unknown. */
export interface ReadGrants {
  nutrition: boolean;
  readiness: boolean;
}

export type GrantKind = 'nutrition' | 'readiness';

const RPC_FOR: Record<GrantKind, string> = {
  nutrition: 'set_nutrition_read_grant',
  readiness: 'set_readiness_read_grant',
};

const TABLE_FOR: Record<GrantKind, string> = {
  nutrition: 'nutrition_read_grants',
  readiness: 'readiness_read_grants',
};

/**
 * The athlete's active coaching relationship, or null.
 *
 * `coach_athlete_read` (20260808) already lets an athlete see their own
 * assignment rows — `athlete_user_id = auth.uid()` is the second branch of
 * that policy — so this is a plain select and needs no RPC.
 *
 * ONE relationship, `limit(1)`, matching `getMyArcOrgId`'s shape and its
 * assumption. The schema permits an athlete to be on two coaches' rosters in
 * two organisations; every athlete-side surface in this app is written for
 * one, and picking the first arbitrarily is the honest version of that limit
 * rather than a second, wrong, model of it. If a second coach ever becomes a
 * real product state, THIS is the function that has to return a list, and the
 * consent card has to grow one block per coach — a grant is per-coach in the
 * database and must stay per-coach on the screen.
 *
 * Best-effort: no membership, no network and a refusal all come back null.
 */
export async function readMyCoachLink(client: SupabaseClient, userId: string): Promise<CoachLink | null> {
  const { data, error } = await client
    .from('coach_athlete_assignments')
    .select('organization_id, coach_user_id')
    .eq('athlete_user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { organization_id?: unknown; coach_user_id?: unknown };
  if (typeof row.organization_id !== 'string' || typeof row.coach_user_id !== 'string') return null;
  return { organizationId: row.organization_id, coachUserId: row.coach_user_id };
}

/**
 * What the coach can read right now, read from the grant tables themselves.
 *
 * NOT from anything this device remembers. Both tables are readable by the
 * athlete they belong to (`athlete_user_id = auth.uid()`, the first branch of
 * each `*_read_grants_read` policy), so the phone can always ask the server
 * what it is actually enforcing, and it always does.
 *
 * A row whose `revoked_at` is set is a revoked grant, not a missing one — the
 * RPCs upsert and stamp rather than delete — so "granted" is `row exists and
 * revoked_at is null`, and a missing row and a stamped row mean the same thing
 * to the athlete: not shared.
 *
 * Best-effort per SIDE. One table failing must not report the other as off,
 * so the two reads are independent and a failure returns false for its own
 * half only. False is the safe direction to be wrong in on a screen: it
 * understates what the coach can see, and the athlete's next action after
 * seeing "not shared" is to grant it, which is a write that reports the truth.
 */
export async function readMyReadGrants(
  client: SupabaseClient,
  userId: string,
  link: CoachLink,
): Promise<ReadGrants> {
  const [nutrition, readiness] = await Promise.all([
    readOneGrant(client, userId, link, 'nutrition'),
    readOneGrant(client, userId, link, 'readiness'),
  ]);
  return { nutrition, readiness };
}

async function readOneGrant(
  client: SupabaseClient,
  userId: string,
  link: CoachLink,
  kind: GrantKind,
): Promise<boolean> {
  const { data, error } = await client
    .from(TABLE_FOR[kind])
    .select('revoked_at')
    .eq('organization_id', link.organizationId)
    .eq('athlete_user_id', userId)
    .eq('granted_to', link.coachUserId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { revoked_at?: unknown }).revoked_at == null;
}

/**
 * Grant or revoke one read. THROWS when the server refuses.
 *
 * Returns the state the SERVER now holds, read off the row it returned, not
 * the state that was asked for. The two agree today; a control that reports
 * what it requested rather than what happened is how a revoke that silently
 * did nothing goes unnoticed, and this is the one control in the app where
 * that failure is a privacy failure rather than an inconvenience.
 */
export async function setReadGrant(
  client: SupabaseClient,
  link: CoachLink,
  kind: GrantKind,
  grant: boolean,
): Promise<boolean> {
  const { data, error } = await client.rpc(RPC_FOR[kind], {
    p_organization_id: link.organizationId,
    p_granted_to: link.coachUserId,
    p_grant: grant,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { revoked_at?: unknown } | null;
  /* A command that came back empty wrote nothing. Reporting the requested
     state here would tell an athlete their data is private when the server
     never agreed — the same rule the bench's own commands follow. */
  if (!row) throw new Error('That did not save. Nothing has changed — try again.');
  return row.revoked_at == null;
}

/**
 * Leave this coach. THROWS when the server refuses.
 *
 * The athlete's own half of `end_coach_relationship`. The RPC answers "no such
 * relationship" and "not yours to end" with one message so it cannot be used
 * to probe who is on whose roster, and nothing here tries to be more specific
 * than the answer it was given.
 *
 * WHAT THIS DOES NOT DO, because the athlete has to be told it plainly on the
 * screen: it does not delete a week the coach already published. The migration
 * says why at length — an empty week they did not ask for is worse than a
 * stale one they can see, and there is no Coordinator left to recompute one.
 * The week ages out as the calendar rolls past it, and no new one can arrive
 * because `publish_coach_week` checks the relationship on every call.
 */
export async function leaveMyCoach(client: SupabaseClient, link: CoachLink, userId: string): Promise<void> {
  const { data, error } = await client.rpc('end_coach_relationship', {
    p_organization_id: link.organizationId,
    p_athlete_user_id: userId,
  });
  if (error) throw error;
  if (!(Array.isArray(data) ? data[0] : data)) {
    throw new Error('The link was not ended. Nothing has changed — try again.');
  }
  /* Both caches are now lies. `getMyArcOrgId` would keep handing out an
     organisation this athlete has just left — and every assignment read is
     keyed on it — and the name cache holds the ex-coach's name, which the
     athlete is no longer entitled to see and should not go on being shown. */
  clearArcOrgCache();
  clearArcNameCache();
}
