import type { SupabaseClient } from '@supabase/supabase-js';
import {
  acceptAssignment,
  clearArcOrgCache,
  declineAssignment,
  getMyArcOrgId,
  listPendingAssignments,
  materializeAcceptedAssignments,
  resetArcAssignmentsForTests,
  sanitizeAssignedWorkoutBody,
} from './arc-assignments';

/*
 * The network is faked; the RULES are what these assert — the same ones the
 * web original proves, because both clients write into the same athlete's
 * store. Chiefly: an accepted assignment materialises ONCE, carries days and
 * never a date (the Coordinator still places it), and a coach-written body is
 * never trusted whole.
 */

type Row = Record<string, unknown>;
interface TableResult {
  data: Row[] | Row | null;
  error: unknown;
}

/** A thenable stand-in for a PostgREST builder: every filter returns `this`,
 *  awaiting it (or `maybeSingle`) yields the canned result. */
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
  rpc?: { error?: unknown };
}

function fakeClient(options: FakeOptions = {}) {
  const fromCalls: string[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      fromCalls.push(table);
      return builder(options.tables?.[table] ?? { data: [], error: null });
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: options.rpc?.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, fromCalls, rpcCalls };
}

beforeEach(() => resetArcAssignmentsForTests());

describe('getMyArcOrgId', () => {
  it('returns the athlete membership and caches it', async () => {
    const { client, fromCalls } = fakeClient({
      tables: { organization_memberships: { data: [{ organization_id: 'org-1' }], error: null } },
    });
    expect(await getMyArcOrgId(client, 'u-1')).toBe('org-1');
    expect(await getMyArcOrgId(client, 'u-1')).toBe('org-1');
    expect(fromCalls.filter((t) => t === 'organization_memberships')).toHaveLength(1);
  });

  it('caches the no-coach answer too — the common case must not re-query every tick', async () => {
    const { client, fromCalls } = fakeClient({
      tables: { organization_memberships: { data: [], error: null } },
    });
    expect(await getMyArcOrgId(client, 'u-1')).toBeNull();
    expect(await getMyArcOrgId(client, 'u-1')).toBeNull();
    expect(fromCalls).toHaveLength(1);
  });

  it('does NOT cache a failed query — a blip must not pin a coached athlete to "no coach"', async () => {
    const { client, fromCalls } = fakeClient({
      tables: { organization_memberships: { data: null, error: { message: 'network' } } },
    });
    expect(await getMyArcOrgId(client, 'u-1')).toBeNull();
    expect(await getMyArcOrgId(client, 'u-1')).toBeNull();
    expect(fromCalls).toHaveLength(2);
  });

  it('re-queries for a different user, and after an explicit clear', async () => {
    const { client, fromCalls } = fakeClient({
      tables: { organization_memberships: { data: [{ organization_id: 'org-1' }], error: null } },
    });
    await getMyArcOrgId(client, 'u-1');
    await getMyArcOrgId(client, 'u-2');
    clearArcOrgCache();
    await getMyArcOrgId(client, 'u-2');
    expect(fromCalls).toHaveLength(3);
  });
});

describe('listPendingAssignments', () => {
  it('maps the snake_case row onto the client shape', async () => {
    const { client } = fakeClient({
      tables: {
        program_assignments: {
          data: [
            {
              id: 'a-1',
              organization_id: 'org-1',
              preferred_start_date: '2026-08-17',
              preferred_weekdays: [1, 3],
              state: 'ready-for-coordinator',
              template_version_id: 'v-1',
            },
          ],
          error: null,
        },
      },
    });
    expect(await listPendingAssignments(client, 'u-1')).toEqual([
      {
        id: 'a-1',
        organizationId: 'org-1',
        preferredStartDate: '2026-08-17',
        preferredWeekdays: [1, 3],
        state: 'ready-for-coordinator',
        templateVersionId: 'v-1',
      },
    ]);
  });

  it('is empty, never throwing, when the read refuses — the no-coach case', async () => {
    const { client } = fakeClient({
      tables: { program_assignments: { data: null, error: { message: 'permission denied' } } },
    });
    await expect(listPendingAssignments(client, 'u-1')).resolves.toEqual([]);
  });
});

describe('accept / decline', () => {
  it('accept calls the RPC with a stable idempotency key', async () => {
    const { client, rpcCalls } = fakeClient();
    await acceptAssignment(client, 'org-1', 'a-1');
    expect(rpcCalls).toEqual([
      {
        fn: 'accept_program_assignment',
        args: { p_organization_id: 'org-1', p_assignment_id: 'a-1', p_idempotency_key: 'accept:a-1' },
      },
    ]);
  });

  it('decline calls its own RPC with its own key', async () => {
    const { client, rpcCalls } = fakeClient();
    await declineAssignment(client, 'org-1', 'a-1');
    expect(rpcCalls[0].fn).toBe('decline_program_assignment');
    expect(rpcCalls[0].args.p_idempotency_key).toBe('decline:a-1');
  });

  it('THROWS when the RPC refuses — unlike every read here, this one the athlete asked for', async () => {
    const { client } = fakeClient({ rpc: { error: { message: 'no' } } });
    await expect(acceptAssignment(client, 'org-1', 'a-1')).rejects.toBeDefined();
    await expect(declineAssignment(client, 'org-1', 'a-1')).rejects.toBeDefined();
  });
});

describe('sanitizeAssignedWorkoutBody', () => {
  it('drops a body that is not an object', () => {
    expect(sanitizeAssignedWorkoutBody(null, [1])).toBeNull();
    expect(sanitizeAssignedWorkoutBody('squat day', [1])).toBeNull();
    expect(sanitizeAssignedWorkoutBody(7, [1])).toBeNull();
  });

  it('keeps a real body, sorting the weekdays', () => {
    expect(sanitizeAssignedWorkoutBody({ kind: 'strength', name: 'Squat day', blocks: [] }, [5, 1])).toEqual({
      kind: 'strength',
      name: 'Squat day',
      blocks: [],
      days: [1, 5],
    });
  });

  it('refuses a junk kind and junk blocks rather than trusting them', () => {
    expect(sanitizeAssignedWorkoutBody({ kind: 'yoga', name: '  ', blocks: 'nope' }, [])).toEqual({
      kind: undefined,
      name: 'Assigned workout',
      blocks: [],
      days: [],
    });
  });
});

describe('materializeAcceptedAssignments', () => {
  const accepted = {
    program_assignments: {
      data: [{ id: 'a-1', template_version_id: 'v-1', preferred_weekdays: [2, 4] }],
      error: null,
    },
    program_template_versions: {
      data: [{ id: 'v-1', body: { kind: 'strength', name: 'Coach block', blocks: [] } }],
      error: null,
    },
  };

  it('turns an accepted assignment into a Workout with days and NO date', async () => {
    const { client } = fakeClient({ tables: accepted });
    const [w] = await materializeAcceptedAssignments(client, 'u-1', new Set());
    expect(w.id).toBe('arc:a-1');
    expect(w.name).toBe('Coach block');
    expect(w.days).toEqual([2, 4]);
    // A date would be this file choosing the week. That is the Coordinator's.
    expect(w.dates).toBeUndefined();
  });

  it('materialises once — a second sync must not duplicate or resurrect it', async () => {
    const first = fakeClient({ tables: accepted });
    expect(await materializeAcceptedAssignments(first.client, 'u-1', new Set())).toHaveLength(1);
    const second = fakeClient({ tables: accepted });
    expect(await materializeAcceptedAssignments(second.client, 'u-1', new Set())).toEqual([]);
    // Not even read again — the local record short-circuits before the version
    // fetch, so a deleted workout stays deleted.
    expect(second.fromCalls).not.toContain('program_template_versions');
  });

  it('does not re-add a workout the athlete already holds', async () => {
    const { client } = fakeClient({ tables: accepted });
    expect(await materializeAcceptedAssignments(client, 'u-1', new Set(['arc:a-1']))).toEqual([]);
  });

  it('leaves the assignment unmaterialised when the version body cannot be read', async () => {
    const failed = fakeClient({
      tables: {
        ...accepted,
        program_template_versions: { data: null, error: { message: 'boom' } },
      },
    });
    expect(await materializeAcceptedAssignments(failed.client, 'u-1', new Set())).toEqual([]);
    const retry = fakeClient({ tables: accepted });
    expect(await materializeAcceptedAssignments(retry.client, 'u-1', new Set())).toHaveLength(1);
  });

  it('is empty and silent when nothing is accepted', async () => {
    const { client } = fakeClient({ tables: { program_assignments: { data: [], error: null } } });
    await expect(materializeAcceptedAssignments(client, 'u-1', new Set())).resolves.toEqual([]);
  });
});
