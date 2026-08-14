import type { SupabaseClient } from '@supabase/supabase-js';
import { clearArcOrgCache } from './arc-assignments';

/*
 * The ATHLETE's half of the ARC consent contract, on the phone.
 *
 * supabase/migrations/20260813_arc_roster_invites_and_names.sql writes both
 * halves of the link and says in its header that the screen calling them is
 * "somebody else's commit". This is the client for that; the Android app is
 * the athlete product (CLAUDE.md, 13 August 2026), so it is the only place the
 * athlete's half can live.
 *
 * Two calls, and the shape of BOTH is the consent model:
 *
 *   - `redeem_coach_invite(p_code)` derives `athlete_user_id` from `auth.uid()`.
 *     There is no parameter for whose account joins the roster, and this module
 *     must never grow one — the person making the call is the person joining.
 *   - `set_athlete_display_name(p_display_name)` derives the row the same way,
 *     and NULL OR BLANK DELETES IT. That is the withdrawal half of the consent,
 *     not an input error, so nothing here may reject a blank name on the way
 *     down.
 *
 * DELIBERATELY DUPLICATED rather than imported: apps/mobile may not import from
 * apps/web (CLAUDE.md, "the athlete and the coach never face each other"), and
 * in any case web has no athlete surface left to have written this. The same
 * precedent as ./arc-assignments.ts and the R2 port. There is nothing to share
 * with `packages/*` here — these are two `client.rpc` calls and a cache, not
 * decision logic.
 *
 * The read/write split matches arc-assignments.ts and is the same rule:
 *
 *   - THE READ IS BEST-EFFORT. An athlete with no profile row — everyone, until
 *     they set a name — and an athlete with no network both get `null`. Neither
 *     is an error worth a banner on a settings screen.
 *   - THE TWO WRITES THROW. The athlete pressed a button and is owed the truth
 *     about whether it landed.
 */

/*
 * Display names, by user id, or null for "no row".
 *
 * Module-level, in memory only, exactly like arc-assignments.ts's org cache and
 * for the same reasons: it is allowed to die with the JS context, and a name
 * published to a coach has no business outliving a sign-out in MMKV. `null` is
 * a real answer and is cached; a FAILED read is not, or one blip would show a
 * blank field to an athlete who has a name and invite them to retype it.
 *
 * A MAP rather than the single slot this started as (13 August 2026). The
 * athlete's own name was the only one the phone had a use for until a coach
 * could publish a week — attributing that week needs the COACH's name, read
 * the same way from the same table, and this repo's rule is one path per
 * question. One slot keyed on "the current user id" cannot hold two people, so
 * it became a map rather than a second cache growing next to it. Small and
 * unbounded is fine: it holds the accounts one athlete's phone asks about in
 * one JS context — themselves, and their coach.
 */
const nameCache = new Map<string, string | null>();

/**
 * Any account's display name. Best-effort: absence, a refusal and a network
 * blip all come back null, and the caller must render that as "no name" rather
 * than as an error.
 *
 * `athlete_profiles_read` decides what this can actually see, and it is
 * narrower than the signature: self, or an athlete THIS caller coaches. An
 * athlete asking for their coach's name matches neither and gets null — see
 * the long note in ./arc-coach-week.ts, which is the caller that hits it.
 */
export async function getDisplayName(client: SupabaseClient, userId: string): Promise<string | null> {
  const cached = nameCache.get(userId);
  if (cached !== undefined) return cached;
  const { data, error } = await client
    .from('athlete_profiles')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  const displayName = data ? ((data as { display_name: string }).display_name ?? null) : null;
  nameCache.set(userId, displayName);
  return displayName;
}

/**
 * The athlete's own name. Kept as its own name because "mine" is a different
 * question from "theirs" at every call site that asks it, and Settings only
 * ever asks for mine.
 *
 * An ALIAS, not a wrapper. `async function f() { return g() }` costs two extra
 * microtask ticks over calling `g` directly, and Settings' name field is
 * settled inside an `act()` that flushes a bounded number of them — wrapping
 * this made a passing test fail for a reason that had nothing to do with
 * names. One binding, one promise.
 */
export const getMyDisplayName = getDisplayName;

/** Sign-out must forget it — the next account on this device is not the same
 *  athlete, and is very probably not coached by the same person either. Called
 *  from SyncProvider's signOut alongside clearArcOrgCache. */
export function clearArcNameCache(): void {
  nameCache.clear();
}

/**
 * Redeem a coach's invite code. THROWS when the server refuses.
 *
 * The code is passed through unnormalised on purpose. The function already
 * strips everything that is not a hex digit and upper-cases the rest, so doing
 * it again here would be a second implementation of a rule that has to stay
 * identical to the server's — and the server's is the one that decides.
 *
 * It also answers EVERY rejection with one message — unknown, expired, revoked,
 * already spent — so that it cannot be used as an oracle to tell a guesser when
 * they have found a real code. Anything built on this must not undo that by
 * being more specific than the answer it was given.
 */
export async function redeemCoachInvite(client: SupabaseClient, code: string): Promise<void> {
  const { error } = await client.rpc('redeem_coach_invite', { p_code: code });
  if (error) throw error;
  /* The roster link this just created is exactly what `getMyArcOrgId` caches
     the ABSENCE of. Without this, an athlete who joins a coach mid-session
     keeps the cached "no coach" answer for the life of the JS context and the
     next reconcile skips the whole assignment pass — the coach's first program
     would appear only after a cold start. */
  clearArcOrgCache();
}

/**
 * Publish, change or WITHDRAW the athlete's display name. THROWS when the
 * server refuses. Returns the stored name, or null when the row was deleted.
 *
 * A blank name is not an error and must never be treated as one here: it is the
 * withdrawal, and the migration is explicit that it has to be as available as
 * the grant. The server trims, so the caller does not have to — but it is
 * trimmed here anyway so the returned value is what will actually be stored
 * rather than what was typed.
 */
export async function setMyDisplayName(
  client: SupabaseClient,
  userId: string,
  name: string,
): Promise<string | null> {
  const trimmed = name.trim();
  const { data, error } = await client.rpc('set_athlete_display_name', { p_display_name: trimmed });
  if (error) throw error;
  /* The RPC returns the row it wrote, or nothing at all when it deleted one.
     The stored name is read back off that row rather than assumed to be what
     was sent — the server owns the trim. */
  const stored = data && typeof data === 'object'
    ? ((data as { display_name?: unknown }).display_name as string | undefined) ?? null
    : null;
  nameCache.set(userId, stored);
  return stored;
}

/** Test seam: the cache above is process-wide, so a suite has to be able to put
 *  it back. Mirrors resetArcAssignmentsForTests. */
export function resetArcRosterForTests(): void {
  nameCache.clear();
}
