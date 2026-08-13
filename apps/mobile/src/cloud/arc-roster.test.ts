import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearArcNameCache,
  getMyDisplayName,
  redeemCoachInvite,
  resetArcRosterForTests,
  setMyDisplayName,
} from './arc-roster';
import { getMyArcOrgId, resetArcAssignmentsForTests } from './arc-assignments';

/*
 * The network is faked; the CONSENT RULES are what these assert.
 *
 * Chiefly: neither call may carry an athlete id (the server derives it from
 * auth.uid(), and a parameter for it would be the whole hole this design
 * exists to close), a blank name is a withdrawal rather than an error, and a
 * redeem that succeeds must not leave the "no coach" cache standing.
 */

type Row = Record<string, unknown>;
interface TableResult {
  data: Row[] | Row | null;
  error: unknown;
}

/** A thenable stand-in for a PostgREST builder — same shim as
 *  arc-assignments.test.ts, kept beside its own module rather than shared, so
 *  neither suite can be broken by a change made for the other. */
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

beforeEach(() => {
  resetArcRosterForTests();
  resetArcAssignmentsForTests();
});

describe('getMyDisplayName', () => {
  it('reads the athlete\'s own row and caches it', async () => {
    const { client, fromCalls } = fakeClient({
      tables: { athlete_profiles: { data: { display_name: 'Sam' }, error: null } },
    });
    expect(await getMyDisplayName(client, 'u-1')).toBe('Sam');
    expect(await getMyDisplayName(client, 'u-1')).toBe('Sam');
    expect(fromCalls).toHaveLength(1);
  });

  it('caches "no name" too — absence stays absence, and it is the common case', async () => {
    const { client, fromCalls } = fakeClient({ tables: { athlete_profiles: { data: null, error: null } } });
    expect(await getMyDisplayName(client, 'u-1')).toBeNull();
    expect(await getMyDisplayName(client, 'u-1')).toBeNull();
    expect(fromCalls).toHaveLength(1);
  });

  it('does NOT cache a failed read — a blip must not show an empty field to someone who has a name', async () => {
    const { client, fromCalls } = fakeClient({
      tables: { athlete_profiles: { data: null, error: { message: 'network' } } },
    });
    expect(await getMyDisplayName(client, 'u-1')).toBeNull();
    expect(await getMyDisplayName(client, 'u-1')).toBeNull();
    expect(fromCalls).toHaveLength(2);
  });

  it('re-reads for a different user, and after an explicit clear', async () => {
    const { client, fromCalls } = fakeClient({
      tables: { athlete_profiles: { data: { display_name: 'Sam' }, error: null } },
    });
    await getMyDisplayName(client, 'u-1');
    await getMyDisplayName(client, 'u-2');
    clearArcNameCache();
    await getMyDisplayName(client, 'u-2');
    expect(fromCalls).toHaveLength(3);
  });
});

describe('redeemCoachInvite', () => {
  it('sends the code and NOTHING else — the athlete is auth.uid(), never a parameter', async () => {
    const { client, rpcCalls } = fakeClient();
    await redeemCoachInvite(client, 'AB12');
    expect(rpcCalls).toEqual([{ fn: 'redeem_coach_invite', args: { p_code: 'AB12' } }]);
    expect(Object.keys(rpcCalls[0].args)).toEqual(['p_code']);
  });

  it('passes the typed code through unnormalised — the server owns that rule', async () => {
    const { client, rpcCalls } = fakeClient();
    await redeemCoachInvite(client, ' ab12-cd34 ');
    expect(rpcCalls[0].args.p_code).toBe(' ab12-cd34 ');
  });

  it('THROWS when the server refuses — the athlete pressed a button', async () => {
    const { client } = fakeClient({ rpc: { error: { message: 'invite not found or no longer valid' } } });
    await expect(redeemCoachInvite(client, 'AB12')).rejects.toBeDefined();
  });

  it('drops the cached "no coach" answer, so the new roster link is seen this session', async () => {
    const memberships = fakeClient({ tables: { organization_memberships: { data: [], error: null } } });
    expect(await getMyArcOrgId(memberships.client, 'u-1')).toBeNull();

    await redeemCoachInvite(fakeClient().client, 'AB12');

    const joined = fakeClient({
      tables: { organization_memberships: { data: [{ organization_id: 'org-1' }], error: null } },
    });
    expect(await getMyArcOrgId(joined.client, 'u-1')).toBe('org-1');
  });

  it('leaves that cache alone when the redeem failed — nothing changed', async () => {
    const memberships = fakeClient({ tables: { organization_memberships: { data: [], error: null } } });
    expect(await getMyArcOrgId(memberships.client, 'u-1')).toBeNull();

    await expect(redeemCoachInvite(fakeClient({ rpc: { error: { message: 'no' } } }).client, 'AB12')).rejects.toBeDefined();

    const joined = fakeClient({
      tables: { organization_memberships: { data: [{ organization_id: 'org-1' }], error: null } },
    });
    expect(await getMyArcOrgId(joined.client, 'u-1')).toBeNull();
    expect(joined.fromCalls).toHaveLength(0);
  });
});

describe('setMyDisplayName', () => {
  it('sends only the name, and returns what the server stored', async () => {
    const { client, rpcCalls } = fakeClient({ rpc: { data: { user_id: 'u-1', display_name: 'Sam' } } });
    expect(await setMyDisplayName(client, 'u-1', '  Sam  ')).toBe('Sam');
    expect(rpcCalls).toEqual([{ fn: 'set_athlete_display_name', args: { p_display_name: 'Sam' } }]);
  });

  it('treats a blank name as the WITHDRAWAL it is, not as an error', async () => {
    const { client, rpcCalls } = fakeClient({ rpc: { data: null } });
    await expect(setMyDisplayName(client, 'u-1', '   ')).resolves.toBeNull();
    expect(rpcCalls[0].args.p_display_name).toBe('');
  });

  it('updates the cache in both directions, so the screen does not re-read to see its own write', async () => {
    const set = fakeClient({ rpc: { data: { display_name: 'Sam' } } });
    await setMyDisplayName(set.client, 'u-1', 'Sam');
    const read = fakeClient({ tables: { athlete_profiles: { data: { display_name: 'stale' }, error: null } } });
    expect(await getMyDisplayName(read.client, 'u-1')).toBe('Sam');
    expect(read.fromCalls).toHaveLength(0);

    await setMyDisplayName(fakeClient({ rpc: { data: null } }).client, 'u-1', '');
    expect(await getMyDisplayName(read.client, 'u-1')).toBeNull();
    expect(read.fromCalls).toHaveLength(0);
  });

  it('THROWS when the server refuses, and leaves the cache as it was', async () => {
    const set = fakeClient({ rpc: { data: { display_name: 'Sam' } } });
    await setMyDisplayName(set.client, 'u-1', 'Sam');
    await expect(
      setMyDisplayName(fakeClient({ rpc: { error: { message: 'display name too long' } } }).client, 'u-1', 'x'.repeat(200)),
    ).rejects.toBeDefined();
    const read = fakeClient({ tables: { athlete_profiles: { data: { display_name: 'stale' }, error: null } } });
    expect(await getMyDisplayName(read.client, 'u-1')).toBe('Sam');
  });
});
