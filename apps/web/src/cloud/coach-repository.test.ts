import { describe, expect, it, vi } from 'vitest';
import { SupabaseCoachWorkspaceRepository } from './coach-repository';
import type { ProgramAssignmentDraft } from '../coach/contracts';

/*
 * These test the GUARANTEES, not the plumbing.
 *
 * The plumbing — does a select return rows — is proven against real Postgres by
 * checks/migrations-apply.mjs. What cannot be proven there is what this class
 * does with the answers, and every case below is one where being wrong looks
 * exactly like working: an error swallowed into an empty roster reads as "you
 * coach nobody", a fabricated figure reads as "your athlete did nothing", and a
 * date sent to the command would place a session the Coordinator owns.
 */

const draft = (over: Partial<ProgramAssignmentDraft> = {}): ProgramAssignmentDraft => ({
  id: 'draft-1',
  clientId: 'athlete-1',
  programTemplateId: 'tplv-1',
  preferredStartDate: '2026-09-01',
  preferredWeekdays: [1, 3, 5],
  baseProgramVersion: 'v1',
  state: 'draft',
  createdAt: '2026-08-08T00:00:00.000Z',
  ...over,
});

const clientWith = (over: Record<string, unknown>) => ({
  auth: { getUser: async () => ({ data: { user: { id: 'coach-1' } } }) },
  ...over,
});

describe('SupabaseCoachWorkspaceRepository', () => {
  it('returns an empty roster when there is no client, rather than throwing', async () => {
    // A build without Supabase config must not blank a bench that works
    // offline against the athlete's own local data.
    const repo = new SupabaseCoachWorkspaceRepository(null as never);
    expect(await repo.listClients()).toEqual([]);
    expect(await repo.listProgramTemplates()).toEqual([]);
  });

  it('THROWS a query error instead of reporting an empty roster', async () => {
    // "You coach nobody" and "the roster could not be loaded" are different
    // facts, and only one of them is safe to show as an empty list.
    const repo = new SupabaseCoachWorkspaceRepository(clientWith({
      from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: new Error('boom') }) }) }) }),
    }) as never);
    await expect(repo.listClients()).rejects.toThrow('boom');
  });

  it('keeps the signed-in athlete, whose detail is the only readable detail', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(clientWith({
      from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }),
    }) as never);
    const clients = await repo.listClients();
    expect(clients.map((c) => c.source)).toContain('engine-local');
  });

  it('marks a real roster client as detail-unavailable and fabricates no figures', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(clientWith({
      from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({
        data: [{ athlete_user_id: 'abcdef12-0000-0000-0000-000000000000', organization_id: 'org-1' }], error: null,
      }) }) }) }),
    }) as never);
    const real = (await repo.listClients()).find((c) => c.id.startsWith('abcdef12'));
    expect(real).toBeDefined();
    // The guard the handoff protects: no detail links for a client whose
    // detail cannot be fetched.
    expect(real?.source).toBe('synthetic-fixture');
    // Zeroes here mean "not readable", and nothing invented a completion.
    expect(real?.completion.strength).toEqual({ completed: 0, planned: 0 });
    expect(real?.assignment).toBeNull();
    // A placeholder that reads as an id, not as a person who does not exist.
    expect(real?.name).toContain('abcdef12');
  });

  it('sends INTENT to the command and never a resolved date', async () => {
    // Typed args so `mock.calls[0][1]` is the parameter object rather than
    // an untyped empty tuple — the assertion below reads it.
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: null, error: null }));
    const repo = new SupabaseCoachWorkspaceRepository(clientWith({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
      }) }) }) }) }),
      rpc,
    }) as never);

    const saved = await repo.saveAssignmentDraft(draft());

    expect(rpc).toHaveBeenCalledWith('create_program_assignment', expect.objectContaining({
      p_preferred_weekdays: [1, 3, 5],
      p_idempotency_key: 'draft-1',
    }));
    const args = rpc.mock.calls[0]![1];
    // The Coordinator owns placement. No parameter may carry one.
    for (const key of Object.keys(args)) {
      expect(key).not.toMatch(/resolved|calendar|placed/i);
    }
    expect(saved.state).toBe('ready-for-coordinator');
  });

  it('refuses to assign to somebody who is not on the roster', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(clientWith({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }) }) }) }) }),
      rpc: vi.fn(),
    }) as never);
    await expect(repo.saveAssignmentDraft(draft())).rejects.toThrow(/not on your roster/);
  });

  it('says assignments need a connection rather than failing silently offline', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(null as never);
    await expect(repo.saveAssignmentDraft(draft())).rejects.toThrow(/connection/);
  });
});
