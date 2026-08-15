import type { Workout } from '@hybrid/engine';
import type { AthleteAutocoachReceipt, CoachWeekBody, CoachWeekDay } from './contracts';
import type { DayBuilderValue } from '../library/DayBuilder';
import { dayBuilderToWorkouts, workoutsToDayBuilder } from '../library/day-workout';

/*
 * The coach's week, as data — everything about the week builder that can be
 * decided without a screen.
 *
 * It is its own module for the reason every other pure module here is: the
 * shape a coach publishes is the shape an athlete's device reads, and a rule
 * about it that lives inside a component is a rule that can only be tested by
 * rendering. Every function below is a value in and a value out.
 *
 * THE BODY SHAPE, AND WHY THIS ONE
 *
 *   { schema: 'coach-week/1',
 *     weekStart: '2026-08-10',
 *     days: [ { date: '2026-08-10', sessions: [Workout, …] }, … seven … ] }
 *
 * `publish_coach_week` takes `p_body jsonb` and constrains it to an OBJECT and
 * nothing more (`coach_week_version_object`), so the shape is this repository's
 * to define — and it is written into two places at once: the immutable version
 * row AND `athlete_weekly_plans.plan`, the row the athlete's device reads. So
 * it has to be self-describing (`schema`), self-locating (`weekStart`, so a row
 * read out of context still knows which week it is), and made of records the
 * rest of the system already understands.
 *
 * The sessions are engine `Workout`s — the exact records the day builder
 * already writes into `EngineDB.workouts` (`library/day-workout.ts`). A second
 * session shape invented for the wire is how two halves of one system start
 * disagreeing about what a session is; there is no translation here for the
 * same reason there is no second store there.
 *
 * A DAY HOLDS A LIST, not one session. `dayBuilderToWorkouts` already splits a
 * mixed day into a strength record and its conditioning sibling, so "zero or
 * more" is the truth even before a coach asks for two sessions in a day.
 *
 * ALWAYS SEVEN DAYS, including the empty ones. A rest day that is present and
 * empty is a coaching decision; a rest day that is missing from the array is
 * indistinguishable from a day that was lost in transit.
 */

/** Monday-first, matching `week_start` and the `isodow = 1` constraint. */
export const WEEK_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const SCHEMA = 'coach-week/1' as const;

/** True only for a real ISO date that is a Monday. `publish_coach_week` raises
 *  `week must start on a Monday`; refusing here is about not sending a call
 *  that cannot succeed, never about trusting the client instead of the server. */
export function isMonday(weekStart: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return false;
  const date = new Date(`${weekStart}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 1;
}

/** The week's seven dates, Monday first. UTC throughout — a local-time
 *  arithmetic here shifts a whole week by a day for anyone east of Greenwich. */
export function weekDates(weekStart: string): string[] {
  const start = new Date(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 7 }, (_unused, index) => {
    const day = new Date(start.getTime());
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

/**
 * The Monday on or before a LOCAL calendar date, as `YYYY-MM-DD`.
 *
 * This exists because three screens hand-rolled it and all three got it wrong
 * the same way (14 August 2026). The bug is worth naming, because it looks
 * right and is invisible to anyone developing at UTC or behind it:
 *
 *     const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
 *     copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
 *     return copy.toISOString().slice(0, 10);   // <- the mistake
 *
 * The arithmetic is fine. The FORMATTING is not: `toISOString` converts to UTC
 * first, so a local midnight in any UTC+ zone reads back as the previous day.
 * `mondayOf(19 Aug 2026)` returned `2026-08-16` — a Sunday — in London, Berlin
 * and Sydney, and `2026-08-17` in Los Angeles. `isMonday` then correctly
 * refused it, so the ONLY link into the week builder was a dead end for every
 * coach east of Greenwich, and `get_athlete_week_plan` matched no row.
 *
 * So the rule for this module: pick the day from LOCAL components, and print
 * it from LOCAL components. Never round-trip a wall-clock date through UTC.
 * (`weekDates` above is UTC throughout and correct — it starts from an ISO
 * string that is already a date, not from a moment in time. Both are right;
 * what breaks is mixing them.)
 */
export function weekStartOfLocalDate(date: Date): string {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * "Monday 10 August 2026 to Sunday 16 August 2026".
 *
 * Spelled out in full, both ends, because this is what the publish
 * confirmation names alongside the athlete. A confirmation that says "this
 * week" is not a confirmation.
 */
export function formatWeekRange(weekStart: string): string {
  const dates = weekDates(weekStart);
  return `${longDate(dates[0])} to ${longDate(dates[6])}`;
}

export function emptyWeekBody(weekStart: string): CoachWeekBody {
  return {
    schema: SCHEMA,
    weekStart,
    days: weekDates(weekStart).map((date) => ({ date, sessions: [] })),
  };
}

/**
 * A body read back from the server, normalised.
 *
 * `body` is unconstrained jsonb — the migration's own comment calls that shape
 * "the exact shape that crashed the training-summary projection before a
 * jsonb_typeof guard was added there". This is that guard on the client side:
 * anything unrecognised degrades to an empty day rather than reaching a
 * renderer, and the result is ALWAYS the seven days of `weekStart`, in order,
 * whatever the stored array happened to contain.
 */
export function coachWeekBodyFrom(value: unknown, weekStart: string): CoachWeekBody {
  const raw = (value ?? {}) as { days?: unknown };
  const stored = new Map<string, CoachWeekDay>();
  if (Array.isArray(raw.days)) {
    for (const entry of raw.days) {
      const day = entry as { date?: unknown; sessions?: unknown };
      if (typeof day?.date !== 'string') continue;
      const sessions = Array.isArray(day.sessions)
        ? (day.sessions.filter((s) => typeof s === 'object' && s !== null) as Workout[])
        : [];
      stored.set(day.date, { date: day.date, sessions });
    }
  }
  return {
    schema: SCHEMA,
    weekStart,
    days: weekDates(weekStart).map((date) => stored.get(date) ?? { date, sessions: [] }),
  };
}

/** A stable per-day workout id. Derived from the week and the weekday rather
 *  than minted, so republishing an edited week updates the athlete's Tuesday
 *  instead of leaving them two of them. */
export function weekDayWorkoutId(weekStart: string, index: number): string {
  return `coach-week-${weekStart}-${index}`;
}

/** What the seven editors currently hold, as the body that gets published. */
export function weekBodyFromDays(weekStart: string, days: readonly DayBuilderValue[]): CoachWeekBody {
  const dates = weekDates(weekStart);
  return {
    schema: SCHEMA,
    weekStart,
    days: dates.map((date, index) => {
      const value = days[index] ?? { instructions: '', blocks: [] };
      /* An untouched day publishes as an empty day, not as one empty workout.
         `dayBuilderToWorkouts` returns a blank record for a blank value — right
         for a calendar day the coach opened, wrong for a rest day they never
         touched, which would arrive on the phone as a session with nothing in
         it. */
      const empty = value.blocks.length === 0 && value.instructions.trim() === '';
      return {
        date,
        sessions: empty
          ? []
          : dayBuilderToWorkouts(value, {
              id: weekDayWorkoutId(weekStart, index),
              date,
              name: `${WEEK_DAY_LABELS[index]} · ${date}`,
            }),
      };
    }),
  };
}

/** The body, back in the seven editors' shape. */
export function daysFromWeekBody(body: CoachWeekBody | null, weekStart: string): DayBuilderValue[] {
  const source = body ?? emptyWeekBody(weekStart);
  return weekDates(weekStart).map((date) => {
    const day = source.days.find((d) => d.date === date);
    if (!day || day.sessions.length === 0) return { instructions: '', blocks: [] };
    return workoutsToDayBuilder(day.sessions);
  });
}

/**
 * The idempotency key for one publish.
 *
 * Derived from the week, the base version and a hash of the BODY — so pressing
 * Publish twice on the same week is one publish (the RPC replays the original
 * version), while a genuine edit is a genuinely different key. A key that
 * omitted the body would make a corrected week silently replay the wrong one
 * and report success, which is the single failure a coach cannot see from the
 * screen.
 */
export function publishIdempotencyKey(body: CoachWeekBody, baseVersion: number): string {
  return `${body.weekStart}:${baseVersion}:${hash(JSON.stringify(body))}`;
}

/** djb2. Not a cryptographic hash and not used as one — this only has to
 *  change when the body changes. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * What one day of a published week is doing.
 *
 * `held-pain` and `held-illness` were named, labelled and rendered before
 * anything produced them, because that design's sharpest line is that "a coach
 * who cannot tell 'held for injury' from 'ignored me' will distrust the whole
 * system within a week" — a `not-done` that is really a safety hold is the
 * exact lie the two states exist to prevent.
 *
 * They are now PRODUCED. `heldDaysFromReceipts` below turns the athlete's own
 * auto-coach receipts (`action: 'held'`, carried by
 * `supabase/migrations/20260814_arc_held_session_receipt.sql`) into the `held`
 * argument `coachWeekDayState` already accepted.
 */
export type CoachWeekDayState =
  | 'rest'
  | 'unpublished'
  | 'published'
  | 'completed'
  | 'not-done'
  | 'held-pain'
  | 'held-illness';

export const DAY_STATE_LABEL: Record<CoachWeekDayState, string> = {
  rest: 'Rest',
  unpublished: 'Not published',
  published: 'Published',
  completed: 'Completed',
  'not-done': 'Not done',
  'held-pain': 'Held · pain',
  'held-illness': 'Held · illness',
};

/** The states that read as "this went well" — the only ones that get the
 *  stylesheet's green `.cb-status.published` treatment. A held day is NOT one
 *  of them and must never be coloured as one. */
export const DAY_STATE_IS_GOOD: Record<CoachWeekDayState, boolean> = {
  rest: false,
  unpublished: false,
  published: true,
  completed: true,
  'not-done': false,
  'held-pain': false,
  'held-illness': false,
};

export function coachWeekDayState({
  hasSessions,
  published,
  sessionStatuses,
  date,
  today,
  /* The safety verdict for this day, from `heldDaysFromReceipts` — a FACT the
     athlete's device recorded, never something derived from a missing session,
     which would be precisely the "ignored me" reading the design forbids. It
     outranks everything below it, exactly as a pain or illness flag outranks a
     readiness score everywhere else. Absent (`null`/omitted) means "no such
     fact", which is not the same as "nothing was held" and must never be
     rendered as one. */
  held,
}: {
  hasSessions: boolean;
  published: boolean;
  sessionStatuses: readonly string[];
  date: string;
  today: string;
  held?: 'pain' | 'illness' | null;
}): CoachWeekDayState {
  if (held === 'pain') return 'held-pain';
  if (held === 'illness') return 'held-illness';
  if (!hasSessions) return 'rest';
  if (!published) return 'unpublished';
  if (sessionStatuses.includes('completed')) return 'completed';
  /* "Not done" is only true once the day is OVER. A Thursday session on a
     Tuesday is published, not missed, and saying otherwise puts a red mark
     against an athlete who has done nothing wrong. */
  return date < today ? 'not-done' : 'published';
}

/**
 * The publish failure, in the coach's language.
 *
 * The two the RPC raises deliberately are the two worth translating: a stale
 * base version means a colleague published in between and this coach's week
 * was NOT written, and `not permitted` is the same message whether the
 * organisation, the athlete or the coaching relationship is what is missing
 * (distinguishing them server-side would let a caller enumerate athletes, so
 * this must not pretend to know either).
 */
export function publishFailureMessage(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  const text = typeof message === 'string' ? message : '';
  if (text.includes('modified by someone else')) {
    return 'This week changed while you were editing it, so nothing was published. Reload it, re-apply your changes and publish again.';
  }
  if (text.includes('not permitted')) {
    return 'This athlete cannot be published to from this account. Nothing has changed.';
  }
  if (text.includes('Monday')) {
    return 'A published week has to start on a Monday. Nothing has changed.';
  }
  return 'The week was not published. Nothing has changed — try again.';
}

/* --------------------------------------------------------------------------
 * HELD SESSIONS, ON THE COACH'S WEEK — step 5 of
 * docs/superpowers/specs/2026-08-13-coach-publishes-the-week-design.md.
 *
 * The athlete's device resolves each of the coach's sessions through
 * `@hybrid/auto-coach`'s `resolveSession`; a `safety_stop` is pushed as an
 * auto-coach receipt with `action: 'held'` and the flag that caused it. The
 * coach reads those back through `get_athlete_autocoach_receipts`. Everything
 * below is the translation from that list to what one day column says.
 * ----------------------------------------------------------------------- */

/** The two reason codes the safety layer stops a session with. Both have been
 *  in `push_autocoach_receipt`'s closed vocabulary since 8 August 2026. */
const PAIN_CODE = 'pain_hold_active';
const ILLNESS_CODE = 'illness_flag_active';

/**
 * What the coach is told about a held day.
 *
 * `sessionName` is resolved LOCALLY, from the week this coach published. No
 * name travels on the receipt — it carries a `workoutId` and nothing else
 * about the session — which is the same boundary every roster read tier holds:
 * block and set level content never crosses, and a session name is not
 * smuggled across in a field that exists for an id.
 */
export interface HeldDay {
  reason: 'pain' | 'illness';
  sessionName: string;
}

/** What a session is called when the id on the receipt matches nothing in the
 *  published week — an athlete on an older version, or a session the coach has
 *  since edited out. Deliberately a phrase and not a raw id: an id is not a
 *  name, and showing one would be showing the coach a debugging artefact. */
export const UNNAMED_HELD_SESSION = 'a session';

/**
 * `pain` beats `illness` when both codes are on one receipt.
 *
 * Null for a held receipt carrying NEITHER — which the server's vocabulary
 * permits (a raw RPC call could pair `action: 'held'` with, say,
 * `low_readiness`) and which this refuses to attribute. `CoachWeekDayState`
 * has exactly two held states and both name a specific safety flag; picking
 * one of them here would be inventing a medical fact about a person from a
 * receipt that did not state it, which is worse than the day showing its
 * ordinary state. Such a receipt is dropped, and it is the one case where
 * this function is knowingly quieter than the truth.
 */
function heldReason(reasonCodes: readonly string[]): 'pain' | 'illness' | null {
  if (reasonCodes.includes(PAIN_CODE)) return 'pain';
  if (reasonCodes.includes(ILLNESS_CODE)) return 'illness';
  return null;
}

/**
 * The coach's own name for `workoutId`, out of the week they published.
 *
 * Searches the WHOLE week rather than only the receipt's day: the day comes
 * from `sessionDate`, the name from the id, and a session the athlete reached
 * on a different date is still the session the coach wrote. Falls back to
 * `UNNAMED_HELD_SESSION` rather than inventing one or printing the id.
 */
export function heldSessionName(body: CoachWeekBody | null, workoutId: string): string {
  for (const day of body?.days ?? []) {
    for (const session of day.sessions ?? []) {
      if ((session as { id?: unknown }).id !== workoutId) continue;
      const name = (session as { name?: unknown }).name;
      return typeof name === 'string' && name.trim() !== '' ? name.trim() : UNNAMED_HELD_SESSION;
    }
  }
  return UNNAMED_HELD_SESSION;
}

/**
 * The held days of one week, keyed by date.
 *
 * ABSENT IS NOT A FACT. `null` receipts — no roster, no backend, a read that
 * failed — produce an empty result, so every day falls back to the state it
 * would have had, and nothing on the screen implies a session ran OR was held.
 * That is the whole reason this takes `null` rather than defaulting to `[]` at
 * the call site: the two are the same answer here on purpose, and the caller
 * is not asked to decide which it had.
 *
 * Only `action: 'held'` is read. An `applied` or `undone` receipt is auto-coach
 * modifying a session the athlete then trained, which is not a hold and must
 * never be shown as one.
 *
 * Two held receipts on one day resolve the same way two codes on one receipt
 * do: pain outranks illness. A day with both flags is a day with a pain flag.
 */
export function heldDaysFromReceipts(
  receipts: readonly AthleteAutocoachReceipt[] | null | undefined,
  body: CoachWeekBody | null,
  weekStart: string,
): Record<string, HeldDay> {
  const inWeek = new Set(weekDates(weekStart));
  const out: Record<string, HeldDay> = {};
  for (const receipt of receipts ?? []) {
    if (receipt.action !== 'held') continue;
    if (!inWeek.has(receipt.sessionDate)) continue;
    const reason = heldReason(receipt.reasonCodes ?? []);
    if (!reason) continue;
    const existing = out[receipt.sessionDate];
    if (existing && !(existing.reason === 'illness' && reason === 'pain')) continue;
    out[receipt.sessionDate] = { reason, sessionName: heldSessionName(body, receipt.workoutId) };
  }
  return out;
}
