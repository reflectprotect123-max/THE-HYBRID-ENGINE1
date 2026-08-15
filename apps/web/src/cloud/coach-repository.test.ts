import { describe, expect, it, vi } from 'vitest';
import { SupabaseCoachWorkspaceRepository } from './coach-repository';
import type { ProgramAssignmentDraft } from '../coach/data/contracts';

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
      rpc: async () => ({ data: null, error: new Error('nope') }),
    }) as never);
    const real = (await repo.listClients()).find((c) => c.id.startsWith('abcdef12'));
    expect(real).toBeDefined();
    /* The guard the handoff protects is "detail is not this person's", and
       every consumer asks it as `=== 'engine-local'`. Asserting THAT rather
       than the label is what keeps this test honest when the label changes —
       and it just did: a real athlete is `roster-summary`, not a fixture. */
    expect(real?.source).not.toBe('engine-local');
    expect(real?.source).toBe('roster-summary');
    // Zeroes here mean "not readable", and nothing invented a completion.
    expect(real?.completion.strength).toEqual({ completed: 0, planned: 0 });
    expect(real?.assignment).toBeNull();
    // A placeholder that reads as an id, not as a person who does not exist.
    expect(real?.name).toContain('abcdef12');
  });

  it('sends INTENT to the command and never a resolved date', async () => {
    // Typed args so `mock.calls[0][1]` is the parameter object rather than
    // an untyped empty tuple — the assertion below reads it.
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: { id: 'assignment-1', athlete_user_id: 'athlete-1' }, error: null,
    }));
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

  it('does not report success for a command that came back empty', async () => {
    /* An idempotency-key collision used to make the command return no row with
       no error, and this method reported "ready-for-coordinator" for a write
       that never happened — the one failure a coach cannot see from the
       screen. The server raises now; this asserts the client half. */
    const repo = new SupabaseCoachWorkspaceRepository(clientWith({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
      }) }) }) }) }),
      rpc: async () => ({ data: null, error: null }),
    }) as never);
    await expect(repo.saveAssignmentDraft(draft())).rejects.toThrow(/not written/);
  });

  it('says assignments need a connection rather than failing silently offline', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(null as never);
    await expect(repo.saveAssignmentDraft(draft())).rejects.toThrow(/connection/);
  });
});

describe('the roster projection', () => {
  const withRoster = (rpc: unknown) => new SupabaseCoachWorkspaceRepository(clientWith({
    from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({
      data: [{ athlete_user_id: 'abcdef12-0000-0000-0000-000000000000', organization_id: 'org-1' }], error: null,
    }) }) }) }),
    rpc,
  }) as never);

  const summary = (over: Record<string, unknown> = {}) => ({
    strength_completed: 2, strength_planned: 3,
    conditioning_completed: 1, conditioning_planned: 2,
    nutrition_days: 5, has_safety_flag: false, ...over,
  });

  it('shows the real counts the server returned', async () => {
    const repo = withRoster(async () => ({ data: [summary()], error: null }));
    const client = (await repo.listClients()).find((c) => c.id.startsWith('abcdef12'))!;
    expect(client.completion.strength).toEqual({ completed: 2, planned: 3 });
    expect(client.completion.nutritionDays).toBe(5);
  });

  it('surfaces a safety flag on the roster, because it outranks the counts', async () => {
    // "3 of 4 done" without "the fourth was dropped for pain" is the opposite
    // of what happened.
    const repo = withRoster(async () => ({ data: [summary({ has_safety_flag: true })], error: null }));
    const client = (await repo.listClients()).find((c) => c.id.startsWith('abcdef12'))!;
    expect(client.attention?.level).toBe('safety');
  });

  it('degrades ONE client to not-readable rather than blanking the roster', async () => {
    const repo = withRoster(async () => ({ data: null, error: new Error('not permitted') }));
    const clients = await repo.listClients();
    // The roster still lists them, and the signed-in athlete is untouched.
    expect(clients.some((c) => c.source === 'engine-local')).toBe(true);
    const client = clients.find((c) => c.id.startsWith('abcdef12'))!;
    expect(client.completion.strength).toEqual({ completed: 0, planned: 0 });
  });

  it('keeps detail gated even when the counts are real', async () => {
    // Layer 3: the detail screens still read local stores, so unlocking them
    // would show the coach their OWN training under this athlete's name.
    const repo = withRoster(async () => ({ data: [summary()], error: null }));
    const client = (await repo.listClients()).find((c) => c.id.startsWith('abcdef12'))!;
    expect(client.source).not.toBe('engine-local');
    // And it is not called a fixture — it is a real person.
    expect(client.source).toBe('roster-summary');
  });
});

/*
 * Names, and getting onto the roster in the first place.
 *
 * These fakes route by TABLE, unlike the ones above, because `listClients`
 * now makes two reads and a single-shape stub cannot tell them apart. That is
 * also the point of the first test: the roster read is load-bearing and the
 * name read is cosmetic, so they must fail differently.
 */
const ATHLETE = 'abcdef12-0000-0000-0000-000000000000';

const tableClient = (tables: Record<string, unknown>, rpc?: unknown) => clientWith({
  from: (table: string) => tables[table] ?? { select: () => { throw new Error(`unexpected read of ${table}`); } },
  rpc: rpc ?? (async () => ({ data: null, error: new Error('no rpc') })),
});

const rosterTable = {
  select: () => ({ eq: () => ({ eq: async () => ({ data: [{ athlete_user_id: ATHLETE, organization_id: 'org-1' }], error: null }) }) }),
};

const profilesTable = (data: unknown, error: unknown = null) => ({
  select: () => ({ in: async () => ({ data, error }) }),
});

describe('an athlete’s name', () => {
  it('uses the name the ATHLETE published', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_assignments: rosterTable,
      athlete_profiles: profilesTable([{ user_id: ATHLETE, display_name: 'Riley Roster' }]),
    }) as never);
    const client = (await repo.listClients()).find((c) => c.id === ATHLETE)!;
    expect(client.name).toBe('Riley Roster');
    expect(client.initials).toBe('RR');
  });

  it('keeps the id-shaped placeholder when no name was published', async () => {
    // A placeholder must read as MISSING DATA. Deriving something name-like
    // from the uuid or an email would put a person on the screen who does not
    // exist, which is worse than an unlovely label.
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_assignments: rosterTable,
      athlete_profiles: profilesTable([]),
    }) as never);
    const client = (await repo.listClients()).find((c) => c.id === ATHLETE)!;
    expect(client.name).toBe('Athlete abcdef12');
  });

  it('treats a blank published name as no name at all', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_assignments: rosterTable,
      athlete_profiles: profilesTable([{ user_id: ATHLETE, display_name: '   ' }]),
    }) as never);
    expect((await repo.listClients()).find((c) => c.id === ATHLETE)!.name).toBe('Athlete abcdef12');
  });

  it('does not blank the roster when the NAME read fails', async () => {
    // The roster is the answer; the name is a label on it. A failed label
    // must not cost the coach their client list — unlike a failed roster
    // read, which is thrown two tests above.
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_assignments: rosterTable,
      athlete_profiles: profilesTable(null, new Error('denied')),
    }) as never);
    const client = (await repo.listClients()).find((c) => c.id === ATHLETE)!;
    expect(client.name).toBe('Athlete abcdef12');
  });
});

/*
 * A COACH WHO IS THEIR OWN ATHLETE (14 August 2026).
 *
 * `20260814_arc_self_coaching.sql` dropped `coach_athlete_distinct`, and that
 * constraint's comment named the exact cost these tests buy back: without it
 * "the bench's 'own data' mode and its 'client' mode become the same query".
 * `listClients` used to return `[...ENGINE_LOCAL, ...rows]` unconditionally,
 * so a self-row put the signed-in user in the list TWICE — once read from
 * local stores, once from the server, with nothing on screen saying which was
 * which. Every assertion below is about that not happening.
 */
describe('a coach who is their own athlete', () => {
  const SELF = 'coach-1'; // the id `clientWith` signs in as
  const selfRoster = (rows: unknown[]) => ({
    select: () => ({ eq: () => ({ eq: async () => ({ data: rows, error: null }) }) }),
  });

  it('folds a self-row into the engine-local entry instead of listing them twice', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_assignments: selfRoster([
        { athlete_user_id: SELF, organization_id: 'org-9' },
        { athlete_user_id: ATHLETE, organization_id: 'org-9' },
      ]),
      athlete_profiles: profilesTable([]),
    }) as never);

    const clients = await repo.listClients();

    /* One entry per PERSON. Two people here, so two entries — the roster row
       for the coach themselves must not become a third. */
    expect(clients).toHaveLength(2);
    expect(clients.filter((c) => c.source === 'engine-local')).toHaveLength(1);
    /* And specifically not under their own user id, which is what a second
       entry would have been keyed on. */
    expect(clients.some((c) => c.id === SELF)).toBe(false);
  });

  it('keeps the folded entry engine-local, because your own detail IS local', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_assignments: selfRoster([{ athlete_user_id: SELF, organization_id: 'org-9' }]),
      athlete_profiles: profilesTable([]),
    }) as never);

    const own = (await repo.listClients()).find((c) => c.source === 'engine-local')!;

    /* Promoting yourself to `roster-summary` would make every detail screen
       refuse or fall back to a server projection of data this device is
       sitting on top of — your own bench, made worse, to satisfy a label. */
    expect(own.source).toBe('engine-local');
    /* The selection key the whole bench and localStorage are written against
       is UNCHANGED. It is not a user id and never was. */
    expect(own.id).toBe('engine-local');
    /* What the row actually contributes: the relationship. `athleteUserId` is
       the id every coach command is keyed on — `id` above matches no
       `athlete_user_id` and would fail all of them. */
    expect(own.selfCoaching).toEqual({ organizationId: 'org-9', athleteUserId: SELF });
  });

  it('carries no selfCoaching when the coach is not on their own roster', async () => {
    // The default state. Nothing about this migration is automatic — the
    // invite still has to be minted and redeemed deliberately.
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_assignments: selfRoster([{ athlete_user_id: ATHLETE, organization_id: 'org-1' }]),
      athlete_profiles: profilesTable([]),
    }) as never);
    const own = (await repo.listClients()).find((c) => c.source === 'engine-local')!;
    expect(own.selfCoaching ?? null).toBeNull();
  });

  it('asks the server for no summary and no name for the self-row', async () => {
    /* The fold happens BEFORE either read, so the coach's own card cannot end
       up carrying a server projection of the same person the local stores
       already describe — two answers to one question on one card is the
       confusion the dropped constraint existed to prevent, rebuilt inside a
       single entry. */
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const names = vi.fn(async () => ({ data: [], error: null }));
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_assignments: selfRoster([{ athlete_user_id: SELF, organization_id: 'org-9' }]),
      athlete_profiles: { select: () => ({ in: names }) },
    }, rpc) as never);

    const own = (await repo.listClients()).find((c) => c.source === 'engine-local')!;

    expect(rpc).not.toHaveBeenCalled();
    expect(names).not.toHaveBeenCalled();
    /* The fixture's own figures, untouched — `engine-local` means the local
       stores are this entry's truth. */
    expect(own.name).toBe('Alex Morgan');
  });
});

describe('athlete invites', () => {
  const inviteRow = (over: Record<string, unknown> = {}) => ({
    id: 'invite-1',
    organization_id: 'org-1',
    code: '0123456789ABCDEF0123456789ABCDEF',
    created_at: '2026-08-13T00:00:00.000Z',
    expires_at: '2999-01-01T00:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
    ...over,
  });

  it('mints a code with the ORGANISATION and nothing else', async () => {
    // The whole consent model rests on this: the coach's half names a tenant.
    // An athlete id here would let a coach attach themselves to a stranger.
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: inviteRow(), error: null }));
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({}, rpc) as never);
    const invite = await repo.createCoachInvite('org-1');

    expect(rpc.mock.calls[0][0]).toBe('create_coach_invite');
    expect(Object.keys(rpc.mock.calls[0][1])).toEqual(['p_organization_id']);
    expect(invite.status).toBe('open');
  });

  it('does not report a code that was never written', async () => {
    // A returned-but-empty command would otherwise print a code the coach
    // sends on to an athlete for whom it does not exist.
    const repo = new SupabaseCoachWorkspaceRepository(
      tableClient({}, async () => ({ data: null, error: null })) as never,
    );
    await expect(repo.createCoachInvite('org-1')).rejects.toThrow(/not created/);
  });

  it('derives status from the timestamps, and redeemed outranks expired', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      coach_athlete_invites: {
        select: () => ({ eq: () => ({ order: async () => ({ data: [
          inviteRow({ id: 'a' }),
          inviteRow({ id: 'b', revoked_at: '2026-08-13T01:00:00.000Z' }),
          inviteRow({ id: 'c', expires_at: '2026-08-01T00:00:00.000Z' }),
          // Spent while valid, then its expiry passed. It bought a real
          // roster row, so calling it "expired" would suggest the link lapsed.
          inviteRow({ id: 'd', expires_at: '2026-08-01T00:00:00.000Z', accepted_at: '2026-07-30T00:00:00.000Z' }),
        ], error: null }) }) }),
      },
    }) as never);
    expect((await repo.listCoachInvites()).map((i) => i.status)).toEqual(['open', 'revoked', 'expired', 'accepted']);
  });

  it('says invites need a connection rather than failing silently offline', async () => {
    const repo = new SupabaseCoachWorkspaceRepository(null as never);
    await expect(repo.createCoachInvite('org-1')).rejects.toThrow(/connection/);
    expect(await repo.listCoachInvites()).toEqual([]);
    expect(await repo.listCoachOrganizations()).toEqual([]);
  });

  it('offers only the organisations a coach may actually invite into', async () => {
    const eq2 = { in: async () => ({ data: [
      { organization_id: 'org-1', role: 'coach', organizations: { name: 'Hybrid Barbell' } },
      { organization_id: 'org-2', role: 'owner', organizations: [{ name: 'Second Gym' }] },
      { organization_id: 'org-3', role: 'owner', organizations: null },
    ], error: null }) };
    const repo = new SupabaseCoachWorkspaceRepository(tableClient({
      organization_memberships: { select: () => ({ eq: () => ({ eq: () => eq2 }) }) },
    }) as never);
    const orgs = await repo.listCoachOrganizations();
    expect(orgs.map((o) => o.name)).toEqual(['Hybrid Barbell', 'Second Gym', 'Organisation org-3']);
  });
});
