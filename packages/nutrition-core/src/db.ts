import type {
  CheckIn,
  CheckInModule,
  CheckInStatus,
  DayStatus,
  DayStatusValue,
  EntryKind,
  FoodLogEntry,
  IsoTimestamp,
  MacroProgram,
  MacroProgramDay,
  NutrientMap,
  NutritionSettings,
  ProgramGoal,
  ProgramMode,
  ProgramStatus,
  SourceSnapshot,
  WeightEntry,
} from './types';
import {
  CHECK_IN_STATUSES,
  DAY_STATUS_VALUES,
  ENTRY_KINDS,
  PROGRAM_GOALS,
  PROGRAM_MODES,
  PROGRAM_STATUSES,
} from './types';

export const NUTRITION_SCHEMA_VERSION = 1 as const;

/**
 * The athlete's nutrition slice — the `nutrition` ecosystem partition.
 *
 * Kept OUT of `EngineDB` on purpose (rebuild scope, "two-tier data model"):
 * training sync and nutrition sync must not be able to corrupt each other, so
 * the two blobs travel under separate storage keys and separate partitions.
 * Nothing in here is a food catalogue — that stays relational, server-side.
 */
export interface NutritionDB {
  schemaVersion: number;
  logEntries: FoodLogEntry[];
  weightEntries: WeightEntry[];
  /** The athlete has at most one program at a time; `null` before onboarding. */
  program: MacroProgram | null;
  checkIns: CheckIn[];
  dayStatus: DayStatus[];
  settings: NutritionSettings;
}

export function emptyNutritionDB(): NutritionDB {
  return {
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    logEntries: [],
    weightEntries: [],
    program: null,
    checkIns: [],
    dayStatus: [],
    settings: {},
  };
}

/*
 * ---------- sanitize ----------
 * Same posture as `sanitizeDB` in @hybrid/engine: this is the single trust
 * boundary for shape, it runs on every load, every import and every blob
 * arriving from the network, and it MUST NOT THROW — a sanitizer that throws
 * on a hostile blob is an app that will not start.
 *
 * Forgiving about extra keys (an older or newer build's fields survive a round
 * trip), unforgiving about structure.
 */

/**
 * Stamp used when a record carries no usable timestamp.
 *
 * Deliberately the epoch and not `Date.now()`: sanitize is not a load-time-only
 * function, so a wall-clock stamp would make a repaired local copy outrank the
 * server's good copy of the same record on the very next merge, and would
 * churn the sync fingerprint on every boot. The epoch loses every conflict,
 * which is the correct outcome for a record whose own write time is unknown.
 */
const EPOCH: IsoTimestamp = '1970-01-01T00:00:00.000Z';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** A string that must actually identify something — blank is as bad as missing. */
const idOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const stamp = (v: unknown): IsoTimestamp => (typeof v === 'string' && v !== '' ? v : EPOCH);

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
};

const optNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/**
 * Rebuild a free-form object from its own keys, dropping the three that can
 * re-home a prototype.
 *
 * `JSON.parse` materialises a hostile `"__proto__"` as an OWN enumerable
 * property, and any later `Object.assign`-style spread of the result invokes
 * the prototype setter — the prototype-poisoning hole @hybrid/engine's
 * `cleanSettings` was written to close. Every open-shaped field here
 * (`settings`, `nutrients`, `sourceSnapshot`) goes through this.
 */
const plainObject = (v: unknown): Record<string, unknown> => {
  if (!isRecord(v)) return {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = v[k];
  }
  return out;
};

/**
 * Nutrients are amounts, and every consumer multiplies them. A string or null
 * value would propagate as `NaN` through the whole micronutrient surface, so
 * non-finite entries are dropped rather than coerced.
 */
const nutrientMap = (v: unknown): NutrientMap => {
  const src = plainObject(v);
  const out: NutrientMap = {};
  for (const k of Object.keys(src)) {
    const n = src[k];
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
};

const sourceSnapshot = (v: unknown): SourceSnapshot => plainObject(v);

const checkInModules = (v: unknown): CheckInModule[] =>
  arr(v)
    .filter(isRecord)
    .filter((m) => typeof m.key === 'string' && typeof m.action === 'string')
    .map((m) => ({ key: m.key as string, action: m.action as string }));

function cleanLogEntry(raw: unknown): FoodLogEntry | null {
  if (!isRecord(raw)) return null;
  const id = idOrNull(raw.id);
  // No id is minted for a malformed record. Minting one here would be
  // non-deterministic across devices and boots, so the same broken blob would
  // produce a NEW entry every load and duplicates would accumulate without
  // bound — the failure mode @hybrid/engine's derived `condSiblingId` exists to
  // avoid. An entry with no identity cannot be edited or deleted either.
  if (!id) return null;
  // The DB check constraint fixes this set; a value outside it could never have
  // come from a legitimate write and no read path branches safely on it.
  const entryKind = oneOf<EntryKind>(raw.entryKind, ENTRY_KINDS);
  if (!entryKind) return null;
  return {
    id,
    userId: str(raw.userId),
    logDate: str(raw.logDate),
    meal: str(raw.meal, 'other'),
    entryKind,
    foodId: optStr(raw.foodId),
    customFoodId: optStr(raw.customFoodId),
    recipeId: optStr(raw.recipeId),
    // `quantity > 0` in the schema; fall back to the column default rather than
    // to 0, which would read as "ate none of it" next to real macro numbers.
    quantity: (() => {
      const q = num(raw.quantity, 1, 0, Number.MAX_SAFE_INTEGER);
      return q > 0 ? q : 1;
    })(),
    unit: str(raw.unit, 'serving'),
    // Snapshot fields: clamped to a sane range but never recomputed from the
    // source food — see the FoodLogEntry doc comment.
    calories: num(raw.calories, 0, 0, Number.MAX_SAFE_INTEGER),
    proteinG: num(raw.proteinG, 0, 0, Number.MAX_SAFE_INTEGER),
    carbsG: num(raw.carbsG, 0, 0, Number.MAX_SAFE_INTEGER),
    fatG: num(raw.fatG, 0, 0, Number.MAX_SAFE_INTEGER),
    displayName: str(raw.displayName),
    nutrients: nutrientMap(raw.nutrients),
    notes: optStr(raw.notes),
    sourceSnapshot: sourceSnapshot(raw.sourceSnapshot),
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
    deletedAt: optStr(raw.deletedAt),
  };
}

function cleanWeightEntry(raw: unknown): WeightEntry | null {
  if (!isRecord(raw)) return null;
  const id = idOrNull(raw.id);
  if (!id) return null;
  // A weigh-in without a weight is not a weigh-in, and a fabricated default
  // would feed the trend/expenditure maths a number the athlete never stood
  // on (MacroTrack rule #1). Drop it instead.
  if (typeof raw.weightKg !== 'number' || !Number.isFinite(raw.weightKg)) return null;
  return {
    id,
    userId: str(raw.userId),
    measuredAt: stamp(raw.measuredAt),
    // The schema's own 20–500 kg check, applied locally so a corrupt blob
    // cannot feed the engine a value the server would have rejected.
    weightKg: num(raw.weightKg, 20, 20, 500),
    source: str(raw.source, 'manual'),
    note: optStr(raw.note),
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
  };
}

function cleanProgramDay(raw: unknown, programId: string): MacroProgramDay | null {
  if (!isRecord(raw)) return null;
  const targetDate = idOrNull(raw.targetDate);
  // (program_id, target_date) is the primary key — a day with no date cannot be
  // addressed, merged or superseded.
  if (!targetDate) return null;
  return {
    programId,
    targetDate,
    calories: num(raw.calories, 0, 0, Number.MAX_SAFE_INTEGER),
    proteinG: num(raw.proteinG, 0, 0, Number.MAX_SAFE_INTEGER),
    carbsG: num(raw.carbsG, 0, 0, Number.MAX_SAFE_INTEGER),
    fatG: num(raw.fatG, 0, 0, Number.MAX_SAFE_INTEGER),
    source: str(raw.source, 'engine'),
    createdAt: stamp(raw.createdAt),
  };
}

function cleanProgram(raw: unknown): MacroProgram | null {
  if (!isRecord(raw)) return null;
  const id = idOrNull(raw.id);
  if (!id) return null;
  // mode/goal/status are all DB check constraints. A program whose mode is
  // unreadable cannot be shown or adjusted, and guessing one would silently
  // move a manual athlete onto coached targets.
  const mode = oneOf<ProgramMode>(raw.mode, PROGRAM_MODES);
  const goal = oneOf<ProgramGoal>(raw.goal, PROGRAM_GOALS);
  const status = oneOf<ProgramStatus>(raw.status, PROGRAM_STATUSES);
  if (!mode || !goal || !status) return null;
  return {
    id,
    userId: str(raw.userId),
    name: str(raw.name, 'Macro program'),
    mode,
    goal,
    targetRateKgPerWeek: num(raw.targetRateKgPerWeek, 0, -5, 5),
    startDate: str(raw.startDate),
    endDate: optStr(raw.endDate),
    weeklyCalorieBudget: optNum(raw.weeklyCalorieBudget),
    proteinPreference: optStr(raw.proteinPreference),
    fatPreference: optStr(raw.fatPreference),
    status,
    days: arr(raw.days)
      .map((d) => cleanProgramDay(d, id))
      .filter((d): d is MacroProgramDay => d !== null),
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
  };
}

function cleanCheckIn(raw: unknown): CheckIn | null {
  if (!isRecord(raw)) return null;
  const id = idOrNull(raw.id);
  if (!id) return null;
  const status = oneOf<CheckInStatus>(raw.status, CHECK_IN_STATUSES);
  if (!status) return null;
  return {
    id,
    userId: str(raw.userId),
    programId: optStr(raw.programId),
    weekStart: str(raw.weekStart),
    weekEnd: str(raw.weekEnd),
    status,
    // `optNum` maps garbage to `null`, never to 0: a proposal of zero calories
    // and "no proposal for this week" are different statements, and the held
    // state must be able to clear a previous week's numbers.
    previousExpenditureKcal: optNum(raw.previousExpenditureKcal),
    observedExpenditureKcal: optNum(raw.observedExpenditureKcal),
    proposedExpenditureKcal: optNum(raw.proposedExpenditureKcal),
    proposedCalories: optNum(raw.proposedCalories),
    proposedProteinG: optNum(raw.proposedProteinG),
    proposedCarbsG: optNum(raw.proposedCarbsG),
    proposedFatG: optNum(raw.proposedFatG),
    modules: checkInModules(raw.modules),
    explanation: str(raw.explanation),
    createdAt: stamp(raw.createdAt),
    resolvedAt: optStr(raw.resolvedAt),
    updatedAt: stamp(raw.updatedAt),
  };
}

function cleanDayStatus(raw: unknown): DayStatus | null {
  if (!isRecord(raw)) return null;
  const logDate = idOrNull(raw.logDate);
  // (user_id, log_date) is the primary key; a declaration about no particular
  // day says nothing.
  if (!logDate) return null;
  const status = oneOf<DayStatusValue>(raw.status, DAY_STATUS_VALUES);
  // No default to 'unlogged': that value is a real declaration in this model,
  // and inventing it for a corrupt record tells the expenditure engine the
  // athlete said something they never said (MacroTrack rule #2).
  if (!status) return null;
  return {
    userId: str(raw.userId),
    logDate,
    status,
    note: optStr(raw.note),
    updatedAt: stamp(raw.updatedAt),
  };
}

/**
 * Coerce anything claiming to be a nutrition DB into one every read path can
 * survive. Never throws.
 */
export function sanitizeNutritionDB(raw: unknown): NutritionDB {
  const src = isRecord(raw) ? raw : {};
  return {
    schemaVersion: num(src.schemaVersion, NUTRITION_SCHEMA_VERSION, 0, Number.MAX_SAFE_INTEGER),
    logEntries: arr(src.logEntries)
      .map(cleanLogEntry)
      .filter((e): e is FoodLogEntry => e !== null),
    weightEntries: arr(src.weightEntries)
      .map(cleanWeightEntry)
      .filter((e): e is WeightEntry => e !== null),
    program: cleanProgram(src.program),
    checkIns: arr(src.checkIns)
      .map(cleanCheckIn)
      .filter((c): c is CheckIn => c !== null),
    dayStatus: arr(src.dayStatus)
      .map(cleanDayStatus)
      .filter((d): d is DayStatus => d !== null),
    settings: plainObject(src.settings) as NutritionSettings,
  };
}

/*
 * ---------- merge ----------
 * ADDITIVE, BY KEY, LAST-WRITE-WINS ON `updatedAt`.
 *
 * Additive is the load-bearing word. This repository has lost user data twice
 * to a sync path that resolved a conflict by taking one side whole, so a record
 * present on only ONE side must survive — see the merge commentary in
 * apps/mobile/src/cloud/sync.tsx: "it must never lose a record that exists only
 * locally or only in an un-split legacy remote blob". Two devices logging
 * breakfast and lunch between syncs must end up with both meals, on both
 * devices, whichever order the merge runs in.
 *
 * A deletion is NOT an absence: it travels as a soft-delete stamp on a record
 * that keeps existing (see `FoodLogEntry.deletedAt`), so "drop what the other
 * side no longer has" is never the right reading of a one-sided record.
 */

const at = (v: IsoTimestamp | undefined): number => {
  const t = Date.parse(v ?? '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * Union by key. On a tie the `a` side is kept, so a merge is deterministic for
 * a caller that fixes its argument order — but callers must not read a tie as
 * meaningful: two writes stamped the same millisecond are genuinely ambiguous,
 * and the fix is a finer stamp, not a rule here.
 */
function mergeByKey<T>(a: T[], b: T[], key: (x: T) => string, newer: (x: T, y: T) => boolean): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(key(x), x);
  for (const y of b) {
    const k = key(y);
    const x = map.get(k);
    map.set(k, x === undefined ? y : newer(y, x) ? y : x);
  }
  return Array.from(map.values());
}

const byUpdatedAt = <T extends { updatedAt: IsoTimestamp }>(y: T, x: T): boolean =>
  at(y.updatedAt) > at(x.updatedAt);

/** Two-part primary keys are joined on NUL, which cannot occur in either part. */
const compositeKey = (...parts: string[]): string => parts.join('\u0000');

/**
 * Merge two programs. Day targets union by `targetDate` even when the scalar
 * fields come from one side: a device that generated next week's targets
 * offline must not lose them to a device that merely renamed the program.
 */
function mergeProgram(a: MacroProgram | null, b: MacroProgram | null): MacroProgram | null {
  if (!a) return b;
  if (!b) return a;
  // Different ids means the athlete started a NEW program, not that two copies
  // of one program diverged. Unioning their days would blend two goals'
  // targets into one calendar, so the newer program replaces the older whole.
  if (a.id !== b.id) return at(b.updatedAt) > at(a.updatedAt) ? b : a;
  const base = at(b.updatedAt) > at(a.updatedAt) ? b : a;
  return {
    ...base,
    days: mergeByKey(
      a.days,
      b.days,
      (d) => d.targetDate,
      // A program day has no `updatedAt` in the schema (the row is written once
      // per date); `createdAt` is its only stamp, so a recomputed target wins by
      // being written later.
      (y, x) => at(y.createdAt) > at(x.createdAt),
    ),
  };
}

export function mergeNutrition(a: NutritionDB, b: NutritionDB): NutritionDB {
  return {
    schemaVersion: Math.max(a.schemaVersion, b.schemaVersion),
    logEntries: mergeByKey(a.logEntries, b.logEntries, (e) => e.id, byUpdatedAt),
    weightEntries: mergeByKey(a.weightEntries, b.weightEntries, (e) => e.id, byUpdatedAt),
    program: mergeProgram(a.program, b.program),
    checkIns: mergeByKey(a.checkIns, b.checkIns, (c) => c.id, byUpdatedAt),
    dayStatus: mergeByKey(
      a.dayStatus,
      b.dayStatus,
      (d) => compositeKey(d.userId, d.logDate),
      byUpdatedAt,
    ),
    // Settings have no per-key stamps, so they union per key with `b` winning a
    // collision. Union rather than replace for the same reason as everything
    // above: a key only one side knows about — an older or newer build's
    // preference — must survive the round trip.
    settings: { ...a.settings, ...b.settings },
  };
}
