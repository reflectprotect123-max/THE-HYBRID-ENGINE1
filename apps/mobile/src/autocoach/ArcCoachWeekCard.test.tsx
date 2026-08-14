import { screen } from '@testing-library/react-native';
import { type EngineDB, mondayOf, ymd } from '@hybrid/engine';
import { renderScreen, seed } from '../../test/harness';
import { NutritionProvider } from '../store/nutrition';
import { SyncProvider } from '../cloud/sync';
import { resetPolicyForTests } from './policy';
import { ArcCoachWeekCard, useCoachWeek } from './ArcCoachWeekCard';
import { HomeScreen } from '../screens/Home';

/*
 * What the athlete sees when their coach has published their week.
 *
 * These assert the four rules the design doc puts on this surface, and they
 * are deliberately NOT tests of the safety resolver — that has its own, in
 * @hybrid/auto-coach. `resolveSession` is real here on purpose: the point of
 * the held-session test is that a pain flag seeded in the athlete's own core
 * reaches the athlete's eyes THROUGH the untouched safety layer, and a mocked
 * resolver would prove only that this file can render a string.
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

beforeEach(() => resetPolicyForTests());

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

  it('says WHY a session is held, rather than dropping it silently', () => {
    // A real pain hold in the athlete's own shared core. Nothing in this file
    // decides anything about it: whole-athlete-state turns it into a hard
    // constraint, @hybrid/auto-coach's resolver turns that into a safety_stop,
    // and the card prints the words those layers chose.
    seed(
      coachWeekDb({
        core: {
          safety: { painHold: { active: true, areas: ['left knee'], updatedAt: Date.now() } },
        },
      } as unknown as Partial<EngineDB>),
    );
    renderCard();
    expect(screen.getByText(/Held today — Squat \+ carries/)).toBeTruthy();
    expect(screen.getByText(/Pain hold: left knee/)).toBeTruthy();
  });

  it('says nothing about a FUTURE day, because today’s flags are not Thursday’s', () => {
    const later = new Date();
    later.setDate(later.getDate() + 3);
    seed(
      coachWeekDb({
        core: {
          safety: { painHold: { active: true, areas: ['left knee'], updatedAt: Date.now() } },
        },
        ecosystem: {
          schemaVersion: 1,
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
                  days: [{ date: ymd(later), sessions: [{ name: 'Later session', blocks: [] }] }],
                },
              },
            },
          },
          events: [],
        },
      } as unknown as Partial<EngineDB>),
    );
    renderCard();
    expect(screen.getByText('Later session')).toBeTruthy();
    expect(screen.queryByText(/Held today/)).toBeNull();
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
