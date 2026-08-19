import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProgressionProposal } from '../lib/progression';
import {
  applyPendingArcDecisions,
  applyServerProgression,
  pushProgressionProposals,
  resetArcProgressionForTests,
  structurallyEqual,
} from './arc-progression';

/*
 * The pure cases MIRROR apps/web/src/cloud/arc-athlete-sync.test.ts, because
 * `structurallyEqual` and `applyServerProgression` are deliberate duplicates
 * of the web's (see arc-progression.ts's header) and both clients apply into
 * the same athlete's `conProgress`. The loop cases are this file's own: the
 * web exercises its loop against the real RPCs in checks/migrations-apply.mjs,
 * which does not drive this file, so the receipt bookkeeping is pinned here.
 */

describe('structurallyEqual', () => {
  it('is true for identical key order', () => {
    expect(structurallyEqual({ kg: 100, at: 1000 }, { kg: 100, at: 1000 })).toBe(true);
  });

  it('is true across a jsonb-normalised key order — the bug this exists to prevent', () => {
    expect(structurallyEqual({ kg: 100, at: 1000, reps: 5 }, { at: 1000, kg: 100, reps: 5 })).toBe(true);
  });

  it('is false when a value actually differs', () => {
    expect(structurallyEqual({ kg: 100, at: 1000 }, { kg: 102, at: 1000 })).toBe(false);
  });

  it('is false when one side has an extra key', () => {
    expect(structurallyEqual({ kg: 100, at: 1000 }, { kg: 100, at: 1000, reps: 5 })).toBe(false);
  });

  it('treats null as equal only to null', () => {
    expect(structurallyEqual(null, null)).toBe(true);
    expect(structurallyEqual(null, { kg: 100, at: 1000 })).toBe(false);
    expect(structurallyEqual({ kg: 100, at: 1000 }, null)).toBe(false);
  });
});

describe('applyServerProgression', () => {
  it('refuses a strength-domain row unconditionally — there is no local field left to apply it to', () => {
    const out = applyServerProgression('strength', 'squat', { kg: 100, at: 1000 }, { kg: 102, at: 2000 }, {});
    expect(out).toBeNull();
  });

  it('applies a conditioning proposal when before matches the current baseline', () => {
    const settings = { conProgress: { 'row:steady': { level: 2, miss: 0 } } };
    const out = applyServerProgression('conditioning', 'row:steady', { level: 2, miss: 0 }, { level: 3, miss: 0 }, settings);
    expect(out?.conProgress?.['row:steady']).toEqual({ level: 3, miss: 0 });
  });

  it('applies even when the pushed `before` has a different key order than the local value — the jsonb round-trip case', () => {
    const settings = { conProgress: { 'row:steady': { miss: 0, level: 2 } } };
    const out = applyServerProgression('conditioning', 'row:steady', { level: 2, miss: 0 }, { level: 3, miss: 0 }, settings);
    expect(out?.conProgress?.['row:steady']).toEqual({ level: 3, miss: 0 });
  });

  it('refuses (returns null) when the athlete has trained again since the proposal was pushed', () => {
    const settings = { conProgress: { 'row:steady': { level: 4, miss: 0 } } };
    const out = applyServerProgression('conditioning', 'row:steady', { level: 2, miss: 0 }, { level: 3, miss: 0 }, settings);
    expect(out).toBeNull();
  });

  it('applies a conditioning proposal the same way, using the {level:0,miss:0} default baseline', () => {
    const out = applyServerProgression('conditioning', 'row:steady', { level: 0, miss: 0 }, { level: 1, miss: 0 }, {});
    expect(out?.conProgress?.['row:steady']).toEqual({ level: 1, miss: 0 });
  });

  it("does not touch a different key's progress", () => {
    const settings = { conProgress: { 'row:steady': { level: 2, miss: 1 }, 'bike:tempo': { level: 0, miss: 0 } } };
    const out = applyServerProgression('conditioning', 'bike:tempo', { level: 0, miss: 0 }, { level: 1, miss: 0 }, settings);
    expect(out?.conProgress?.['row:steady']).toEqual({ level: 2, miss: 1 });
  });
});

/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
interface TableResult {
  data: Row[] | Row | null;
  error: unknown;
}

/** A thenable stand-in for a PostgREST builder, same shape as
 *  arc-assignments.test.ts uses: every filter returns `this`, awaiting it (or
 *  `maybeSingle`) yields the canned result. A table may carry a QUEUE of
 *  results, consumed one per `from()` call, for loops that query it once per
 *  receipt. */
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

function fakeClient(tables: Record<string, TableResult | TableResult[]>, rpc?: { error?: unknown }) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const entry = tables[table];
      if (Array.isArray(entry)) return builder(entry.shift() ?? { data: [], error: null });
      return builder(entry ?? { data: [], error: null });
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (rpc?.error) return Promise.reject(rpc.error);
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

const proposal = (): ProgressionProposal => ({
  id: 'conditioning:run-1:intervals',
  domain: 'conditioning',
  subject: 'Intervals',
  sourceId: 'run-1',
  sourceAt: 1700000000000,
  createdAt: 1700000001000,
  direction: 'increase',
  status: 'pending',
  intent: 'Set the next prescription level for this exact format and modality.',
  reason: 'On target.',
  evidence: [],
  confidence: 'high',
  dataLimitations: [],
  ruleVersion: 'progression-proposal-v1',
  authority: 'coach-approval-required',
  before: { level: 1, miss: 0 },
  after: { level: 2, miss: 0 },
  key: 'intervals',
});

beforeEach(() => resetArcProgressionForTests());

describe('pushProgressionProposals', () => {
  it('pushes each proposal through the RPC with the server parameter names', async () => {
    const { client, rpcCalls } = fakeClient({});
    await pushProgressionProposals(client, 'org-1', [proposal()]);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('push_progression_proposal');
    expect(rpcCalls[0].args).toMatchObject({
      p_organization_id: 'org-1',
      p_domain: 'conditioning',
      p_client_key: 'intervals',
      p_before: { level: 1, miss: 0 },
      p_after: { level: 2, miss: 0 },
      p_hard: false,
      p_direction: 'increase',
      p_source_at: new Date(1700000000000).toISOString(),
    });
  });

  it('marks a review-direction proposal hard — the sanitised safety signal', async () => {
    const { client, rpcCalls } = fakeClient({});
    await pushProgressionProposals(client, 'org-1', [{ ...proposal(), direction: 'review' }]);
    expect(rpcCalls[0].args.p_hard).toBe(true);
  });

  it('swallows an RPC failure — best-effort, the local ledger stays the source of truth', async () => {
    const { client } = fakeClient({}, { error: new Error('offline') });
    await expect(pushProgressionProposals(client, 'org-1', [proposal()])).resolves.toBeUndefined();
  });
});

describe('applyPendingArcDecisions', () => {
  const receipt = { id: 'r-1', organization_id: 'org-1', athlete_user_id: 'u-1', decision_id: 'd-1' };
  const approval = { id: 'd-1', kind: 'progression_approved', payload: { proposal_id: 'snap-1' } };
  const snapshot = {
    id: 'snap-1',
    domain: 'conditioning',
    client_key: 'intervals',
    before: { level: 1, miss: 0 },
    after: { level: 2, miss: 0 },
  };

  it('applies an approved conditioning decision whose before still matches', async () => {
    const { client } = fakeClient({
      decision_receipts: { data: [receipt], error: null },
      coach_decisions: { data: [approval], error: null },
      progression_proposal_snapshots: { data: [snapshot], error: null },
    });
    const { settings, result } = await applyPendingArcDecisions(client, 'u-1', {
      conProgress: { intervals: { level: 1, miss: 0 } },
    });
    expect(result).toEqual({ applied: 1, stale: 0 });
    expect(settings?.conProgress?.intervals).toEqual({ level: 2, miss: 0 });
  });

  it('counts a mismatched baseline as stale and leaves the local value alone', async () => {
    const { client } = fakeClient({
      decision_receipts: { data: [receipt], error: null },
      coach_decisions: { data: [approval], error: null },
      progression_proposal_snapshots: { data: [snapshot], error: null },
    });
    const { settings, result } = await applyPendingArcDecisions(client, 'u-1', {
      conProgress: { intervals: { level: 4, miss: 0 } },
    });
    expect(result).toEqual({ applied: 0, stale: 1 });
    expect(settings).toBeNull();
  });

  it('processes a receipt at most once — the second sync does not re-apply it', async () => {
    const tables = () => ({
      decision_receipts: { data: [receipt], error: null },
      coach_decisions: { data: [approval], error: null },
      progression_proposal_snapshots: { data: [snapshot], error: null },
    });
    const first = await applyPendingArcDecisions(fakeClient(tables()).client, 'u-1', {
      conProgress: { intervals: { level: 1, miss: 0 } },
    });
    expect(first.result.applied).toBe(1);
    const second = await applyPendingArcDecisions(fakeClient(tables()).client, 'u-1', {
      conProgress: { intervals: { level: 2, miss: 0 } },
    });
    expect(second.result).toEqual({ applied: 0, stale: 0 });
    expect(second.settings).toBeNull();
  });

  it('ignores decisions that are not progression approvals', async () => {
    const { client } = fakeClient({
      decision_receipts: { data: [receipt], error: null },
      coach_decisions: { data: [{ id: 'd-1', kind: 'week_published', payload: {} }], error: null },
    });
    const { settings, result } = await applyPendingArcDecisions(client, 'u-1', {});
    expect(result).toEqual({ applied: 0, stale: 0 });
    expect(settings).toBeNull();
  });

  it('returns quietly when the receipts read refuses — the no-coach case', async () => {
    const { client } = fakeClient({
      decision_receipts: { data: null, error: { message: 'permission denied' } },
    });
    const { settings, result } = await applyPendingArcDecisions(client, 'u-1', {});
    expect(result).toEqual({ applied: 0, stale: 0 });
    expect(settings).toBeNull();
  });
});
