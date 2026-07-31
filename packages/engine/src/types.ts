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
export type Modality = 'row' | 'run' | 'ski' | 'bike' | 'air_bike';
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
  /**
   * Superset this exercise into the NEXT one: no rest between them, and the
   * pair cycles until both are done.
   *
   * Per-exercise rather than the block's all-or-nothing `superset`, because a
   * real session is "bench paired with dips, then three straight sets" — one
   * flag on the block cannot say that, so pairing anything meant splitting the
   * block, and nobody does that mid-set on a gym floor.
   *
   * `block.superset` still works and means every exercise links to the next.
   * Chaining three or more is just consecutive links: a triset.
   */
  ssNext?: boolean;
  tempo?: string;
  /** free text from the coach, shown on the logger stage */
  cue?: string;
}

export interface StrengthBlock<S extends AnySet = LoggedSet> {
  id: string;
  kind?: undefined;
  /**
   * Prep, not work.
   *
   * A warm-up block holds real movements you tick off, but nothing in it may
   * reach tonnage, an e1RM, or an earned working weight — warming up with an
   * empty bar must never teach the progression that your bench went to 20kg.
   * The per-SET warm-up marker ("W10") already exists for a ramp inside a
   * working exercise; this is the whole block.
   */
  warmup?: boolean;
  heading?: string;
  minutes?: number | string;
  format?: string;
  superset?: boolean;
  exercises: Exercise<S>[];
}

/** One GPS fix during a tracked conditioning session. */
export interface GeoSample {
  /** seconds since session start, matching HrSample's `t` */
  t: number;
  lat: number;
  lon: number;
}

/**
 * A downsampled route, stored the same spirit as `Downsampled` (the HR
 * trace) but carrying coordinate pairs instead of a single number.
 */
export interface GeoDownsampled {
  every: number;
  pts: ({ lat: number; lon: number } | null)[];
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
  /** coach-authored target, purely a display chip — no progression tie-in */
  targetDistanceM?: number;
  /** Orthogonal to condFmt — row/run/ski/bike/air_bike. Absent means unlabeled/general conditioning. */
  modality?: Modality;
  /** Only ever set alongside modality: 'air_bike' — raw output units are not
   *  portable across air-bike brands/generations, so a same-device baseline
   *  needs this stored with every result (see docs/research/echo-v3-connectivity-bundle). */
  device?: { manufacturer?: string; model?: string; generation?: string; consoleMetric?: string };
  exercises?: undefined;
  condResult?: CondResult;
}

/**
 * A block that is just words.
 *
 * A metcon is "AMRAP 12 — 10 burpees, 15 KB swings, 200m run": one prescription
 * that does not decompose into sets of a movement without lying about it.
 * Forcing it into exercises invents structure that was never programmed, and
 * every number it produced would be fiction.
 *
 * So this carries a heading you can rename and a body you type, and the only
 * thing the app records is whether you did it. It contributes nothing to
 * tonnage or to any lift's history, because it has nothing measurable to
 * contribute.
 */
export interface TextBlock {
  id: string;
  kind: 'text';
  heading?: string;
  /** free text, newlines and all */
  body?: string;
  /** ticked on the day; the only state a text block has */
  done?: boolean;
  exercises?: undefined;
}

export type Block<S extends AnySet = LoggedSet> = StrengthBlock<S> | CondBlock | TextBlock;

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
  /** Coach instructions, written once and carried with the session. */
  note?: string;
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
  /** total metres covered, jitter-filtered — absent means not GPS-tracked */
  distanceM?: number;
  /** dur / (distanceM/1000), only ever set alongside distanceM */
  avgPaceSecPerKm?: number;
  /** downsampled GPS route, capped like the HR trace */
  route?: GeoDownsampled;
  modality?: Modality;
  device?: { manufacturer?: string; model?: string; generation?: string; consoleMetric?: string };
  /** Did the cardiovascular signal (HR zone time) reach its target this session? */
  cardioCompletion?: 'met' | 'borderline' | 'not_met';
  /** Self-reported: did the prescribed mechanical work actually get completed? */
  mechanicalCompletion?: 'met' | 'borderline' | 'local_fatigue' | 'technique_fail' | 'pain_stop';
  /** Live FTMS telemetry, when the session came from a connected device. */
  avgPowerW?: number;
  avgCadenceRpm?: number;
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
  /**
   * Prep and mobility movements — the things done before and around training
   * that carry no load and no reps to progress.
   *
   * A plain list of names rather than records, because there is nothing to
   * record: these are a reference of what you do, not work with a history. Kept
   * in settings rather than derived from a name pattern at runtime, so the app
   * never has to guess whether "Bench Press Warm-up" is mobility.
   */
  mobility?: string[];
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

/**
 * One synced Concept2 Logbook result, exactly as the server's
 * `normalizeConcept2Result` stores it. `modality` is Concept2's RAW machine
 * type (`'rower'`/`'skierg'`/`'bike'`…), NOT this app's `Modality` union —
 * mapping between the two belongs to the result-matching layer, not here.
 */
export interface Concept2Result {
  provider: string;
  externalId: string | null;
  providerUserId: string | null;
  modality: string | null;
  startedAt: string | null;
  durationRaw: number | null;
  distanceRaw: number | null;
  durationDisplay: string | null;
  workoutType: string;
  source?: string | null;
  verified?: boolean | null;
  ranked?: boolean | null;
  privacy?: string | null;
  workout?: unknown;
  metadata?: unknown;
  strokes?: unknown;
  strokeDataAvailable?: boolean;
  syncedAt?: string;
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
  /**
   * Every working set performed, INCLUDING bodyweight ones — `kg` and `e1` are
   * null for those. They used to be dropped, so a screen headed "every session"
   * quietly omitted work that was done: a dip session logged BW, +10, +20 showed
   * two sets.
   */
  sets: { kg: number | null; reps: number; felt: string; e1: number | null }[];
  /** The best LOADED set, or null when the session was bodyweight only. */
  best: { kg: number; reps: number; felt: string; e1: number } | null;
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
