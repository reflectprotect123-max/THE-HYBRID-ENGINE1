/*
 * The training model, typed.
 *
 * These shapes are contractual across three surfaces — the athlete app, the
 * coach builder, and the Supabase rows that carry a session between them — so
 * a rename here is a data migration, not a refactor. In particular:
 *
 *   A PLANNED SET IS EXACTLY { t, rpe }.
 *
 * `t` is the target (reps, seconds, 'max', or a warm-up marker like 'W10') and
 * `rpe` is the target RPE. Everything the athlete records lives in the separate
 * `LoggedSet` fields. Two test suites assert this split, because the moment a
 * coach-authored set can carry an `aVal`, publishing a plan can overwrite an
 * athlete's logged work.
 */

export type ModeKey = 'reps_kg' | 'amrap' | 'seconds' | 'reps_seconds' | 'reps' | 'completion';
export type CondFmtKey = 'steady' | 'intervals' | 'tempo' | 'custom' | 'free';
export type ZoneKey = 'low' | 'mod' | 'high';
export type EffortKey = 'easy' | 'medium' | 'hard';
export type RecoveryBand = 'good' | 'watch' | 'low';

/** What a coach or planner authors. Never carries logged values. */
export interface PlannedSet {
  t: string;
  rpe: string;
}

/** A set as the logger leaves it. `aVal`/`aVal2` are the recorded values. */
export interface LoggedSet extends PlannedSet {
  /** primary recorded value — kg for reps_kg, seconds for seconds, … */
  aVal?: string;
  /** secondary recorded value — reps, when the mode has two */
  aVal2?: string;
  /** the athlete's rating of the set, on the same 1–10 slider as `rpe` */
  felt?: string;
  done?: boolean;
  note?: string;
}

export type AnySet = PlannedSet | LoggedSet;

export interface Exercise<S extends AnySet = LoggedSet> {
  id: string;
  name: string;
  mode: ModeKey;
  sets: S[];
  /** seconds */
  rest?: number;
  tempo?: string;
  /** free text from the coach, shown on the logger stage */
  cue?: string;
}

export interface StrengthBlock<S extends AnySet = LoggedSet> {
  id: string;
  kind?: undefined;
  heading?: string;
  minutes?: number | string;
  format?: string;
  superset?: boolean;
  exercises: Exercise<S>[];
}

export interface CondBlock {
  id: string;
  kind: 'conditioning';
  heading?: string;
  condFmt: CondFmtKey;
  /** what the coach authored */
  effort?: EffortKey;
  /** kept in lockstep with `effort` so older read paths still work */
  targetZone?: ZoneKey;
  minutes?: number | string;
  exercises?: undefined;
  condResult?: CondResult;
}

export type Block<S extends AnySet = LoggedSet> = StrengthBlock<S> | CondBlock;

export interface Workout<S extends AnySet = LoggedSet> {
  id: string;
  name?: string;
  blocks: Block<S>[];
  /** recurring weekday slots, 0=Sunday */
  days?: number[];
  /** one-off YYYY-MM-DD dates */
  dates?: string[];
  updatedAt?: number;
  origin?: 'coach' | 'local';
  assignmentId?: string;
  _rev?: string;
  sample?: boolean;
}

export type SessionStatus = 'active' | 'completed' | 'incomplete';

export interface Session {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  name?: string;
  status: SessionStatus;
  blocks: Block<LoggedSet>[];
  startedAt?: number;
  completedAt?: number;
  updatedAt?: number;
  workoutId?: string;
}

/** A finished conditioning effort, stored on its block and in settings history. */
export interface CondResult {
  id?: string;
  fmt?: CondFmtKey;
  effort?: EffortKey;
  targetZone?: ZoneKey;
  targetRpe?: number | null;
  felt?: string;
  /** seconds banked per zone */
  zsec?: Record<ZoneKey, number>;
  /** total session seconds */
  dur?: number;
  /** WHOOP recovery captured WITH the session, not re-read later */
  rec?: number | null;
  startedAt?: number;
  hrr?: number | null;
  sim?: boolean;
  trace?: Downsampled;
}

export interface Downsampled {
  every: number;
  pts: (number | null)[];
}

export interface HrSample {
  /** seconds since session start */
  t: number;
  bpm: number;
}

export interface Profile {
  age?: number | string;
  /** an explicit tested max wins over the estimate */
  maxHr?: number | string;
  /** raised only on corroborated live evidence */
  obsMaxHr?: number | string;
  restingHr?: number | string;
  units?: 'kg' | 'lb';
  barKg?: number;
  plates?: number[];
}

export interface ProgressState {
  level: number;
  miss: number;
}

/**
 * The working weight a movement has EARNED, carried to its next session.
 *
 * It lives in settings rather than on a set because `FORBIDDEN_SET_KEYS` bans
 * recorded values from a planned set and `emit.test.ts` asserts it — a weight
 * riding on a `PlannedSet` would leak an athlete's logbook into a coach's plan.
 */
export interface LiftState {
  /** kilos to offer next time */
  kg: number;
  /** `completedAt` of the session that earned it — the merge tiebreak */
  at: number;
  /** reps it was earned at, so a changed rep target is visible in the record */
  reps?: number;
}

export interface Settings {
  profile?: Profile;
  conProgress?: Record<string, ProgressState>;
  /** Earned working weights, keyed by LOWERCASED movement name. */
  liftProgress?: Record<string, LiftState>;
  conditioning?: CondResult[];
  customFmt?: { rounds?: number | string; work?: number | string; rest?: number | string };
  /**
   * The shorthand the vanilla app's importer has been taught — `kw` maps a word
   * to a meaning, `ex` an alias to a real movement, which is why its values are
   * objects and not strings.
   *
   * Nothing in this package reads or writes it. It is declared because `app.js`
   * at the repo root still owns that feature and syncs into the SAME cloud
   * blob, so it is live data belonging to another client, and `mergeSettings`
   * has to carry it rather than drop it.
   */
  lexicon?: { kw?: Record<string, string>; ex?: Record<string, { name: string; mode: ModeKey }> };
  deletedIds?: Record<string, number>;
  devices?: Record<string, { seen?: number; name?: string }>;
  whoopDaily?: unknown;
  updatedAt?: number;
  [k: string]: unknown;
}

export interface EngineDB {
  workouts: Workout[];
  sessions: Session[];
  settings: Settings;
}

/** The live WHOOP reading the HR model consults. Null when nothing has synced. */
export interface WhoopSample {
  recoveryScore?: number | string | null;
  restingHr?: number | string | null;
  strain?: number | null;
  /** HRV in milliseconds (WHOOP's `hrv_rmssd_milli`). */
  hrvMs?: number | string | null;
  /** Last night's sleep performance, 0–100. */
  sleepPerformance?: number | string | null;
  date?: string;
  capturedAt?: string;
  source?: string;
  at?: number;
}

/** Everything the HR model needs, passed in rather than read off a global. */
export interface HrContext {
  profile?: Profile;
  whoop?: WhoopSample | null;
}

export interface ZoneBand {
  key: ZoneKey;
  name: string;
  lo: number;
  hi: number;
}

export interface Zones {
  floor: number;
  max: number;
  rest: number | null;
  rec: number | null;
  adj: number;
  method: 'hrr' | 'pctmax';
  list: [ZoneBand, ZoneBand, ZoneBand];
}

export interface SetAdjustment {
  delta: number;
  newWeight: number;
  verdict: string;
  cls: 'good' | 'bad';
}

export interface PrRecord {
  name: string;
  kg: number;
  reps: number;
  e1: number;
  prevE1: number | null;
}

export interface ExerciseHistoryEntry {
  sid: string;
  date: string;
  at: number;
  sets: { kg: number; reps: number; felt: string; e1: number }[];
  best: { kg: number; reps: number; felt: string; e1: number };
}

export interface Phase {
  name: string;
  dur: number;
  kind: 'warm' | 'work' | 'work2' | 'rest' | 'cool';
  round?: number;
}

export interface Prescription {
  level: number;
  dailyAdj: number;
  rec: number | null;
  note: string;
  minutes?: number;
  rounds?: number;
  work?: number;
  rest?: number;
}
