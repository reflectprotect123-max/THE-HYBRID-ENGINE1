/*
 * Two adversarial-review bugs, both about Settings quietly losing data it had
 * already accepted:
 *
 *  - Backup restore used to write back only `workouts`/`sessions`/`settings`
 *    from a parsed backup, discarding `core` (recovery history, life load,
 *    the pain-hold/illness safety flags) and `ecosystem` even though the
 *    export includes them. `restoreDb` (the same function web's Settings
 *    screen uses) now drives the whole replace, and every field it returns
 *    is written back.
 *  - RecoveryCard seeded its form fields from `db.core` once, in a `useState`
 *    initialiser. Settings is a bottom-tab screen that stays mounted for the
 *    app's lifetime, so a day boundary crossed while it sat mounted left the
 *    form showing yesterday's values — and Save would have written them back
 *    in as TODAY's check-in.
 */
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderScreen, seed } from '../../test/harness';
import { SettingsScreen } from './Settings';
import { SyncProvider } from '../cloud/sync';
import { WhoopProvider } from '../cloud/whoop';
import { Concept2Provider } from '../cloud/concept2';
import { NutritionProvider } from '../store/nutrition';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { storage } from '../store/storage';
import { resetArcRosterForTests } from '../cloud/arc-roster';
import { resetArcAssignmentsForTests } from '../cloud/arc-assignments';

const persisted = (): EngineDB => JSON.parse(storage.getItem(LS_KEY) || '{}');

// Settings mounts CloudCard/WhoopCard/Concept2Card, which read useSync/
// useWhoop/useConcept2 — and SyncProvider itself reads useNutrition. All
// throw outside their provider. renderScreen's stack (test/harness.tsx)
// only covers DbProvider/RestProvider/SetTimerProvider (what every OTHER
// screen needs), so Settings tests supply the rest, in App.tsx's real order.
const renderSettings = () =>
  renderScreen(
    <NutritionProvider>
      <SyncProvider>
        <WhoopProvider>
          <Concept2Provider>
            <SettingsScreen />
          </Concept2Provider>
        </WhoopProvider>
      </SyncProvider>
    </NutritionProvider>,
  );

/*
 * THE ATHLETE'S HALF OF THE COACHING LINK, on the screen.
 *
 * Both controls are Supabase-shaped, and the harness has no Supabase client at
 * all — `enabled` is false, so unmocked they render nothing and every
 * assertion below would pass against an empty tree. So `useSync` and the shared
 * `supabaseClient` are the two things replaced, and NOTHING else: the cards,
 * the cloud module they call and the copy they show are the real ones.
 *
 * `renderSettings` above is untouched and still mounts the real providers —
 * the mock sits under them, not instead of them.
 */
let mockSupabaseClient: unknown = null;
let mockSyncOverride: Record<string, unknown> | null = null;

jest.mock('../cloud/sync', () => {
  const actual = jest.requireActual('../cloud/sync');
  const mod = {
    __esModule: true,
    ...actual,
    useSync: () => ({ ...actual.useSync(), ...(mockSyncOverride ?? {}) }),
  };
  /*
   * `Object.defineProperty`, NOT a `get supabaseClient()` in the literal above.
   * Babel's object-spread helper reads a literal's accessors as VALUES, and
   * jest hoists this factory above the `let`s — so the spread form captured
   * `undefined` once, at first require, and every card here quietly took its
   * signed-out path while the assertions still found the screen.
   */
  Object.defineProperty(mod, 'supabaseClient', { get: () => mockSupabaseClient });
  return mod;
});

const SIGNED_IN = { id: 'u-1', email: 'athlete@example.com' };

/** Minimal PostgREST/RPC double: one canned `athlete_profiles` row, optional
 *  canned rows for any other table, and one canned RPC answer, with every call
 *  recorded.
 *
 *  `tables` exists for the consent card, which reads three tables the name card
 *  never touched. A table with no entry answers `athlete_profiles`' row, which
 *  is what every test written before it assumed — and for
 *  `coach_athlete_assignments` that shape has no `organization_id`, so those
 *  tests keep rendering the no-coach case they were written against. */
function fakeSupabase(
  options: {
    profile?: { display_name: string } | null;
    tables?: Record<string, { data?: unknown; error?: unknown }>;
    rpc?: { data?: unknown; error?: unknown };
  } = {},
) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const self: Record<string, unknown> = {};
      // `limit` is in the chain because readMyCoachLink takes exactly one
      // assignment row; leaving it out makes the whole screen throw.
      for (const m of ['select', 'eq', 'limit']) self[m] = () => self;
      const canned = options.tables?.[table];
      self.maybeSingle = () =>
        Promise.resolve(canned ? { data: canned.data ?? null, error: canned.error ?? null } : { data: options.profile ?? null, error: null });
      return self;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: options.rpc?.data ?? null, error: options.rpc?.error ?? null });
    },
  };
  return { client, rpcCalls };
}

describe('Your coach — redeeming an invite', () => {
  beforeEach(() => {
    resetArcRosterForTests();
    mockSupabaseClient = null;
    mockSyncOverride = null;
    seed({});
  });
  afterEach(() => {
    mockSyncOverride = null;
  });

  it('tells a signed-out athlete to sign in rather than showing a button that does nothing', () => {
    const { client } = fakeSupabase();
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: null };
    renderSettings();

    expect(screen.queryByText('Link my coach')).toBeNull();
    expect(screen.queryByLabelText('invite code')).toBeNull();
    expect(
      screen.getByText(
        'Sign in above first — the link is made against your account, so there is nothing to link a code to until then.',
      ),
    ).toBeTruthy();
  });

  it('redeems the code, says so, and asks for a sync so a waiting program arrives today', async () => {
    const { client, rpcCalls } = fakeSupabase({ rpc: { data: { id: 'assignment-1' } } });
    const syncNow = jest.fn(() => Promise.resolve());
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN, syncNow };
    renderSettings();

    fireEvent.changeText(screen.getByLabelText('invite code'), 'ab12-cd34');
    await act(async () => {
      fireEvent.press(screen.getByText('Link my coach'));
    });

    // The typed code goes up EXACTLY as typed — normalising is the server's
    // rule, and a second copy of it here is a second thing to keep in step.
    expect(rpcCalls).toEqual([{ fn: 'redeem_coach_invite', args: { p_code: 'ab12-cd34' } }]);
    expect(
      screen.getByText(
        "You're linked. Your coach can now send you programs, and they arrive here for you to accept or decline.",
      ),
    ).toBeTruthy();
    expect(syncNow).toHaveBeenCalled();
    // The spent code is cleared, so it cannot be pressed a second time.
    expect(screen.getByLabelText('invite code').props.value).toBe('');
  });

  /*
   * The server answers unknown / expired / revoked / already-spent with ONE
   * sentence, so that it cannot tell someone guessing codes when they have
   * found a real one. This screen is the last place that property can be lost,
   * so it is asserted the only way that means anything: different refusals,
   * character-identical copy.
   */
  it.each([
    ['the single refusal the server gives', 'invite not found or no longer valid'],
    ['a refusal that named the reason', 'invite expired at 2026-08-01 and was revoked by coach 3f2a'],
    ['a bare constraint name', 'coach_athlete_distinct'],
  ])('says only that the code did not work — %s', async (_case, message) => {
    const { client } = fakeSupabase({ rpc: { error: { message } } });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN, syncNow: jest.fn(() => Promise.resolve()) };
    renderSettings();

    fireEvent.changeText(screen.getByLabelText('invite code'), 'DEADBEEF');
    await act(async () => {
      fireEvent.press(screen.getByText('Link my coach'));
    });

    expect(
      screen.getByText("That code didn't work — check it with your coach and try again. Nothing on this phone changed."),
    ).toBeTruthy();
    // The raw string reaches the console and nothing else.
    expect(screen.queryByText(new RegExp(message.slice(0, 12), 'i'))).toBeNull();
    // And the code stays in the box: it is not spent, and retyping it is work.
    expect(screen.getByLabelText('invite code').props.value).toBe('DEADBEEF');
  });
});

describe('Your name — the athlete owns it', () => {
  beforeEach(() => {
    resetArcRosterForTests();
    mockSupabaseClient = null;
    mockSyncOverride = null;
    seed({});
  });
  afterEach(() => {
    mockSyncOverride = null;
  });

  it('says who can see it, in the card, not in fine print somewhere else', () => {
    const { client } = fakeSupabase();
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    expect(
      screen.getByText(
        'Only a coach you are linked to can see this name. Nobody else can — not other athletes, not other coaches. Clearing it takes it back.',
      ),
    ).toBeTruthy();
  });

  it('shows the id-shaped placeholder when there is no name — absence stays absence', async () => {
    const { client } = fakeSupabase({ profile: null });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.getByLabelText('display name').props.value).toBe(''));
    expect(screen.getByText('You have no name set — a coach sees an id, like “Athlete 3f2a1b9c”.')).toBeTruthy();
  });

  it('publishes a name, and reports what the server actually stored', async () => {
    const { client, rpcCalls } = fakeSupabase({ profile: null, rpc: { data: { display_name: 'Sam Okoye' } } });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    fireEvent.changeText(screen.getByLabelText('display name'), '  Sam Okoye ');
    await act(async () => {
      fireEvent.press(screen.getByText('Save name'));
    });

    expect(rpcCalls).toEqual([{ fn: 'set_athlete_display_name', args: { p_display_name: 'Sam Okoye' } }]);
    expect(screen.getByText('Saved. Your coach sees this name from now on.')).toBeTruthy();
    expect(screen.getByText('Your coach sees you as “Sam Okoye”.')).toBeTruthy();
  });

  it('CLEARS the name — the withdrawal is a control, not an error path', async () => {
    const { client, rpcCalls } = fakeSupabase({ profile: { display_name: 'Sam Okoye' }, rpc: { data: null } });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.getByText('Your coach sees you as “Sam Okoye”.')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText('Clear'));
    });

    // A blank name is what deletes the row. It must reach the server as one.
    expect(rpcCalls).toEqual([{ fn: 'set_athlete_display_name', args: { p_display_name: '' } }]);
    expect(screen.getByText('Name withdrawn. Your coach sees the id again, not a name.')).toBeTruthy();
    expect(screen.getByText('You have no name set — a coach sees an id, like “Athlete 3f2a1b9c”.')).toBeTruthy();
  });

  it('leaves the shown name alone when the write fails, and says nothing changed', async () => {
    const { client } = fakeSupabase({
      profile: { display_name: 'Sam Okoye' },
      rpc: { error: { message: 'display name too long' } },
    });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.getByText('Your coach sees you as “Sam Okoye”.')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('display name'), 'Something else');
    await act(async () => {
      fireEvent.press(screen.getByText('Save name'));
    });

    expect(
      screen.getByText('Something went wrong. Try again, or check your connection. Nothing on this phone changed.'),
    ).toBeTruthy();
    // What the coach sees is still what the coach saw.
    expect(screen.getByText('Your coach sees you as “Sam Okoye”.')).toBeTruthy();
  });

  it('tells a signed-out athlete to sign in rather than offering a name with nowhere to go', () => {
    const { client } = fakeSupabase();
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: null };
    renderSettings();

    expect(screen.queryByLabelText('display name')).toBeNull();
    expect(screen.queryByText('Save name')).toBeNull();
    expect(
      screen.getByText(
        'Sign in above first — the name is stored against your account, so there is nowhere to keep it until then.',
      ),
    ).toBeTruthy();
  });
});

describe('Backup restore', () => {
  it('keeps core safety flags (pain hold, illness) after a full restore, not just workouts/sessions/settings', () => {
    seed({});
    renderSettings();

    const backup = {
      workouts: [],
      sessions: [],
      settings: {},
      core: {
        safety: {
          painHold: { active: true, areas: ['lower back'], updatedAt: 111 },
          illness: { status: 'active', updatedAt: 111 },
        },
      },
    };

    fireEvent.changeText(screen.getByLabelText('backup JSON'), JSON.stringify(backup));
    fireEvent.press(screen.getByText('Restore'));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText('Replace'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    act(() => buttons.find((b) => b.text === 'Replace')!.onPress!());

    expect(screen.getByText('Restored.')).toBeTruthy();

    // The store debounces its write — flush it before reading persisted().
    act(() => jest.advanceTimersByTime(500));
    const db = persisted();
    expect(db.core?.safety.painHold?.active).toBe(true);
    expect(db.core?.safety.painHold?.areas).toEqual(['lower back']);
    expect(db.core?.safety.illness?.status).toBe('active');
  });

  it('still restores workouts/sessions/settings for a backup with no core at all', () => {
    seed({});
    renderSettings();

    const backup = { workouts: [], sessions: [], settings: { profile: { age: '31' } } };
    fireEvent.changeText(screen.getByLabelText('backup JSON'), JSON.stringify(backup));
    fireEvent.press(screen.getByText('Restore'));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText('Replace'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    act(() => buttons.find((b) => b.text === 'Replace')!.onPress!());

    act(() => jest.advanceTimersByTime(500));
    const db = persisted();
    expect(db.settings.profile?.age).toBe('31');
  });
});

describe('RecoveryCard resync', () => {
  const label = (l: string) => screen.getByLabelText(l);

  afterEach(() => {
    // Fake timers are global (test/setup.ts) and persist across tests in this
    // file — leaving the clock parked in 2026-08 would silently date every
    // other suite that runs after this one.
    jest.setSystemTime(new Date());
  });

  it('drops a stale sleep-hours value at midnight rather than saving it in as the new day\'s check-in', () => {
    // Day 1: a manual check-in already exists with sleepHours 5.5.
    const day1 = new Date(2026, 7, 9, 20, 0, 0);
    jest.setSystemTime(day1);
    seed({
      core: {
        schemaVersion: 3,
        profile: {},
        goals: {},
        schedule: {},
        bodyMetrics: [],
        lifeLoad: [],
        recovery: [
          { id: 'manual-recovery-2026-08-09', date: '2026-08-09', sleepHours: 5.5, source: 'manual', recordedAt: day1.getTime() },
        ],
        safety: {},
        whoopDaily: [],
        events: [],
        updatedAt: day1.getTime(),
      } as never,
    });

    renderSettings();
    expect(label('Sleep hours').props.value).toBe('5.5');

    // Cross midnight into day 2, with no check-in yet for the new day, and
    // force a re-render (an unrelated store update, same as any other write
    // this screen already makes) — the same thing that happens when Settings
    // has simply been sitting open across the rollover.
    const day2 = new Date(2026, 7, 10, 0, 30, 0);
    act(() => {
      jest.setSystemTime(day2);
    });
    fireEvent.changeText(label('Age'), '31');

    // The form must now show TODAY's (day 2's) empty check-in, not day 1's
    // stale 5.5 — otherwise Save would write 5.5 back in as day 2's reading.
    expect(label('Sleep hours').props.value).toBe('');

    fireEvent.press(screen.getByText('Save today’s context'));
    act(() => jest.advanceTimersByTime(500));

    const db = persisted();
    const savedForDay2 = db.core?.recovery.find((r) => r.date === '2026-08-10' && r.source === 'manual');
    expect(savedForDay2).toBeTruthy();
    expect(savedForDay2?.sleepHours).toBeUndefined();
    // Day 1's real reading must survive untouched.
    const day1Entry = db.core?.recovery.find((r) => r.date === '2026-08-09' && r.source === 'manual');
    expect(day1Entry?.sleepHours).toBe(5.5);
  });
});

/*
 * WHAT YOUR COACH CAN SEE — the consent card, wired 15 August 2026.
 *
 * The rules worth failing a build over: an uncoached athlete is shown NOTHING
 * (there is no consent to express about a relationship that does not exist), a
 * failed write does not move the state on screen, and leaving is a control the
 * athlete can reach without their coach's agreement.
 */
describe('What your coach can see — the read grants', () => {
  const LINKED = {
    coach_athlete_assignments: { data: { organization_id: 'org-1', coach_user_id: 'coach-1' } },
    athlete_profiles: { data: { display_name: 'Coach Ada' } },
  };

  beforeEach(() => {
    resetArcRosterForTests();
    resetArcAssignmentsForTests();
    mockSupabaseClient = null;
    mockSyncOverride = null;
    seed({});
  });
  afterEach(() => {
    mockSyncOverride = null;
  });

  it('shows nothing at all to an athlete with no coach', async () => {
    const { client } = fakeSupabase({ profile: null });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.queryByText('What your coach can see')).toBeNull());
    expect(screen.queryByText('End the link with my coach')).toBeNull();
  });

  it('names the coach, and starts from NOT SHARED when there is no grant row', async () => {
    const { client } = fakeSupabase({ tables: LINKED });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.getByText(/You are coached by Coach Ada\./)).toBeTruthy());
    // Two rows, both off. Absence of a grant row is absence of a grant.
    expect(screen.getAllByText('Not shared. Your coach cannot see this.')).toHaveLength(2);
    expect(screen.getByLabelText('share Nutrition')).toBeTruthy();
    expect(screen.getByLabelText('share Readiness')).toBeTruthy();
  });

  it('reads a REVOKED row as not shared — the RPCs stamp, they do not delete', async () => {
    const { client } = fakeSupabase({
      tables: {
        ...LINKED,
        nutrition_read_grants: { data: { revoked_at: '2026-08-14T09:00:00Z' } },
        readiness_read_grants: { data: { revoked_at: null } },
      },
    });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.getByLabelText('share Nutrition')).toBeTruthy());
    expect(screen.getByLabelText('stop sharing Readiness')).toBeTruthy();
  });

  it('grants nutrition with no athlete id in the call, and says what is true now', async () => {
    const { client, rpcCalls } = fakeSupabase({ tables: LINKED, rpc: { data: { revoked_at: null } } });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.getByLabelText('share Nutrition')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('share Nutrition'));
    });

    expect(rpcCalls).toEqual([
      { fn: 'set_nutrition_read_grant', args: { p_organization_id: 'org-1', p_granted_to: 'coach-1', p_grant: true } },
    ]);
    expect(screen.getByText('Saved. Your coach can see this from now on.')).toBeTruthy();
    expect(screen.getByLabelText('stop sharing Nutrition')).toBeTruthy();
  });

  it('REVOKES readiness — taking it back is the same one press as giving it', async () => {
    const { client, rpcCalls } = fakeSupabase({
      tables: { ...LINKED, readiness_read_grants: { data: { revoked_at: null } } },
      rpc: { data: { revoked_at: '2026-08-15T12:00:00Z' } },
    });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.getByLabelText('stop sharing Readiness')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stop sharing Readiness'));
    });

    expect(rpcCalls).toEqual([
      { fn: 'set_readiness_read_grant', args: { p_organization_id: 'org-1', p_granted_to: 'coach-1', p_grant: false } },
    ]);
    expect(screen.getByText('Saved. Your coach can no longer see this.')).toBeTruthy();
    expect(screen.getByLabelText('share Readiness')).toBeTruthy();
  });

  /*
   * The one that matters most. A control that flips on screen and fails at the
   * server tells an athlete their food diary is private when it is not.
   */
  it('does NOT move the switch when the server refuses', async () => {
    const { client } = fakeSupabase({
      tables: { ...LINKED, nutrition_read_grants: { data: { revoked_at: null } } },
      rpc: { error: { message: 'not permitted' } },
    });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() => expect(screen.getByLabelText('stop sharing Nutrition')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stop sharing Nutrition'));
    });

    expect(screen.getByText(/Nothing changed\./)).toBeTruthy();
    // Still shared, because the server still says so.
    expect(screen.getByLabelText('stop sharing Nutrition')).toBeTruthy();
  });

  it('says plainly that a pain or illness flag is not one of these switches', async () => {
    const { client } = fakeSupabase({ tables: LINKED });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN };
    renderSettings();

    await waitFor(() =>
      expect(
        screen.getByText('A pain or illness flag is always visible to your coach. It is a safety signal, not a data share.'),
      ).toBeTruthy(),
    );
  });
});

describe('Ending the link — from the athlete’s own phone', () => {
  const LINKED = {
    coach_athlete_assignments: { data: { organization_id: 'org-1', coach_user_id: 'coach-1' } },
    athlete_profiles: { data: { display_name: 'Coach Ada' } },
  };

  beforeEach(() => {
    resetArcRosterForTests();
    resetArcAssignmentsForTests();
    mockSupabaseClient = null;
    mockSyncOverride = null;
    seed({});
  });
  afterEach(() => {
    mockSyncOverride = null;
  });

  it('confirms first, and states what happens to a week the coach already published', async () => {
    const { client } = fakeSupabase({ tables: LINKED, rpc: { data: { id: 'a-1' } } });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN, syncNow: jest.fn(() => Promise.resolve()) };
    renderSettings();

    await waitFor(() => expect(screen.getByText('End the link with my coach')).toBeTruthy());
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText('End the link with my coach'));

    const [title, body] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe('Stop being coached by Coach Ada?');
    expect(body).toMatch(/stays on this phone until the week is over/);
    alertSpy.mockRestore();
  });

  it('ends it as the athlete, and the card goes with the relationship', async () => {
    const { client, rpcCalls } = fakeSupabase({ tables: LINKED, rpc: { data: { id: 'a-1', status: 'revoked' } } });
    const syncNow = jest.fn(() => Promise.resolve());
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN, syncNow };
    renderSettings();

    await waitFor(() => expect(screen.getByText('End the link with my coach')).toBeTruthy());
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText('End the link with my coach'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    await act(async () => {
      buttons.find((b) => b.text === 'End it')!.onPress!();
    });
    alertSpy.mockRestore();

    expect(rpcCalls).toContainEqual({
      fn: 'end_coach_relationship',
      args: { p_organization_id: 'org-1', p_athlete_user_id: SIGNED_IN.id },
    });
    expect(syncNow).toHaveBeenCalled();
  });

  it('says the athlete is STILL LINKED when the server refuses', async () => {
    const { client } = fakeSupabase({ tables: LINKED, rpc: { error: { message: 'no active coaching relationship to end' } } });
    mockSupabaseClient = client;
    mockSyncOverride = { enabled: true, user: SIGNED_IN, syncNow: jest.fn(() => Promise.resolve()) };
    renderSettings();

    await waitFor(() => expect(screen.getByText('End the link with my coach')).toBeTruthy());
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText('End the link with my coach'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    await act(async () => {
      buttons.find((b) => b.text === 'End it')!.onPress!();
    });
    alertSpy.mockRestore();

    expect(screen.getByText(/You are still linked\./)).toBeTruthy();
    expect(screen.getByText('End the link with my coach')).toBeTruthy();
  });
});
