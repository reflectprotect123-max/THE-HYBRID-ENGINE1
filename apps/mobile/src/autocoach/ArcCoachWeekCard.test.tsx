import { screen } from '@testing-library/react-native';
import { type EngineDB, mondayOf, ymd } from '@hybrid/engine';
import { renderScreen, seed } from '../../test/harness';
import { NutritionProvider } from '../store/nutrition';
import { SyncProvider } from '../cloud/sync';
import { ArcCoachWeekCard, useCoachWeek } from './ArcCoachWeekCard';
import { HomeScreen } from '../screens/Home';

/*
 * What the athlete sees when their coach has published their week.
 *
 * These assert the rules the design doc puts on this surface.
 *
 * Two of them are GONE as of 14 August 2026, with `@hybrid/auto-coach`. They
 * asserted that a pain flag seeded in the athlete's own core reached the
 * athlete's eyes through the safety layer ("says WHY a session is held") and
 * that a FUTURE day carried no verdict, because today's flags are not
 * Thursday's. `resolveSession` was deliberately real in both, so they proved
 * the whole chain rather than that this file can render a string.
 *
 * They are not replaced. Nothing holds a session now, so there is no "why" to
 * say and no verdict to withhold from a future day. The pain-hold case that
 * remains below asserts the new truth directly: the flag is still in the
 * athlete's core, and the card says nothing about it.
 */

const MONDAY = mondayOf(ymd(new Date()));
const TODAY = ymd(new Date());

const coachWeekDb = (over: Partial<EngineDB> = {}): Partial<EngineDB> => ({
  workouts: [],
  sessions: [],
  settings: {},
  ecosystem: {
    schemaVersion: 1,
    core: undefined,
    partitions: {
      weeklyPlan: {
        schemaVersion: 1,
        domain: 'coordinator',
        revision: 4,
        updatedAt: Date.now(),
        writer: 'coach',
        data: {
          weekStart: MONDAY,
          plan: {
            days: [
              { date: TODAY, sessions: [{ name: 'Squat + carries', kind: 'strength', blocks: [] }] },
            ],
          },
        },
      },
    },
    events: [],
  },
  ...over,
} as unknown as Partial<EngineDB>);

/* Same provider stack, in App.tsx's real order, as screens.test.tsx's
   renderHome — the card reads useSync (attribution) and SyncProvider itself
   reads useNutrition. With no Supabase client both sit inert at "signed out",
   which is what these want: it proves the WEEK renders from the store alone,
   with no network. */
const renderCard = () =>
  renderScreen(
    <NutritionProvider>
      <SyncProvider>
        <CoachWeekUnderTest />
      </SyncProvider>
    </NutritionProvider>,
  );

/** The card takes its week as a prop; `useCoachWeek` is how Home gets one.
 *  Composing them exactly as Home does keeps the two in step. */
function CoachWeekUnderTest() {
  const week = useCoachWeek();
  return week ? <ArcCoachWeekCard week={week} /> : null;
}

const renderHome = () =>
  renderScreen(
    <NutritionProvider>
      <SyncProvider>
        <HomeScreen />
      </SyncProvider>
    </NutritionProvider>,
  );

describe("a coach's published week", () => {
  it('renders as the athlete’s week, attributed to a coach rather than to the app', () => {
    seed(coachWeekDb());
    renderCard();
    expect(screen.getByText(/Your coach.s week/)).toBeTruthy();
    // No name is readable from the phone today (athlete_profiles_read grants
    // an athlete their own row and their coach's athletes, not their coach) —
    // so it is attributed by ROLE, which is true, rather than by an invented
    // name. See the note on readCoachWeekAttribution.
    expect(screen.getByText(/Published by your coach/)).toBeTruthy();
    expect(screen.getByText('Squat + carries')).toBeTruthy();
  });

  it('offers NO accept and NO decline', () => {
    // This is not the assignment flow. The consent boundary is the roster link
    // the athlete redeemed; a published week is not renegotiated session by
    // session. ArcAssignmentCard's shape must not leak in here.
    seed(coachWeekDb());
    renderCard();
    expect(screen.queryByText('Accept')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
  });

  it('does not imply the athlete may only train what the coach wrote', () => {
    seed(coachWeekDb());
    renderCard();
    expect(screen.getByText(/You can still\s+train anything else you like/)).toBeTruthy();
  });

  it('says NOTHING about a live pain hold — nothing stops a session any more', () => {
    /* The same seed the deleted "says WHY a session is held" case used: a real
       pain hold in the athlete's own shared core, which whole-athlete-state
       still turns into a hard constraint. Until 14 August 2026 the card printed
       "Held today — Squat + carries" and the reason beneath it.

       The owner deleted `@hybrid/auto-coach` including the safety stop, having
       been told that is what it meant. This asserts the consequence rather than
       leaving it to be discovered on a phone: the session is listed as an
       ordinary session, and the hold is invisible here. */
    seed(
      coachWeekDb({
        core: {
          safety: { painHold: { active: true, areas: ['left knee'], updatedAt: Date.now() } },
        },
      } as unknown as Partial<EngineDB>),
    );
    renderCard();
    expect(screen.getByText('Squat + carries')).toBeTruthy();
    expect(screen.queryByText(/Held today/)).toBeNull();
    expect(screen.queryByText(/Pain hold/)).toBeNull();
  });

  it('no longer promises that a flag stops a session', () => {
    /* The closing line said "a pain or illness flag still stops a session,
       whoever planned it." That was true when written and is not now, and a
       card that keeps promising a stop nothing performs is the worst of the
       available states. */
    seed(coachWeekDb());
    renderCard();
    expect(screen.queryByText(/pain or illness flag still stops/)).toBeNull();
    expect(screen.getByText(/you decide whether a session runs today/)).toBeTruthy();
  });
});

/*
 * REWRITTEN 14 August 2026, when the Coordinator was deleted.
 *
 * These two asserted the two halves of one rule: a coach's published week
 * REPLACES the Coordinator's card rather than sitting beside it, and an
 * athlete nobody coaches still gets the Coordinator's. The first half is
 * unchanged and still the point — Home must never show two answers to "what
 * am I doing this week".
 *
 * The second half no longer has a Coordinator to fall back to. It is kept,
 * inverted, because the FALLBACK IS THE PART THAT CHANGED and a deleted test
 * would leave that silent: an uncoached athlete is now told no week has been
 * published, which is a real screen state someone could regress into showing
 * a blank card or a spinner.
 */
describe('Home shows ONE week', () => {
  it('replaces the empty-week card when a coach has published', () => {
    seed(coachWeekDb());
    renderHome();
    expect(screen.getByText(/Your coach.s week/)).toBeTruthy();
    expect(screen.queryByText(/No week has been published/)).toBeNull();
  });

  it('says so plainly for an athlete nobody coaches, rather than falling back', () => {
    seed({ workouts: [], sessions: [], settings: {} });
    renderHome();
    expect(screen.getByText(/No week has been published for you/)).toBeTruthy();
    expect(screen.queryByText(/Your coach.s week/)).toBeNull();
    /* The Coordinator's card said "Coordinated week" here. Nothing may
       reintroduce it: there is no Coordinator to compute one. */
    expect(screen.queryByText('Coordinated week')).toBeNull();
  });
});
