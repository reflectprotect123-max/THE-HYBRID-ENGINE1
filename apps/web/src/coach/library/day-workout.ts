import type { Block, Exercise, LoggedSet, ModeKey, Workout } from '@hybrid/engine';
import { BLOCK_CATEGORIES, type BlockValue } from './BlockEditor';
import type { SetRow } from './SetRows';
import type { DayBuilderValue } from './DayBuilder';

/**
 * The translation between what the day builder edits and what the app stores.
 *
 * Until this existed both of the builder's buttons were stubs — Stage 3a wrote
 * them as honest "not connected yet" notices rather than silent no-ops, and
 * this is what connects them. The one property worth more than any other is
 * that a session survives the round trip UNCHANGED: a save that quietly
 * rewrites a coach's programming is worse than a save that never happened.
 *
 * There is no new store. A session becomes an engine `Workout` in the
 * athlete's own `EngineDB.workouts`, which is what the Library's catalogue,
 * the Planner and the logger already read. A second store for the same idea is
 * how two screens start disagreeing about what a session is.
 */

/** The heading the coach's instructions are carried under. */
export const INSTRUCTIONS_HEADING = 'Coach instructions';

/**
 * The engine's closest name for a column pair.
 *
 * Only a label: `Exercise.cols` records what the coach actually chose, and the
 * builder reads that. This exists so every OTHER screen — which knows `mode`
 * and not `cols` — reads something true rather than a default. Order does not
 * matter; a coach may put weight first.
 */
export function modeForColumns(a: string, b: string): ModeKey {
  const has = (v: string) => a === v || b === v;
  const weight = has('weight_kg') || has('weight_pct');
  if (has('reps') || has('reps_range')) {
    if (weight) return 'reps_kg';
    if (has('seconds')) return 'reps_seconds';
    return 'reps';
  }
  if (has('seconds')) return 'seconds';
  if (weight) return 'reps_kg';
  // meters alone, or nothing chosen yet: there is no engine mode for "did it",
  // beyond this one, and inventing reps the coach never wrote would be worse.
  return 'completion';
}

/** The column pair a mode implies, for a workout authored before `cols` existed. */
function columnsForMode(mode: ModeKey): { a: string; b: string } {
  switch (mode) {
    case 'reps_kg': return { a: 'reps', b: 'weight_kg' };
    case 'reps_seconds': return { a: 'reps', b: 'seconds' };
    case 'seconds': return { a: 'seconds', b: '' };
    case 'reps':
    case 'amrap': return { a: 'reps', b: '' };
    default: return { a: '', b: '' };
  }
}

function isCategory(value: string | undefined): value is (typeof BLOCK_CATEGORIES)[number] {
  return !!value && (BLOCK_CATEGORIES as readonly string[]).includes(value);
}

/**
 * One authored block becomes a `StrengthBlock` whatever its category —
 * including Conditioning.
 *
 * That looks wrong for a second and is not: `CondBlock` has no `exercises`
 * field at all (`exercises?: undefined`), so routing a Conditioning block
 * there would discard every exercise and set row the coach typed. The builder
 * gives all five categories exercises and sets, so all five are stored as what
 * they are. The category survives as the block's `heading`, which is what
 * brings it back on reopen.
 */
function toBlock(block: BlockValue): Block<LoggedSet> {
  const exercises: Exercise<LoggedSet>[] = block.exercises.map((ex) => ({
    id: ex.id,
    name: ex.name,
    mode: modeForColumns(ex.columnA, ex.columnB),
    cols: { a: ex.columnA, b: ex.columnB },
    sets: ex.sets.map((row) => ({ t: '', rpe: '', aVal: row.a, aVal2: row.b })),
  }));
  return {
    id: block.id,
    heading: block.category,
    ...(block.category === 'Warm-up' ? { warmup: true } : {}),
    exercises,
  };
}

/**
 * The session the coach built, as the app stores it.
 *
 * `date` schedules it as a one-off on that day (`dates`), never as a recurring
 * weekday (`days`) — a calendar day is one day. `kind` is set from what was
 * actually authored and left ABSENT for an empty session, matching the rule in
 * `types.ts`: sanitizeDB infers a kind, it never guesses one.
 */
export function dayBuilderToWorkout(
  value: DayBuilderValue,
  { id, date, name }: { id: string; date?: string; name?: string },
): Workout<LoggedSet> {
  const instructions = value.instructions.trim();
  const blocks: Block<LoggedSet>[] = [
    ...(instructions ? [{ id: `${id}-instructions`, kind: 'text' as const, heading: INSTRUCTIONS_HEADING, body: instructions }] : []),
    ...value.blocks.map(toBlock),
  ];
  const authored = value.blocks;
  const kind = authored.length === 0
    ? undefined
    : authored.every((b) => b.category === 'Conditioning') ? 'conditioning' as const : 'strength' as const;

  return {
    id,
    ...(name ? { name } : {}),
    ...(kind ? { kind } : {}),
    blocks,
    ...(date ? { dates: [date] } : {}),
    updatedAt: Date.now(),
  };
}

/**
 * The stored session, back in the builder's shape.
 *
 * This must open a workout authored ANYWHERE — GuidedBuilder and Planner write
 * `t`/`rpe` and never `aVal`/`cols` — so a missing value becomes an EMPTY cell.
 * Filling it from `t` would move a coach's target reps into a column that may
 * not measure reps, which is the quiet-rewrite failure this module exists to
 * avoid.
 */
export function workoutToDayBuilder(workout: Workout<LoggedSet>): DayBuilderValue {
  const blocks = workout.blocks ?? [];
  const instructionsBlock = blocks.find(
    (b) => (b as { kind?: string }).kind === 'text' && (b as { heading?: string }).heading === INSTRUCTIONS_HEADING,
  ) as { body?: string } | undefined;

  return {
    instructions: instructionsBlock?.body ?? '',
    blocks: blocks
      .filter((b) => b !== (instructionsBlock as unknown))
      .map((block) => {
        const heading = (block as { heading?: string }).heading;
        const exercises = ((block as { exercises?: Exercise<LoggedSet>[] }).exercises ?? []).map((ex) => {
          const cols = ex.cols ?? columnsForMode(ex.mode);
          const sets: SetRow[] = (ex.sets ?? []).map((set, i) => ({
            id: `${ex.id}-s${i}`,
            a: set.aVal ?? '',
            b: set.aVal2 ?? '',
          }));
          return { id: ex.id, name: ex.name, columnA: cols.a, columnB: cols.b, sets };
        });
        return {
          id: block.id,
          // An unrecognised heading is not a category — a workout from the
          // Planner can say anything. It opens under the default rather than
          // leaving the dropdown on a value it does not offer.
          category: isCategory(heading) ? heading : BLOCK_CATEGORIES[0],
          exercises,
        };
      }),
  };
}
