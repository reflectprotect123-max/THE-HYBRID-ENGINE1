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

import type { EcosystemSyncNamespace, SharedCoreState } from '@hybrid/shared-core';

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
  /**
   * Stage 6 of the RPE progression design: the kg the engine actually
   * offered before the athlete edited the field, present ONLY when it
   * differs from `aVal` — an override that matched the offer leaves nothing
   * to record. Written once, by `@hybrid/session-authoring`'s `applyDraft`,
   * never re-derived: `aVal` already gets edited by the athlete, so the
   * offer has to be captured before that happens or it is lost.
   */
  offeredKg?: number;
  /**
   * One optional line the athlete may leave when overriding the offered
   * weight — "shoulder felt off", "slept 4 hours". Present only alongside
   * `offeredKg`; never asked for on an ordinary set that matched the offer.
   */
  overrideNote?: string;
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
   * EMOM pacing, in seconds: every set STARTS this far apart, however long the
   * last one took. Absent means the ordinary `rest` countdown, which starts
   * when a set ends.
   *
   * The two are different clocks and that is the whole reason this exists.
   * "90 seconds rest" means 90 seconds AFTER the set; "every 2:30" means the
   * set and the recovery share one window, so a set that took 40 seconds
   * leaves 110 and a set that took 90 leaves 60. The owner asked for it on
   * 16 August 2026 in exactly those terms — "a single or an emom style with a
   * timer, which is then X the amount of sets" — and the X is the set count
   * the exercise already carries.
   *
   * When both are present `every` wins, because it is the more specific
   * instruction; `rest` is kept rather than cleared so switching the mode back
   * does not lose the number the coach typed.
   */
  every?: number;
  /**
   * The smallest step this movement's load can actually move by, in kg.
   *
   * A barbell moves in 2.5kg (the pair of 1.25s); a dumbbell rack moves in 2;
   * a weight stack moves in whatever the stack says. Without this, every
   * exercise rounded to the one global `AUTOREG.plateIncrement`, so a
   * 12kg dumbbell's next step was priced at 12.5kg — a weight that does not
   * exist on the rack — and the coaching line said so out loud ("the next jump
   * is 2.5 kg"). Found by driving the parity harness against the prototype,
   * which has authored this per exercise all along.
   *
   * Optional, and absent means the global. Every session logged before this
   * existed keeps behaving exactly as it did.
   */
  inc?: number;
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
  /**
   * What this exercise's two set columns MEASURE, when it was authored in the
   * coach's day builder — values from `COLUMN_TYPES` in `setColumns.ts`.
   *
   * `mode` is the engine's own vocabulary and only six values wide, so a pair
   * like reps × meters has no exact `ModeKey`. The pair is recorded here so
   * reopening the builder shows the coach the columns they chose rather than
   * the closest mode the engine could name. Absent on everything authored any
   * other way, and read by the day builder only — `mode` remains what every
   * other screen reads.
   */
  cols?: { a: string; b: string };
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
  /**
   * What KIND of block this is, when the coach's builder authored it — one of
   * `BLOCK_CATEGORIES` in the bench's `BlockEditor`.
   *
   * The bench used to store the category in `heading`, which meant a block's
   * displayed name and its kind were the same string and only one of them
   * could be true. A session template needs both: a section reading "STRENGTH
   * INTENSITY 1" that is nonetheless a Strength/Power block. So the kind moved
   * here and `heading` went back to being the name the athlete reads.
   *
   * Absent on everything authored before that and on everything authored
   * anywhere else, which is why the bench still falls back to reading the
   * category out of `heading` when this is missing.
   */
  category?: string;
  minutes?: number | string;
  format?: string;
  superset?: boolean;
  /**
   * Which movement led each round, by round index, as indices into `exercises`.
   *
   * A superset's pair order is a fact about each ROUND, not about the block.
   * Reordering the pair mid-session must not rewrite what already happened, so a
   * round that has begun keeps the order it ran in and only unstarted rounds
   * move. Absent means "the order `exercises` is in", which is every session
   * logged before the athlete reordered anything.
   */
  roundOrder?: Record<number, number[]>;
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
  /** See `StrengthBlock.category` — the same split, for the same reason. */
  category?: string;
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
  /**
   * The coach's note for this block.
   *
   * A conditioning workout cannot carry a `TextBlock` alongside its
   * conditioning block — `sanitizeDB`'s `splitMixedWorkout` treats a text
   * block as "other" and splits the workout in two — so a conditioning-only
   * session had nowhere to put the coach's instructions. This is that place.
   */
  note?: string;
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
  /**
   * 'strength' or 'conditioning' — decided when the first block is authored
   * (Planner's block-add toolbar, the guided builder's block-type choice), or
   * inferred by `sanitizeDB` from the blocks of data written before this field
   * existed. Absent on a workout with no blocks yet: sanitizeDB infers a kind,
   * it never guesses one and never overwrites a stored one. A 'strength'
   * workout's blocks may never contain a CondBlock again; see `sanitizeDB`'s
   * splitMixedWorkout for how an already-mixed workout (the old "finisher
   * tacked onto a lift day" pattern) gets split into two siblings on load,
   * once.
   */
  kind?: 'strength' | 'conditioning';
  name?: string;
  blocks: Block<S>[];
  /** recurring weekday slots, 0=Sunday */
  days?: number[];
  /** one-off YYYY-MM-DD dates */
  dates?: string[];
  /** ids of every Folder (Settings.folders) this workout is filed under —
   *  empty or absent means it renders in Library's ungrouped list. A workout
   *  can be in several folders at once. */
  folderIds?: string[];
  updatedAt?: number;
  _rev?: string;
  sample?: boolean;
}

export type SessionStatus = 'active' | 'completed' | 'incomplete';

export interface Session {
  id: string;
  /** Mirrors `Workout.kind` — see its doc comment. Copied from the workout when
   *  the session is minted (`sessionFrom`), and inferred by `sanitizeDB` the
   *  same way for sessions logged before this field existed. */
  kind?: 'strength' | 'conditioning';
  /** YYYY-MM-DD */
  date: string;
  name?: string;
  status: SessionStatus;
  blocks: Block<LoggedSet>[];
  startedAt?: number;
  completedAt?: number;
  updatedAt?: number;
  workoutId?: string;
  /**
   * Every time the athlete moved INTO a block, in order, as wall-clock stamps.
   *
   * TIMESTAMPS RATHER THAN A STOPWATCH, deliberately. A counting timer has to
   * be told what to do every time the phone locks, the app is backgrounded or
   * Android reclaims it, and it silently loses or double-counts whenever one
   * of those is missed. Two times of day survive the process dying outright —
   * which is exactly why `startedAt`/`completedAt` have always been the way
   * session duration is known, and this is the same trick per block.
   *
   * It is a LIST rather than one stamp per block because an athlete can go
   * back: block 1, block 2, block 1 again is three segments, and a single
   * "when did I first enter this" would attribute the third to the wrong
   * place. `blockDurations` sums the segments per block.
   *
   * Session-only. It never appears on a `Workout`, because it is a fact about
   * a run and not about a plan.
   */
  blockLog?: { id: string; at: number }[];
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
  /**
   * Where `zsec` CAME FROM. Absent means a real heart-rate trace, which is
   * every record written before 16 August 2026 and every strapped session
   * since.
   *
   * `'felt'` means it was derived from the athlete's own end-of-session RPE by
   * `withFeltZones` — the whole duration in one zone, because a rating is one
   * number about a whole session. Anything that must only trust measured data
   * checks this; anything counting MINUTES TRAINED can use both, which is the
   * point of deriving it at all.
   */
  zsrc?: 'felt';
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
  /**
   * Raw per-split data carried through from a synced Concept2 result's
   * `workout.splits`, untouched — this app does not yet derive anything from
   * split-level detail, but drops it on the floor would throw away real data
   * a future feature could use. See `concept2ToCondResult` in `concept2.ts`.
   */
  splits?: unknown[];
  /**
   * Total metres from a synced erg/console result (e.g. Concept2), carried
   * through so it isn't lost — but deliberately NOT `distanceM`: that field's
   * invariant is GPS-only ("absent means not GPS-tracked", used to gate the
   * distance trend in Progress and the GPS-route affordances in History/
   * Recap), and an erg's own odometer is not a GPS distance. Task 8 made the
   * identical call for FTMS Total Distance. Never summed into distance
   * trends; display-only if surfaced at all.
   */
  deviceDistanceM?: number;
  /**
   * The provider's own id for a synced result this record was imported from
   * (e.g. a Concept2 Logbook result id). Its presence is the dedupe key: an
   * externalId already present anywhere in the database means that synced
   * result has landed and must not be imported again — on this device or,
   * via the cloud settings merge, any other.
   */
  externalId?: string;
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
  /** the e1RM implied by the opener this was earned at, so a later session
   *  whose plan changes the rep scheme can re-price the opener instead of
   *  re-offering the same kilo regardless of what today asks for — see
   *  `anchorForOpener` and `plannedKg` in fold.ts */
  e1rm?: number;
}

/** A user-named grouping of workouts in Library — organizational only, never
 *  scheduling, never progression state. Deleting one never deletes the
 *  workouts inside it (see `ungroupedWorkouts`). */
export interface Folder {
  id: string;
  name: string;
}

export interface Settings {
  profile?: Profile;
  conProgress?: Record<string, ProgressState>;
  /** Earned working weights, keyed by LOWERCASED movement name. */
  liftProgress?: Record<string, LiftState>;
  conditioning?: CondResult[];
  /**
   * When the athlete last confirmed they're ready to continue, per
   * format+modality bucket (same key as `conProgress`). Only ever compared
   * against a `pain_stop` result's own timestamp — see `painHoldFor`.
   */
  conditioningAck?: Record<string, number>;
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
  /**
   * The coach's own exercise library — see `buildCatalogue`.
   *
   * Additive, so `mergeSettings` UNIONS it rather than letting one device win:
   * a movement added on the bench and another added on the phone are both real
   * edits. Absent means "never set", which falls the picker back to mining
   * history; an empty array means an emptied library and does not.
   */
  movements?: string[];
  /**
   * User-created folders for organizing Library's Sessions list — see
   * `Workout.folderIds`. A flat list, same shape as `mobility`: nothing here
   * is derived, the app never guesses which folders exist.
   */
  folders?: Folder[];
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
  /** Versioned cross-product facts. Optional for pre-migration backups. */
  core?: SharedCoreState;
  /** Per-domain snapshots/events used by independently deployed products. */
  ecosystem?: EcosystemSyncNamespace;
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
