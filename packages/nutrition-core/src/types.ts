/*
 * Athlete-side nutrition data model, ported from MacroTrack
 * (`reflectprotect123-max/thehybridsystem` @ 079b356, Kotlin/Compose) to
 * TypeScript. Field names are camelCase here; the authoritative column shapes
 * are `supabase/migrations/001_macro_foundation.sql` in that repository and
 * every string union below is copied verbatim from a DB check constraint, not
 * re-derived — MacroTrack's rule #1 (never invent nutrition values) extends to
 * never inventing the enum a row is allowed to hold.
 *
 * This package holds ATHLETE data only. The food catalogue (foods,
 * food_servings, custom_foods, recipes) stays relational server-side per the
 * rebuild scope: a 5,000-food catalogue does not belong in a synced blob.
 * Prescription logic belongs to `@hybrid/nutrition-engine`, never here.
 */

/** ISO-8601 date, `YYYY-MM-DD` — a Postgres `date` column. */
export type IsoDate = string;

/** ISO-8601 instant — a Postgres `timestamptz` column. */
export type IsoTimestamp = string;

/**
 * Nutrients as stored on a source food or copied onto a log entry.
 *
 * Amounts only: keys are nutrient identifiers, values are magnitudes whose
 * unit is fixed by the key. The denominator is NOT part of this map — see
 * `FoodLogEntry.nutrients` for the basis rule that makes summing these wrong.
 */
export type NutrientMap = Record<string, number>;

/**
 * Opaque provenance blob copied at log time: which source record this entry
 * came from and how it was scaled. Preserved byte-for-byte and never
 * interpreted here, because MacroTrack's rule #3 (preserve source provenance)
 * outlives whatever shape a given app version wrote.
 */
export type SourceSnapshot = Record<string, unknown>;

/** Values `food_log_entries.entry_kind`'s DB check constraint allows. */
export type EntryKind = 'food' | 'custom_food' | 'recipe' | 'quick_add';

export const ENTRY_KINDS: readonly EntryKind[] = ['food', 'custom_food', 'recipe', 'quick_add'];

/**
 * Suggested `food_log_entries.meal` values. NOT DB-enforced — the column is
 * free text with a default of `'other'`, so `FoodLogEntry.meal` is typed
 * `string` rather than narrowed to this union. Narrowing it would make a
 * user's own meal label ("pre-training") an invalid record and hand the
 * sanitizer a reason to drop a real logged meal.
 */
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';

export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

/** Values `daily_log_status.status`'s DB check constraint allows. */
export type DayStatusValue = 'complete' | 'partial' | 'fasted' | 'unlogged';

export const DAY_STATUS_VALUES: readonly DayStatusValue[] = ['complete', 'partial', 'fasted', 'unlogged'];

/** Values `macro_programs.mode`'s DB check constraint allows. */
export type ProgramMode = 'coached' | 'collaborative' | 'manual';

export const PROGRAM_MODES: readonly ProgramMode[] = ['coached', 'collaborative', 'manual'];

/** Values `macro_programs.goal`'s DB check constraint allows. */
export type ProgramGoal = 'lose' | 'gain' | 'maintain';

export const PROGRAM_GOALS: readonly ProgramGoal[] = ['lose', 'gain', 'maintain'];

/** Values `macro_programs.status`'s DB check constraint allows. */
export type ProgramStatus = 'draft' | 'active' | 'paused' | 'completed';

export const PROGRAM_STATUSES: readonly ProgramStatus[] = ['draft', 'active', 'paused', 'completed'];

/** Values `weekly_check_ins.status`'s DB check constraint allows. */
export type CheckInStatus = 'pending' | 'held' | 'accepted' | 'declined';

export const CHECK_IN_STATUSES: readonly CheckInStatus[] = ['pending', 'held', 'accepted', 'declined'];

/**
 * One logged food, mirroring `public.food_log_entries`.
 *
 * THE INVARIANT THIS TYPE EXISTS TO PROTECT: `calories`, `proteinG`, `carbsG`,
 * `fatG` and `displayName` are a SNAPSHOT copied at log time and scaled to the
 * logged quantity. They are never re-derived from `foodId`/`customFoodId`/
 * `recipeId` afterwards, so correcting a food's macros — or a catalogue
 * re-import changing them underneath — cannot rewrite what the athlete
 * actually ate last month. Any code that recomputes these from the source
 * record has broken the history it was reading.
 *
 * The id columns are kept for provenance and for "log this again", not as a
 * lookup the numbers depend on. Exactly one of them is set for a `food`,
 * `custom_food` or `recipe` entry and none for `quick_add` — enforced by the
 * table's own check constraint, so a bad write fails loudly at the database
 * rather than being silently repaired here.
 */
export interface FoodLogEntry {
  id: string;
  userId: string;
  logDate: IsoDate;
  /** Free text; see `Meal` for the values the UI offers. */
  meal: string;
  entryKind: EntryKind;
  foodId?: string | null;
  customFoodId?: string | null;
  recipeId?: string | null;
  quantity: number;
  unit: string;
  /** Snapshot, scaled to `quantity` — see the type doc. Never re-derive. */
  calories: number;
  /** Snapshot, scaled to `quantity` — see the type doc. Never re-derive. */
  proteinG: number;
  /** Snapshot, scaled to `quantity` — see the type doc. Never re-derive. */
  carbsG: number;
  /** Snapshot, scaled to `quantity` — see the type doc. Never re-derive. */
  fatG: number;
  /** Snapshot of the source's name at log time — see the type doc. */
  displayName: string;
  /**
   * Nutrients copied from the source record at log time, at the SOURCE's own
   * nutrition-basis denominator (its `nutritionBasisQty`/`nutritionBasisUnit`)
   * — NOT scaled to `quantity`, unlike `calories`/`proteinG`/`carbsG`/`fatG` on
   * this same record, which ARE. Summing or averaging these across entries
   * without first scaling each one by its own basis produces a number that
   * looks plausible and is wrong.
   */
  nutrients: NutrientMap;
  notes?: string | null;
  sourceSnapshot: SourceSnapshot;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /**
   * Soft delete. A deleted entry is kept as a record with a stamp rather than
   * removed, which is what lets `mergeNutrition` stay purely additive: a
   * deletion travels as a normal newer-`updatedAt` write instead of needing a
   * separate tombstone map that a merge could fail to carry.
   */
  deletedAt?: IsoTimestamp | null;
}

/**
 * The four numbers a scaling multiplier is applied to, plus the denominator
 * they sit over. Ported from MacroTrack's `Scalable` interface, which `Food`
 * and `CustomFood` both implement so `ServingScaler` can take either.
 *
 * `servingQty`/`servingUnit` ARE the denominator: a food whose macros are per
 * 100 g carries `servingQty: 100, servingUnit: 'g'`. See `scaleTo` in
 * `recipe.ts` for why a unit that does not match is an error rather than a
 * conversion.
 */
export interface Scalable {
  /** Present because `scaleByServing` refuses a serving row from another food. */
  id: string;
  name: string;
  servingQty: number;
  servingUnit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * One named serving of a catalogue food, mirroring `public.food_servings`.
 *
 * `grams`/`millilitres` are the ONLY sanctioned route between units: they are
 * recorded per serving in the source data, so scaling "1 slice" of a per-100g
 * food goes through the real weight of a slice rather than through a guessed
 * density (MacroTrack rule #1).
 */
export interface FoodServing {
  id: string;
  foodId: string;
  label: string;
  quantity: number;
  unit: string;
  grams?: number | null;
  millilitres?: number | null;
  isDefault: boolean;
  sortOrder: number;
}

/**
 * A local copy of one `public.foods` row and its servings.
 *
 * THE SHARED CATALOGUE IS SERVER-SIDE AND THIS APP IS OFFLINE-FIRST. `foods`
 * is a 5,000-row Postgres table read over the network; it is not, and must not
 * become, part of the synced blob. This record is the narrow exception: a
 * catalogue food the athlete has actually TOUCHED — logged, favourited, or put
 * in a recipe — is copied here so that it stays searchable and loggable with
 * no connection, and so that a recipe built from catalogue ingredients can
 * still resolve its macros on a plane.
 *
 * Two rules follow from that and are enforced by the code that writes it:
 *
 *  - Nothing is cached speculatively. A search result the athlete scrolled
 *    past does not land here; caching the catalogue wholesale is the thing the
 *    rebuild scope explicitly refused.
 *  - Nothing is ever evicted. A recipe ingredient and a favourite both point
 *    at a cache row by id, so an eviction would silently break a recipe the
 *    athlete can no longer repair offline.
 *
 * A cached food is NOT a log entry's source of truth after the fact. Log
 * entries snapshot their own numbers — see `FoodLogEntry`.
 */
export interface CachedFood extends Scalable {
  brand?: string | null;
  barcode?: string | null;
  /**
   * The denominator the catalogue says `nutrients` sits over, kept because a
   * log entry copies `nutrients` unscaled and needs it to be interpretable
   * later. It is deliberately NOT what `scaleTo` divides by — see `recipe.ts`.
   */
  nutritionBasisQty: number;
  nutritionBasisUnit: string;
  servingSizeText?: string | null;
  source: string;
  externalId?: string | null;
  nutrients: NutrientMap;
  servings: FoodServing[];
  /**
   * When this device last copied the row down. Doubles as the merge stamp:
   * between two copies of one catalogue row, the more recently fetched one is
   * the closer to what the server holds.
   */
  cachedAt: IsoTimestamp;
}

/**
 * A food the athlete entered themselves, mirroring `public.custom_foods`.
 *
 * Local in every sense: it lives in this slice, is created and edited with no
 * connection, and syncs as ordinary athlete data. Editing one does NOT change
 * what it has already been logged as (see `FoodLogEntry`), which is exactly
 * why the entry keeps its own numbers.
 */
export interface CustomFood extends Scalable {
  id: string;
  userId: string;
  brand?: string | null;
  barcode?: string | null;
  nutrients: NutrientMap;
  source: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Soft delete, for the reason given on `FoodLogEntry.deletedAt`. */
  deletedAt?: IsoTimestamp | null;
}

/**
 * One ingredient of a recipe, mirroring `public.recipe_items`.
 *
 * Exactly one of `foodId`/`customFoodId` is set — the table's own check
 * constraint, and the branch `resolveRecipePerServing` refuses to guess at.
 * A `foodId` resolves against `NutritionDB.foodCache`, which is why adding a
 * catalogue food as an ingredient caches it.
 */
export interface RecipeItem {
  id: string;
  recipeId: string;
  foodId?: string | null;
  customFoodId?: string | null;
  quantity: number;
  unit: string;
  sortOrder: number;
}

/**
 * A recipe, mirroring `public.recipes`, with its items nested for the same
 * reason `MacroProgram` nests its days: a `recipe_items` row is meaningless
 * without its recipe (the SQL cascades it away on delete), and nesting removes
 * the possibility of a merge keeping items whose recipe is gone.
 *
 * `servings > 0` is a check constraint on the table. A recipe's macros are
 * never stored — they are resolved from the ingredients on demand, so
 * correcting an ingredient corrects the recipe, while everything already
 * LOGGED from it keeps the numbers it was logged with.
 */
export interface Recipe {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  servings: number;
  items: RecipeItem[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Soft delete, for the reason given on `FoodLogEntry.deletedAt`. */
  deletedAt?: IsoTimestamp | null;
}

/**
 * A starred food, custom food or recipe, mirroring `public.food_favorites`.
 *
 * Exactly one of the three ids is set, like a log entry's provenance. Kept in
 * this slice rather than fetched, so the athlete's starred list is the one
 * thing that is always there to log from with no connection.
 *
 * NO `id`, deliberately: `food_favorites` has none either. Its identity is
 * `(user_id, food_id | custom_food_id | recipe_id)`, enforced by three partial
 * unique indexes, and that is what the merge keys on — two devices starring the
 * same food offline must converge on one star, not two, exactly as `checkInKey`
 * makes two devices agree about one week.
 */
export interface FoodFavorite {
  userId: string;
  foodId?: string | null;
  customFoodId?: string | null;
  recipeId?: string | null;
  sortOrder: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Soft delete: un-starring is a stamp, or the star returns on next sync. */
  deletedAt?: IsoTimestamp | null;
}

/**
 * A weigh-in, mirroring `public.weight_entries`.
 *
 * `weight_kg numeric not null check (weight_kg between 20 and 500)` REJECTS an
 * out-of-range row; it does not clamp it. `sanitizeNutritionDB` therefore DROPS
 * a weigh-in outside 20–500 rather than pulling it to the nearest bound —
 * clamping would turn a corrupt 9000 into a plausible 500 kg weigh-in and feed
 * the trend/expenditure maths a number the athlete never stood on. A weigh-in
 * whose `measuredAt` will not parse is dropped for the same reason: that field
 * is the x-axis of every trend fit, not merge metadata.
 */
export interface WeightEntry {
  id: string;
  userId: string;
  measuredAt: IsoTimestamp;
  weightKg: number;
  /** How the weigh-in arrived: `'manual'` is MacroTrack's default. */
  source: string;
  note?: string | null;
  createdAt: IsoTimestamp;
  /**
   * Not a column in MacroTrack's schema — `weight_entries` is insert-only
   * there, so a row never changes and `created_at` is enough. It exists here
   * because this record now syncs through a merge that resolves conflicts by
   * `updatedAt`, and an editable note/correction needs a stamp of its own.
   */
  updatedAt: IsoTimestamp;
  /**
   * Soft delete, for the reason given on `FoodLogEntry.deletedAt`, and NOT
   * present in MacroTrack's schema: `WeightRepository.deleteEntry` issues a
   * real SQL `delete`, which is safe against a server that is the single
   * source of truth. `mergeNutrition` is additive, so an entry spliced out of
   * this array is restored from the other device on the very next sync — a
   * mis-typed 8.2 kg weigh-in the athlete deleted would come back and drag the
   * EWMA and the expenditure estimate with it. A deletion has to travel as a
   * newer-`updatedAt` write, exactly as it does for food.
   *
   * Purely additive at `NUTRITION_SCHEMA_VERSION` 1: a blob written before
   * this field sanitizes to `null`, which is "live", which is what those rows
   * already were.
   */
  deletedAt?: IsoTimestamp | null;
}

/** One concrete day target, mirroring `public.macro_program_days`. */
export interface MacroProgramDay {
  programId: string;
  targetDate: IsoDate;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /**
   * Why this target exists (`'engine'` by default in the schema). Required —
   * a persisted day that cannot say where its numbers came from is exactly the
   * black box MacroTrack's own rules forbid.
   */
  source: string;
  createdAt: IsoTimestamp;
}

/**
 * The athlete's calorie/macro program, mirroring `public.macro_programs`, with
 * its day targets nested rather than kept in a parallel array: a
 * `macro_program_days` row is meaningless without its program (the SQL cascades
 * it away on delete), and nesting removes the possibility of a merge keeping
 * days whose program is gone.
 *
 * `targetRateKgPerWeek` is sign-constrained against `goal` by the table
 * (`lose` <= 0, `gain` >= 0, `maintain` = 0). That is the database's rule, not
 * re-validated here.
 */
export interface MacroProgram {
  id: string;
  userId: string;
  name: string;
  mode: ProgramMode;
  goal: ProgramGoal;
  targetRateKgPerWeek: number;
  startDate: IsoDate;
  endDate?: IsoDate | null;
  weeklyCalorieBudget?: number | null;
  proteinPreference?: string | null;
  fatPreference?: string | null;
  status: ProgramStatus;
  days: MacroProgramDay[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** One coaching module offered by a check-in: a key and the action it proposes. */
export interface CheckInModule {
  key: string;
  action: string;
}

/**
 * A weekly check-in, mirroring `public.weekly_check_ins`.
 *
 * Every `proposed*` field is nullable and stays nullable on purpose: a week
 * that recomputes from "ready" to "held" must CLEAR its proposals rather than
 * keep the previous week's numbers sitting next to a held status. The Kotlin
 * upsert payload made the same fields required-but-nullable for exactly this
 * reason (an omitted field would have left the stale value in Postgres); the
 * TypeScript equivalent is that a merge must copy `null` over a number, which
 * it does because it replaces whole records, never patches fields.
 *
 * `resolvedAt` follows the same rule: recomputing an accepted week clears it.
 */
export interface CheckIn {
  id: string;
  userId: string;
  programId?: string | null;
  weekStart: IsoDate;
  weekEnd: IsoDate;
  status: CheckInStatus;
  previousExpenditureKcal?: number | null;
  observedExpenditureKcal?: number | null;
  proposedExpenditureKcal?: number | null;
  proposedCalories?: number | null;
  proposedProteinG?: number | null;
  proposedCarbsG?: number | null;
  proposedFatG?: number | null;
  modules: CheckInModule[];
  /** Human-readable reason for the proposal. Never empty — an unexplained adjustment is a black box. */
  explanation: string;
  createdAt: IsoTimestamp;
  resolvedAt?: IsoTimestamp | null;
  /** See `WeightEntry.updatedAt` — added for the merge contract, not a MacroTrack column. */
  updatedAt: IsoTimestamp;
}

/**
 * An explicit declaration about a calendar day, mirroring
 * `public.daily_log_status`. Keyed by (userId, logDate) — there is no `id`.
 *
 * This record exists so the expenditure engine cannot read an UNLOGGED day as
 * a genuine zero-calorie day (MacroTrack rule #2). `'fasted'` is a statement
 * the athlete made, never an inference from missing entries.
 *
 * A missing record and an explicit `'unlogged'` both mean "nothing declared".
 * Callers should treat them alike unless they specifically care about the
 * difference between "never asked" and "explicitly marked".
 */
export interface DayStatus {
  userId: string;
  logDate: IsoDate;
  status: DayStatusValue;
  note?: string | null;
  updatedAt: IsoTimestamp;
}

/**
 * Local nutrition preferences. Deliberately open, like `EngineDB`'s
 * `Settings`: an older or newer build's keys must survive a round trip through
 * a device that does not know them, or sync silently strips whichever side is
 * behind.
 */
export interface NutritionSettings {
  unitSystem?: 'metric' | 'imperial';
  timezone?: string;
  [key: string]: unknown;
}
