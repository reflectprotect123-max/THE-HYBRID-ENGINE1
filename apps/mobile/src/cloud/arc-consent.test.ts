import type { SupabaseClient } from '@supabase/supabase-js';
import { leaveMyCoach, readMyCoachLink, readMyReadGrants, setReadGrant, type CoachLink } from './arc-consent';
import { getMyArcOrgId, resetArcAssignmentsForTests } from './arc-assignments';
import { getDisplayName, resetArcRosterForTests } from './arc-roster';

/*
 * The network is faked; the CONSENT RULES are what these assert.
 *
 * Chiefly: no call carries an athlete id (the server derives it from
 * auth.uid(), and a parameter for it is the hole this whole design exists to
 * close), a missing grant row and a revoked one both read as NOT SHARED, a
 * write reports what the server did rather than what was asked for, and
 * leaving a coach invalidates every cache that would otherwise keep serving
 * the relationship that just ended.
 */

type Row = Record<string, unknown>;
interface TableResult {
  data: Row[] | Row | null;
  error: unknown;
}

/** A thenable stand-in for a PostgREST builder — the same shim as
 *  arc-roster.test.ts, kept beside its own module for the same reason. */
function builder(result: TableResult) {
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) self[m] = () => self;
  self.maybeSingle = () =>
    Promise.resolve({
      data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      error: result.error,
    });
  self.then = (resolve: (v: TableResult) => unknown) => Promise.resolve(result).then(resolve);
  return self;
}

interface FakeOptions {
  tables?: Record<string, TableResult>;
  rpc?: { data?: unknown; error?: unknown };
}

function fakeClient(options: FakeOptions = {}) {
  const fromCalls: string[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      fromCalls.push(table);
      return builder(options.tables?.[table] ?? { data: null, error: null });
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: options.rpc?.data ?? null, error: options.rpc?.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, fromCalls, rpcCalls };
}

const LINK: CoachLink = { organizationId: 'org-1', coachUserId: 'coach-1' };

beforeEach(() => {
  resetArcAssignmentsForTests();
  resetArcRosterForTests();
});

describe('readMyCoachLink', () => {
  it('returns the organisation and the coach behind an active assignment', async () => {
    const { client } = fakeClient({
      tables: {
        coach_athlete_assignments: { data: { organization_id: 'org-1', coach_user_id: 'coach-1' }, error: null },
      },
    });
    await expect(readMyCoachLink(client, 'athlete-1')).resolves.toEqual(LINK);
  });

  it('is null for the uncoached athlete, which is most of them', async () => {
    const { client } = fakeClient();
    await expect(readMyCoachLink(client, 'athlete-1')).resolves.toBeNull();
  });

  /* A refusal and a blip are the same shape as "no coach" on purpose: this
     read sits on a settings screen that has nothing to do with coaching for
     the athletes it fails for. */
  it('is null rather than a throw when the read fails', async () => {
    const { client } = fakeClient({
      tables: { coach_athlete_assignments: { data: null, error: { message: 'permission denied' } } },
    });
    await expect(readMyCoachLink(client, 'athlete-1')).resolves.toBeNull();
  });

  it('is null for a row missing either half, rather than a half-built link', async () => {
    const { client } = fakeClient({
      tables: { coach_athlete_assignments: { data: { organization_id: 'org-1' }, error: null } },
    });
    await expect(readMyCoachLink(client, 'athlete-1')).resolves.toBeNull();
  });
});

describe('readMyReadGrants — absence and revocation are the same answer', () => {
  it('reads both tables and reports an unrevoked row as shared', async () => {
    const { client, fromCalls } = fakeClient({
      tables: {
        nutrition_read_grants: { data: { revoked_at: null }, error: null },
        readiness_read_grants: { data: { revoked_at: null }, error: null },
      },
    });
    await expect(readMyReadGrants(client, 'athlete-1', LINK)).resolves.toEqual({ nutrition: true, readiness: true });
    expect(fromCalls).toEqual(expect.arrayContaining(['nutrition_read_grants', 'readiness_read_grants']));
  });

  it('reports a REVOKED row as not shared — the RPCs stamp, they do not delete', async () => {
    const { client } = fakeClient({
      tables: {
        nutrition_read_grants: { data: { revoked_at: '2026-08-15T10:00:00Z' }, error: null },
        readiness_read_grants: { data: null, error: null },
      },
    });
    await expect(readMyReadGrants(client, 'athlete-1', LINK)).resolves.toEqual({ nutrition: false, readiness: false });
  });

  /* False understates what the coach can see, and the athlete's next move
     after reading "not shared" is a write, which reports the truth. */
  it('falls back to not-shared when a read fails', async () => {
    const { client } = fakeClient({
      tables: {
        nutrition_read_grants: { data: null, error: { message: 'network' } },
        readiness_read_grants: { data: { revoked_at: null }, error: null },
      },
    });
    await expect(readMyReadGrants(client, 'athlete-1', LINK)).resolves.toEqual({ nutrition: false, readiness: true });
  });
});

describe('setReadGrant', () => {
  it.each([
    ['nutrition', 'set_nutrition_read_grant'],
    ['readiness', 'set_readiness_read_grant'],
  ] as const)('sends %s to %s with no athlete id anywhere in it', async (kind, fn) => {
    const { client, rpcCalls } = fakeClient({ rpc: { data: { revoked_at: null } } });
    await expect(setReadGrant(client, LINK, kind, true)).resolves.toBe(true);
    expect(rpcCalls).toEqual([
      { fn, args: { p_organization_id: 'org-1', p_granted_to: 'coach-1', p_grant: true } },
    ]);
    /* The load-bearing assertion of this whole module. The server derives the
       granting athlete from auth.uid(); a parameter for it here would mean a
       client could share somebody else's food diary. */
    expect(JSON.stringify(rpcCalls)).not.toMatch(/athlete/i);
  });

  it('reports the state the SERVER holds, not the state that was requested', async () => {
    const { client } = fakeClient({ rpc: { data: { revoked_at: '2026-08-15T10:00:00Z' } } });
    await expect(setReadGrant(client, LINK, 'nutrition', true)).resolves.toBe(false);
  });

  it('throws when the server refuses', async () => {
    const { client } = fakeClient({ rpc: { error: { message: 'not permitted' } } });
    await expect(setReadGrant(client, LINK, 'readiness', false)).rejects.toBeTruthy();
  });

  /* A command that came back empty wrote nothing. Returning `grant` here would
     tell an athlete their data is private when the server never agreed. */
  it('throws when the command comes back empty', async () => {
    const { client } = fakeClient({ rpc: { data: null } });
    await expect(setReadGrant(client, LINK, 'nutrition', false)).rejects.toThrow(/did not save/i);
  });
});

describe('leaveMyCoach', () => {
  it('ends the relationship as the athlete, and names nobody else', async () => {
    const { client, rpcCalls } = fakeClient({ rpc: { data: { id: 'assignment-1', status: 'revoked' } } });
    await leaveMyCoach(client, LINK, 'athlete-1');
    expect(rpcCalls).toEqual([
      { fn: 'end_coach_relationship', args: { p_organization_id: 'org-1', p_athlete_user_id: 'athlete-1' } },
    ]);
  });

  it('throws when the command comes back empty — a link that is still live must not report success', async () => {
    const { client } = fakeClient({ rpc: { data: null } });
    await expect(leaveMyCoach(client, LINK, 'athlete-1')).rejects.toThrow(/was not ended/i);
  });

  /*
   * The caches are the part that bites. `getMyArcOrgId` caches "which
   * organisation am I in" for the life of the JS context, and every assignment
   * read is keyed on it — an athlete who leaves and is not forgotten keeps
   * being treated as coached until a cold start.
   */
  it('forgets the organisation and the names, so nothing keeps serving the ended link', async () => {
    const coached = fakeClient({
      tables: {
        organization_memberships: { data: { organization_id: 'org-1' }, error: null },
        athlete_profiles: { data: { display_name: 'Coach Ada' }, error: null },
      },
      rpc: { data: { id: 'assignment-1' } },
    });
    await expect(getMyArcOrgId(coached.client, 'athlete-1')).resolves.toBe('org-1');
    await expect(getDisplayName(coached.client, 'coach-1')).resolves.toBe('Coach Ada');

    await leaveMyCoach(coached.client, LINK, 'athlete-1');

    /* Both answers are re-asked of a server that now refuses, and both come
       back as absence. Without the cache clears they would still be 'org-1'
       and 'Coach Ada'. */
    const gone = fakeClient();
    await expect(getMyArcOrgId(gone.client, 'athlete-1')).resolves.toBeNull();
    await expect(getDisplayName(gone.client, 'coach-1')).resolves.toBeNull();
  });
});
