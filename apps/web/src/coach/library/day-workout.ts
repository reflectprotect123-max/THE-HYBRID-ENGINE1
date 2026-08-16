import type { Block, CondBlock, CondFmtKey, EffortKey, Exercise, LoggedSet, Modality, ModeKey, Workout } from '@hybrid/engine';
import { CON_EFFORTS, isWarmup, loadKgOf, loadPctOf } from '@hybrid/engine';
import {
  BLOCK_CATEGORIES,
  CONDITIONING_CATEGORIES,
  DEFAULT_REST_SEC,
  newCondValue,
  type BlockValue,
  type CondValue,
} from './BlockEditor';
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

/** Whether a block authors conditioning rather than exercises and sets. */
export function isConditioningCategory(category: string): boolean {
  return CONDITIONING_CATEGORIES.includes(category);
}

/**
 * The id of the conditioning sibling of `id`.
 *
 * `<id>-cond` is the engine's OWN convention — `sanitizeDB`'s `condSiblingId`
 * derives exactly this when it splits a legacy mixed workout. Matching it means
 * a day the builder wrote and a day the engine split converge on one pair of
 * records instead of accumulating duplicates.
 */
export function condSiblingId(id: string): string {
  return `${id}-cond`;
}

/** A finite number, or undefined. Never NaN, which survives into every later read. */
function num(value: string): number | undefined {
  const n = Number(value.trim());
  return value.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

function toCondBlock(block: BlockValue, note: string): CondBlock {
  const value = block.conditioning ?? newCondValue(block.category);
  const effort = (['easy', 'medium', 'hard'].includes(value.effort) ? value.effort : 'easy') as EffortKey;
  const minutes = num(value.minutes);
  const metres = num(value.targetDistanceM);
  return {
    id: block.id,
    kind: 'conditioning',
    // The category, exactly as the strength path stores it, and for the same
    // reason: it is what tells `workoutsToDayBuilder` which of the two
    // conditioning categories this was.
    heading: block.category,
    condFmt: value.fmt as CondFmtKey,
    effort,
    // Kept in lockstep with `effort` — types.ts: "so older read paths still
    // work", and the live conditioning engine reads the zone, not the effort.
    targetZone: CON_EFFORTS[effort].zone,
    // Absent, not '', when the block has no single modality. types.ts calls
    // that "unlabeled/general conditioning", which is what Mixed modal is.
    ...(value.modality ? { modality: value.modality as Modality } : {}),
    ...(minutes !== undefined ? { minutes } : {}),
    ...(metres !== undefined ? { targetDistanceM: metres } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * One authored block becomes a `StrengthBlock` — for every category that is
 * not conditioning.
 *
 * Warm-up, Cooldown and Mobility all hold exercises and sets, so all three are
 * stored as what they are, with the category surviving as the block's
 * `heading`. Conditioning and Mixed modal go through `toCondBlock` instead.
 */
/**
 * ONE AUTHORED SET BECOMES A PLANNED ONE — a target, not a result.
 *
 * THE BUG THIS REPLACES, found on 16 August 2026 and live for as long as this
 * screen has existed: the coach's two authored values went straight into
 * `aVal`/`aVal2` with `t` and `rpe` left empty. Those are the LOGGER's fields.
 * `emit.ts` states the rule in as many words — "the athlete's logger, never
 * the coach, writes the actual-result set fields; a target can never
 * masquerade as a logged result" — and `assertWorkout` enforced it against a
 * path with no traffic before being deleted with the rest of the unused
 * surface.
 *
 * What it cost, all of it silent:
 *
 *   - `repFloorOf('')` is 0, so the athlete's reps field opened at zero and
 *     nothing could be "missed".
 *   - `rpeCenterOf({rpe:''})` falls back to 8.5, so every set was judged
 *     against a default the coach never chose and the fold could not move.
 *   - The weight WORKED, by accident: `readExercise` takes its opener from
 *     `saneKg(aVal)`, which happened to hold the coach's number.
 *
 * The mapping now, and it is decided by what each column MEASURES rather than
 * by its position — a coach may write weight first:
 *
 *   reps / reps_range / seconds / meters  ->  `t`, the rep or duration target
 *   weight_kg                             ->  `@Nkg` appended to `t`
 *   weight_pct                            ->  `@N%` appended to `t`
 *
 * `t` carrying the load behind an `@` is the engine's own documented escape
 * hatch, not an invention here: `PlannedSet` is contractually exactly
 * `{ t, rpe }`, two suites assert it, and `loadPctOf`/`loadKgOf` are where
 * that lives.
 *
 * `rpe` IS STILL EMPTY, deliberately and not by omission. The builder has no
 * RPE control — the mockup has none either — and an empty `rpe` is a defined
 * value: `rpeCenterOf` reads it as the 8.5 default centre. Writing a number
 * the coach never chose would be worse than the documented default. Giving
 * them a control to choose one is a feature, not this fix.
 */
function toPlannedSet(row: SetRow, columnA: string, columnB: string): LoggedSet {
  const value = (col: string) => (col === columnA ? row.a : col === columnB ? row.b : '');
  const has = (col: string) => columnA === col || columnB === col;

  const reps = ['reps', 'reps_range', 'seconds', 'meters'].find(has);
  const parts: string[] = [];
  if (reps) {
    const v = value(reps).trim();
    if (v) parts.push(v);
  }
  /*
   * `W` FIRST OR NOT AT ALL. `isWarmup` tests the first character of `t`, so a
   * ramp set marked anywhere else in the string is simply a working set as far
   * as the fold, `liftMoves` and `openingLoadFor` are concerned — and it would
   * then teach the progression that the working weight is whatever the empty
   * bar weighed.
   */
  if (row.warm) parts.unshift(parts.length ? 'W' + parts.shift() : 'W');
  if (has('weight_kg')) {
    const kg = value('weight_kg').trim();
    if (kg) parts.push(`@${kg}kg`);
  } else if (has('weight_pct')) {
    const pct = value('weight_pct').trim();
    if (pct) parts.push(`@${pct}%`);
  }

  // `t` and `rpe` ONLY. No aVal, no aVal2, no done — nothing on a planned set
  // may look like something the athlete already did.
  return { t: parts.join(' '), rpe: '' };
}

/**
 * A planned set, back into the two columns the builder edits.
 *
 * The exact inverse of `toPlannedSet`, and it has to be: a day the coach saves
 * and reopens must show what they typed, not a reading of it. Anything the
 * round trip cannot carry is a field the builder would silently erase on the
 * next save.
 *
 * It reads `t` and `t` only. `aVal`/`aVal2` belong to the athlete's logger, and
 * a session that has been TRAINED carries real logged values in them — reading
 * those back into the editor would show a coach the athlete's performance
 * where their own prescription should be, and then save it as the plan.
 */
function splitPlannedSet(set: LoggedSet, columnA: string, columnB: string): Omit<SetRow, 'id'> {
  const t = set.t ?? '';
  const kg = loadKgOf(t);
  const pct = loadPctOf(t);
  // Everything that is not the `@…` load chunk is the rep or duration target.
  const reps = t
    .replace(/@\s*\d+(?:\.\d+)?\s*(?:%|kg)/gi, ' ')
    // The `W` marker is carried by `warm`, not by the reps cell — leaving it
    // in would show the coach "W10" in a box labelled Reps and then save it
    // back with a second W on the front.
    .replace(/^\s*W/i, '')
    .trim();

  const forColumn = (col: string): string => {
    if (col === 'weight_kg') return kg == null ? '' : String(kg);
    if (col === 'weight_pct') return pct == null ? '' : String(pct);
    if (['reps', 'reps_range', 'seconds', 'meters'].includes(col)) return reps;
    return '';
  };

  // `warm` only when it IS one: an explicit `false` on every working set would
  // round-trip as noise through every stored session.
  return { a: forColumn(columnA), b: forColumn(columnB), ...(isWarmup(set) ? { warm: true } : {}) };
}

function toBlock(block: BlockValue): Block<LoggedSet> {
  const exercises: Exercise<LoggedSet>[] = block.exercises.map((ex) => ({
    id: ex.id,
    name: ex.name,
    mode: modeForColumns(ex.columnA, ex.columnB),
    cols: { a: ex.columnA, b: ex.columnB },
    /*
     * THE REST THE ATHLETE GETS BETWEEN THESE SETS.
     *
     * `restAfter` in @hybrid/session-authoring reads `exercises[i].rest` and
     * returns null at zero — so before this field was authored, a coach's
     * session ran with NO rest timer at all. The countdown, the notification
     * and the rest chip all existed and none of them ever fired for published
     * work; they only ran for sessions the athlete had built themselves.
     */
    rest: ex.rest,
    sets: ex.sets.map((row) => toPlannedSet(row, ex.columnA, ex.columnB)),
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
export function dayBuilderToWorkouts(
  value: DayBuilderValue,
  { id, date, name }: { id: string; date?: string; name?: string },
): Workout<LoggedSet>[] {
  const instructions = value.instructions.trim();
  const condValues = value.blocks.filter((b) => isConditioningCategory(b.category));
  const liftValues = value.blocks.filter((b) => !isConditioningCategory(b.category));
  const updatedAt = Date.now();
  const scheduled = date ? { dates: [date] } : {};

  const out: Workout<LoggedSet>[] = [];

  /*
   * The strength sibling keeps the ORIGINAL id, exactly as splitMixedWorkout
   * does, so a record the engine split and a record the builder wrote are the
   * same record rather than two.
   */
  if (liftValues.length || (instructions && !condValues.length)) {
    out.push({
      id,
      ...(name ? { name } : {}),
      kind: 'strength',
      blocks: [
        ...(instructions ? [{ id: `${id}-instructions`, kind: 'text' as const, heading: INSTRUCTIONS_HEADING, body: instructions }] : []),
        ...liftValues.map(toBlock),
      ],
      ...scheduled,
      updatedAt,
    });
  }

  if (condValues.length) {
    /*
     * The coach's note goes on the FIRST conditioning block when there is no
     * strength sibling to carry it as a text block. It cannot be a text block
     * here: splitMixedWorkout counts a text block as "other" and would tear
     * this workout in two on the next load.
     */
    const noteHere = !liftValues.length ? instructions : '';
    out.push({
      id: condSiblingId(id),
      ...(name ? { name: `${name} — Conditioning` } : {}),
      kind: 'conditioning',
      blocks: condValues.map((block, i) => toCondBlock(block, i === 0 ? noteHere : '')),
      ...scheduled,
      updatedAt,
    });
  }

  /* An empty day writes one empty workout, with no kind — types.ts: sanitizeDB
     infers a kind, it never guesses one, and neither does this. */
  if (!out.length) out.push({ id, ...(name ? { name } : {}), blocks: [], ...scheduled, updatedAt });
  return out;
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
export function workoutsToDayBuilder(workouts: readonly Workout<LoggedSet>[]): DayBuilderValue {
  const values = workouts.map(workoutToDayBuilder);
  return {
    // Exactly one of the siblings carries the note — the strength one as a
    // text block, or the conditioning one on its first block. First non-empty
    // wins; there is never a second to lose.
    instructions: values.map((v) => v.instructions).find((t) => t) ?? '',
    blocks: values.flatMap((v) => v.blocks),
  };
}

export function workoutToDayBuilder(workout: Workout<LoggedSet>): DayBuilderValue {
  const blocks = workout.blocks ?? [];
  const instructionsBlock = blocks.find(
    (b) => (b as { kind?: string }).kind === 'text' && (b as { heading?: string }).heading === INSTRUCTIONS_HEADING,
  ) as { body?: string } | undefined;
  /* A conditioning-only day keeps the note on its first block instead — see
     `dayBuilderToWorkouts` for why it cannot be a text block there. */
  const condNote = (blocks.find((b) => (b as { kind?: string }).kind === 'conditioning') as CondBlock | undefined)?.note;

  return {
    instructions: instructionsBlock?.body ?? condNote ?? '',
    blocks: blocks
      .filter((b) => b !== (instructionsBlock as unknown))
      .map((block) => {
        const heading = (block as { heading?: string }).heading;
        if ((block as { kind?: string }).kind === 'conditioning') {
          const cond = block as CondBlock;
          return {
            id: cond.id,
            category: isCategory(heading) ? heading : 'Conditioning',
            exercises: [],
            conditioning: {
              fmt: cond.condFmt ?? 'steady',
              modality: cond.modality ?? '',
              effort: cond.effort ?? 'easy',
              minutes: cond.minutes === undefined ? '' : String(cond.minutes),
              targetDistanceM: cond.targetDistanceM === undefined ? '' : String(cond.targetDistanceM),
            } satisfies CondValue,
          };
        }
        const exercises = ((block as { exercises?: Exercise<LoggedSet>[] }).exercises ?? []).map((ex) => {
          const cols = ex.cols ?? columnsForMode(ex.mode);
          const sets: SetRow[] = (ex.sets ?? []).map((set, i) => ({
            id: `${ex.id}-s${i}`,
            ...splitPlannedSet(set, cols.a, cols.b),
          }));
          return {
            id: ex.id,
            name: ex.name,
            columnA: cols.a,
            columnB: cols.b,
            rest: ex.rest ?? DEFAULT_REST_SEC,
            sets,
          };
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
