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

/**
 * A timestamp that must actually denote an instant.
 *
 * `optStr` would let `''` through, which is neither absent nor a time: every
 * `if (x.deletedAt)` read would call the record live while every
 * `x.deletedAt != null` read called it deleted, and the two disagree forever.
 */
const tsOrNull = (v: unknown): IsoTimestamp | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;

const stamp = (v: unknown): IsoTimestamp => (typeof v === 'string' && v !== '' ? v : EPOCH);

const finiteOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, finiteOr(v, fallback)));

const optNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/**
 * Rebuild a free-form value from its own keys, dropping `__proto__` at every
 * depth.
 *
 * `JSON.parse` materialises a hostile `"__proto__"` as an OWN enumerable
 * property, and any later `Object.assign`-style spread of the result invokes
 * the prototype setter — the prototype-poisoning hole @hybrid/engine's
 * `cleanSettings` was written to close.
 *
 * Only `__proto__` is that vector. `constructor` and `prototype` are ordinary
 * own keys once assigned with `=`, and dropping them would silently delete a
 * legitimate athlete-authored key (a `sourceSnapshot` recording a
 * `constructor` field, a settings key from a newer build) — data loss to
 * defend against a hole that is not there.
 *
 * Recursive rather than top-level: `sourceSnapshot` is an opaque nested blob
 * preserved byte-for-byte, so a payload only has to be one level down to reach
 * a consumer that spreads it.
 */
const scrubProto = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(scrubProto);
  if (!isRecord(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    if (k === '__proto__') continue;
    out[k] = scrubProto(v[k]);
  }
  return out;
};

/** Every open-shaped field (`settings`, `nutrients`, `sourceSnapshot`) goes through this. */
const plainObject = (v: unknown): Record<string, unknown> =>
  isRecord(v) ? (scrubProto(v) as Record<string, unknown>) : {};

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
  // `log_date` is NOT NULL and every read groups by it. A blank one would keep
  // the entry counting towards the day's totals while being invisible to the
  // day it belongs to, and could never be written back to the server — a
  // permanently unsyncable phantom. Drop it instead.
  const logDate = idOrNull(raw.logDate);
  if (!logDate) return null;
  return {
    id,
    userId: str(raw.userId),
    logDate,
    meal: str(raw.meal, 'other'),
    entryKind,
    // Provenance links are a uuid or absent; `''` is neither, and would be read
    // as "there is a source" by every truthiness check that guards a lookup.
    foodId: idOrNull(raw.foodId),
    customFoodId: idOrNull(raw.customFoodId),
    recipeId: idOrNull(raw.recipeId),
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
    deletedAt: tsOrNull(raw.deletedAt),
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
  // `weight_kg numeric not null check (weight_kg between 20 and 500)` REJECTS
  // the row; it does not clamp it. Clamping here would turn a corrupt 9000 into
  // a perfectly plausible 500 kg weigh-in and hand it to the trend regression,
  // the EWMA and the expenditure model as if the athlete had stood on the
  // scale — the same invented number the check four lines up refuses to make.
  if (raw.weightKg < 20 || raw.weightKg > 500) return null;
  // `measured_at` is ATHLETE DATA, not merge metadata: it is the x-axis of
  // every trend fit. Falling back to the epoch would plant a real weight in
  // 1970 and drag the regression through fifty-six years of nothing, so a
  // weigh-in that cannot say WHEN is dropped exactly like one that cannot say
  // what. (`createdAt`/`updatedAt` below do fall back to the epoch — those are
  // merge metadata, and losing every conflict is the right outcome there.)
  const measuredAt = tsOrNull(raw.measuredAt);
  if (!measuredAt) return null;
  return {
    id,
    userId: str(raw.userId),
    measuredAt,
    weightKg: raw.weightKg,
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
    // No bound: the table constrains this field's SIGN against `goal`, never
    // its magnitude, and inventing a ±5 kg/week range here would silently
    // rewrite a rate the database would have accepted.
    targetRateKgPerWeek: finiteOr(raw.targetRateKgPerWeek, 0),
    startDate: str(raw.startDate),
    endDate: idOrNull(raw.endDate),
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
    // Part of the server's natural key, so `''` would key this check-in to a
    // program that cannot exist — see `checkInKey`.
    programId: idOrNull(raw.programId),
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
    resolvedAt: tsOrNull(raw.resolvedAt),
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
 * Order-independent serialisation, used ONLY to settle a conflict that every
 * stamp on the two records left equal. Keys are sorted so the same content
 * produces the same string regardless of the order a given device happened to
 * write its fields in.
 */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isRecord(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v) ?? 'null';
};

const recordId = (v: unknown): string => (isRecord(v) && typeof v.id === 'string' ? v.id : '');

/**
 * Settle a conflict whose `updatedAt` values compared equal, WITHOUT consulting
 * argument position.
 *
 * "The `a` side wins a tie" is not a rule, it is a coin flip that lands on
 * whichever device synced first: `mergeNutrition(a, b)` and
 * `mergeNutrition(b, a)` would then keep different content, so two devices that
 * each merged the other's blob disagree permanently. Equal stamps are not
 * hypothetical either — every record the sanitizer repaired carries the epoch,
 * so two independently repaired copies tie forever.
 *
 * Lexicographic `id` first (the one field two records sharing a composite key
 * can differ in and still be the same row), then canonical content. Both are
 * arbitrary; both are identical on every device, which is the whole point.
 */
const breaksTie = (y: unknown, x: unknown): boolean => {
  const yi = recordId(y);
  const xi = recordId(x);
  return yi === xi ? canonical(y) > canonical(x) : yi > xi;
};

/**
 * Union by key, emitted in key order.
 *
 * The sort is not cosmetic: sync layers dirty-check by fingerprinting the
 * serialised blob, so two devices holding identical content in `a`-then-`b`
 * versus `b`-then-`a` order would each read the other's blob as a change and
 * push it back, ping-ponging a write that alters nothing.
 */
function mergeByKey<T>(a: T[], b: T[], key: (x: T) => string, newer: (x: T, y: T) => boolean): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(key(x), x);
  for (const y of b) {
    const k = key(y);
    const x = map.get(k);
    map.set(k, x === undefined ? y : newer(y, x) ? y : x);
  }
  return Array.from(map.keys())
    .sort()
    .map((k) => map.get(k)!);
}

const byUpdatedAt = <T extends { updatedAt: IsoTimestamp }>(y: T, x: T): boolean => {
  const ty = at(y.updatedAt);
  const tx = at(x.updatedAt);
  return ty === tx ? breaksTie(y, x) : ty > tx;
};

/**
 * Join the parts of a composite primary key injectively.
 *
 * A delimiter is not enough. `userId` and `logDate` reach here as free strings
 * from an untrusted blob and are never charset-checked, and any character the
 * delimiter uses — NUL included, a JSON string can carry one — can be smuggled
 * into one part to make two different keys collide, which silently drops a real
 * record on merge. Length prefixes cannot collide whatever the parts contain.
 */
const compositeKey = (...parts: string[]): string => parts.map((p) => `${p.length}:${p}`).join('');

/**
 * A check-in's identity is the server's natural key
 * `(user_id, program_id, week_start)` — the NULLS NOT DISTINCT unique index in
 * `005_checkin_program_provenance.sql` — not its local `id`. Two devices
 * offline mint two uuids for the same week; keying on `id` keeps both, so the
 * athlete is shown two contradictory proposals for one week and the server's
 * `on conflict (user_id, program_id, week_start)` upsert then silently
 * collapses them to whichever landed last. Keying on the natural key makes the
 * merge resolve the week the way the database already would.
 */
const checkInKey = (c: CheckIn): string => compositeKey(c.userId, c.programId ?? '', c.weekStart);

/**
 * Union settings per key.
 *
 * Settings carry no per-key stamp, so a collision cannot be resolved by time;
 * it is resolved by canonical value so both merge orders agree, where "`b`
 * wins" would make the result depend on which device synced first. Keys are
 * sorted for the same fingerprint-stability reason as `mergeByKey`, and the
 * union is per key rather than whole-object so a key only one side knows about
 * — an older or newer build's preference — survives the round trip.
 */
function mergeSettings(a: NutritionSettings, b: NutritionSettings): NutritionSettings {
  const out: NutritionSettings = {};
  for (const k of Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()) {
    // Assigning this key would re-home `out`'s prototype rather than add a key.
    if (k === '__proto__') continue;
    const inA = Object.prototype.hasOwnProperty.call(a, k);
    const inB = Object.prototype.hasOwnProperty.call(b, k);
    if (!inB) out[k] = a[k];
    else if (!inA) out[k] = b[k];
    else out[k] = canonical(b[k]) > canonical(a[k]) ? b[k] : a[k];
  }
  return out;
}

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
  //
  // This is the worst place in the merge to resolve a tie by argument order:
  // whichever program loses takes its entire day-target calendar with it, so
  // two devices with equal stamps would each keep a different program forever
  // and neither could ever recover the other's targets. `byUpdatedAt` settles
  // it on the ids themselves, which both devices read the same way.
  if (a.id !== b.id) return byUpdatedAt(b, a) ? b : a;
  const base = byUpdatedAt(b, a) ? b : a;
  return {
    ...base,
    days: mergeByKey(
      a.days,
      b.days,
      (d) => d.targetDate,
      // A program day has no `updatedAt` in the schema (the row is written once
      // per date); `createdAt` is its only stamp, so a recomputed target wins by
      // being written later. Same-`createdAt` targets for one date fall back to
      // content order rather than to which side was passed first.
      (y, x) => {
        const ty = at(y.createdAt);
        const tx = at(x.createdAt);
        return ty === tx ? breaksTie(y, x) : ty > tx;
      },
    ),
  };
}

export function mergeNutrition(a: NutritionDB, b: NutritionDB): NutritionDB {
  // `Math.max` would label the union of a v1 record set and a v2 record set as
  // v2, so the v1-shaped records inside it never see their migration again and
  // are read by v2 code as if they had already been converted. Two versions
  // cannot be unioned record-by-record at all — the caller must migrate both
  // sides to a common version and merge then. Failing loudly here is the only
  // outcome that does not corrupt silently.
  if (a.schemaVersion !== b.schemaVersion) {
    throw new Error(
      `mergeNutrition: refusing to merge schemaVersion ${a.schemaVersion} with ${b.schemaVersion}; migrate both sides first`,
    );
  }
  return {
    schemaVersion: a.schemaVersion,
    logEntries: mergeByKey(a.logEntries, b.logEntries, (e) => e.id, byUpdatedAt),
    weightEntries: mergeByKey(a.weightEntries, b.weightEntries, (e) => e.id, byUpdatedAt),
    program: mergeProgram(a.program, b.program),
    checkIns: mergeByKey(a.checkIns, b.checkIns, checkInKey, byUpdatedAt),
    dayStatus: mergeByKey(
      a.dayStatus,
      b.dayStatus,
      (d) => compositeKey(d.userId, d.logDate),
      byUpdatedAt,
    ),
    settings: mergeSettings(a.settings, b.settings),
  };
}
