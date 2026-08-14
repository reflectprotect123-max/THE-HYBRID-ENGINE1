import type { SupabaseClient } from '@supabase/supabase-js';
import type { EcosystemSyncNamespace } from '@hybrid/shared-core';
import {
  coachSessionAsWorkout,
  coachWeekFromNamespace,
  dayOfWeek,
  readCoachWeekAttribution,
  sanitizeCoachWeekBody,
} from './arc-coach-week';
import { resetArcRosterForTests } from './arc-roster';

/*
 * A coach-published week, read on the phone.
 *
 * The network is faked; what these assert is the AUTHORITY rule and the
 * defensive rule around it — that only `writer = 'coach'` is rendered as a
 * coach's week, that a stale week is not shown under this week's heading, and
 * that a body which is not a week is dropped rather than half-trusted.
 */

const MONDAY = '2026-08-17';

const session = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  kind: 'strength',
  blocks: [],
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  days: [
    { date: MONDAY, sessions: [session('Squat day')] },
    { date: '2026-08-19', sessions: [session('Intervals', { kind: 'conditioning' })] },
  ],
  ...over,
});

const namespace = (partition: unknown): EcosystemSyncNamespace =>
  ({ partitions: { weeklyPlan: partition } } as unknown as EcosystemSyncNamespace);

const coachPartition = (data: unknown, writer = 'coach') => ({
  schemaVersion: 1,
  domain: 'coordinator',
  revision: 3,
  updatedAt: 1,
  writer,
  data,
});

describe('sanitizeCoachWeekBody', () => {
  it('reads the seven days into dated sessions', () => {
    const week = sanitizeCoachWeekBody(MONDAY, body());
    expect(week?.weekStart).toBe(MONDAY);
    expect(week?.sessions.map((s) => [s.date, s.name, s.kind])).toEqual([
      [MONDAY, 'Squat day', 'strength'],
      ['2026-08-19', 'Intervals', 'conditioning'],
    ]);
  });

  it('takes a day with no date of its own from its POSITION in the week', () => {
    const week = sanitizeCoachWeekBody(MONDAY, {
      days: [{ sessions: [] }, { sessions: [session('Tuesday')] }],
    });
    expect(week?.sessions[0].date).toBe('2026-08-18');
  });

  it('clamps a date that falls outside the week it was published for', () => {
    // Trusting the writer here would put a coach's session on a day the
    // athlete cannot reconcile with the week they were told they are looking
    // at. The position is the fallback, and it is always inside the week.
    const week = sanitizeCoachWeekBody(MONDAY, {
      days: [{ date: '2027-01-01', sessions: [session('Wrong year')] }],
    });
    expect(week?.sessions[0].date).toBe(MONDAY);
  });

  it('drops a session with no blocks array, and keeps the rest of the day', () => {
    const week = sanitizeCoachWeekBody(MONDAY, {
      days: [{ date: MONDAY, sessions: [{ name: 'Not a session' }, session('Real')] }],
    });
    expect(week?.sessions.map((s) => s.name)).toEqual(['Real']);
  });

  it('refuses input that is not a week at all', () => {
    expect(sanitizeCoachWeekBody(MONDAY, null)).toBeNull();
    expect(sanitizeCoachWeekBody(MONDAY, { label: 'no days' })).toBeNull();
    expect(sanitizeCoachWeekBody('not-a-date', body())).toBeNull();
  });

  it('reads the writer’s real `coach-week/1` body — seven days, engine Workouts, empties included', () => {
    // The shape apps/web/src/coach/coach-week.ts publishes. Sessions on the
    // wire are engine `Workout`s, so their own id is used rather than a
    // positional one, and a present-but-empty rest day is a coaching decision
    // that must not become a missing day.
    const week = sanitizeCoachWeekBody(MONDAY, {
      schema: 'coach-week/1',
      weekStart: MONDAY,
      days: [
        { date: MONDAY, sessions: [{ id: 'w-1', name: 'Lower', kind: 'strength', blocks: [] }] },
        { date: '2026-08-18', sessions: [] },
        { date: '2026-08-19', sessions: [] },
        { date: '2026-08-20', sessions: [] },
        { date: '2026-08-21', sessions: [] },
        { date: '2026-08-22', sessions: [] },
        { date: '2026-08-23', sessions: [] },
      ],
    });
    expect(week?.sessions).toEqual([
      { id: 'w-1', date: MONDAY, name: 'Lower', kind: 'strength', blocks: [] },
    ]);
  });

  it('reads the migration check’s placeholder body as an empty week, not a crash', () => {
    // `checks/migrations-apply.mjs` publishes `{ label, days: [] }`.
    const week = sanitizeCoachWeekBody(MONDAY, { label: 'v1', days: [] });
    expect(week).toEqual({ weekStart: MONDAY, sessions: [] });
  });

  it('treats an EMPTY published week as a real answer, not as absence', () => {
    // A coach who published a deload with nothing in it said something; the
    // athlete must see the coach's empty week rather than fall back to the
    // Coordinator's opinion of the same days.
    const week = sanitizeCoachWeekBody(MONDAY, { days: [] });
    expect(week).not.toBeNull();
    expect(week?.sessions).toEqual([]);
  });
});

describe('coachWeekFromNamespace', () => {
  it('renders a coach-written week', () => {
    const week = coachWeekFromNamespace(
      namespace(coachPartition({ weekStart: MONDAY, plan: body() })),
      MONDAY,
    );
    expect(week?.sessions).toHaveLength(2);
  });

  it('REFUSES a coordinator-written week', () => {
    // This device's own Coordinator output round-trips through the same row.
    // Rendering it as "your coach's week" would attribute the app's own
    // arrangement to a person.
    const week = coachWeekFromNamespace(
      namespace(coachPartition({ weekStart: MONDAY, plan: body() }, 'coordinator')),
      MONDAY,
    );
    expect(week).toBeNull();
  });

  it('refuses a coach week published for a DIFFERENT week', () => {
    // The pull takes `order by week_start desc limit 1`, so the partition
    // holds one week and it may be last week's.
    const week = coachWeekFromNamespace(
      namespace(coachPartition({ weekStart: '2026-08-10', plan: body() })),
      MONDAY,
    );
    expect(week).toBeNull();
  });

  it('is null when there is no weekly-plan partition at all', () => {
    expect(coachWeekFromNamespace(namespace(undefined), MONDAY)).toBeNull();
    expect(coachWeekFromNamespace(undefined, MONDAY)).toBeNull();
  });
});

describe('dayOfWeek', () => {
  it('walks the week as calendar dates', () => {
    expect(dayOfWeek(MONDAY, 0)).toBe(MONDAY);
    expect(dayOfWeek(MONDAY, 6)).toBe('2026-08-23');
  });
});

describe('coachSessionAsWorkout', () => {
  it('shapes a coach session for the safety resolver without inventing a domain', () => {
    const week = sanitizeCoachWeekBody(MONDAY, {
      days: [{ date: MONDAY, sessions: [{ name: 'Unlabelled', blocks: [] }] }],
    });
    const w = coachSessionAsWorkout(week!.sessions[0]);
    expect(w.kind).toBeUndefined();
    expect(w.dates).toEqual([MONDAY]);
  });
});

/* ---- attribution ------------------------------------------------------- */

type Row = Record<string, unknown>;
interface TableResult {
  data: Row[] | Row | null;
  error: unknown;
}

/** Same thenable PostgREST shim as arc-roster.test.ts, kept beside its own
 *  module for the same reason: neither suite may be broken by a change made
 *  for the other. */
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

function fakeClient(tables: Record<string, TableResult>) {
  const fromCalls: string[] = [];
  const client = {
    from(table: string) {
      fromCalls.push(table);
      return builder(tables[table] ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { client, fromCalls };
}

describe('readCoachWeekAttribution', () => {
  beforeEach(() => resetArcRosterForTests());

  it('names the coach through the ONE display-name path', () => {
    const { client, fromCalls } = fakeClient({
      coach_week_plans: { data: { coach_user_id: 'coach-1' }, error: null },
      athlete_profiles: { data: { display_name: 'Dana Coach' }, error: null },
    });
    return readCoachWeekAttribution(client, 'athlete-1', MONDAY).then((a) => {
      expect(a).toEqual({ coachUserId: 'coach-1', coachName: 'Dana Coach' });
      // Through arc-roster's getDisplayName, not a second read of its own.
      expect(fromCalls).toEqual(['coach_week_plans', 'athlete_profiles']);
    });
  });

  it('keeps the coach id when the NAME is refused, and invents nothing', () => {
    // The live case: `athlete_profiles_read` grants self, or an athlete of
    // mine. An athlete reading their coach's row matches neither, so the name
    // is null in production today. Absence stays absence.
    const { client } = fakeClient({
      coach_week_plans: { data: { coach_user_id: 'coach-1' }, error: null },
      athlete_profiles: { data: null, error: { message: 'refused' } },
    });
    return readCoachWeekAttribution(client, 'athlete-1', MONDAY).then((a) => {
      expect(a).toEqual({ coachUserId: 'coach-1', coachName: null });
    });
  });

  it('is null, not an error, for an athlete with no published week', () => {
    const { client } = fakeClient({ coach_week_plans: { data: null, error: null } });
    return readCoachWeekAttribution(client, 'athlete-1', MONDAY).then((a) => {
      expect(a).toBeNull();
    });
  });

  it('is null when the read itself fails', () => {
    const { client } = fakeClient({
      coach_week_plans: { data: null, error: { message: 'offline' } },
    });
    return readCoachWeekAttribution(client, 'athlete-1', MONDAY).then((a) => {
      expect(a).toBeNull();
    });
  });
});
