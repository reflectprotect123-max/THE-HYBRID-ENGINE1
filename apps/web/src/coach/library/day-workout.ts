import type { CondBlock, CondFmtKey, EffortKey, Modality, TextBlock, Workout } from '@hybrid/engine';
import { CON_EFFORTS } from '@hybrid/engine';
import {
  BLOCK_CATEGORIES,
  CONDITIONING_CATEGORIES,
  NOTE_CATEGORIES,
  newCondValue,
  type BlockValue,
  type CondValue,
} from './BlockEditor';
import type { DayBuilderValue } from './DayBuilder';

/**
 * The translation between what the day builder edits and what the app stores.
 *
 * There is no new store. A session becomes an engine `Workout` in the
 * athlete's own `EngineDB.workouts`, which is what the Library's catalogue,
 * the Planner and the logger already read. A second store for the same idea is
 * how two screens start disagreeing about what a session is.
 *
 * SINCE 17 AUGUST 2026 this module carries no exercise/set translation at
 * all — strength authoring (`Exercise`, `StrengthBlock`, `toPlannedSet`,
 * `splitPlannedSet`, `modeForColumns`) went with the rest of the fire-sale
 * rebuild. A non-conditioning block is now a plain `TextBlock`: a heading and
 * a free-text body, nothing else.
 */

/** The heading the coach's instructions are carried under. */
export const INSTRUCTIONS_HEADING = 'Coach instructions';

function isCategory(value: string | undefined): value is (typeof BLOCK_CATEGORIES)[number] {
  return !!value && (BLOCK_CATEGORIES as readonly string[]).includes(value);
}

/** Whether a block authors conditioning rather than a free-text description. */
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
    // The category, exactly as it round-trips, and for the same reason: it is
    // what tells `workoutToDayBuilder` which of the two conditioning
    // categories this was.
    category: block.category,
    // The name the athlete reads. A template gives a section its own name
    // ("FINISHER"); without one the category is the name, which is what this
    // field held on its own before `category` existed.
    heading: block.heading?.trim() || block.category,
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
 * A Warm-up/Cooldown/Mobility block becomes a `TextBlock` — the only shape
 * left for a non-conditioning block since strength authoring was deleted.
 * `heading` falls back to the category, exactly as `toCondBlock` does, and
 * `body` is absent rather than empty when the coach never wrote a
 * description — the same absent-not-empty convention this module uses
 * everywhere else.
 */
function toTextBlock(block: BlockValue): TextBlock {
  const body = block.note?.trim();
  return {
    id: block.id,
    kind: 'text',
    heading: block.heading?.trim() || block.category,
    ...(body ? { body } : {}),
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
): Workout[] {
  const instructions = value.instructions.trim();
  const condValues = value.blocks.filter((b) => isConditioningCategory(b.category));
  const textValues = value.blocks.filter((b) => !isConditioningCategory(b.category));
  const updatedAt = Date.now();
  const scheduled = date ? { dates: [date] } : {};

  const out: Workout[] = [];

  /*
   * The non-conditioning sibling keeps the ORIGINAL id, exactly as
   * splitMixedWorkout does, so a record the engine split and a record the
   * builder wrote are the same record rather than two. It is still called
   * `kind: 'strength'` — `Workout.kind` only ever had the two values, and a
   * text-only day is not conditioning.
   */
  if (textValues.length || (instructions && !condValues.length)) {
    out.push({
      id,
      ...(name ? { name } : {}),
      kind: 'strength',
      blocks: [
        ...(instructions ? [{ id: `${id}-instructions`, kind: 'text' as const, heading: INSTRUCTIONS_HEADING, body: instructions }] : []),
        ...textValues.map(toTextBlock),
      ],
      ...scheduled,
      updatedAt,
    });
  }

  if (condValues.length) {
    /*
     * The coach's note goes on the FIRST conditioning block when there is no
     * text sibling to carry it as a text block. It cannot be a text block
     * here: splitMixedWorkout counts a text block as "other" and would tear
     * this workout in two on the next load.
     */
    const noteHere = !textValues.length ? instructions : '';
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
 */
export function workoutsToDayBuilder(workouts: readonly Workout[]): DayBuilderValue {
  const values = workouts.map(workoutToDayBuilder);
  return {
    // Exactly one of the siblings carries the note — the text one as a
    // text block, or the conditioning one on its first block. First non-empty
    // wins; there is never a second to lose.
    instructions: values.map((v) => v.instructions).find((t) => t) ?? '',
    blocks: values.flatMap((v) => v.blocks),
  };
}

export function workoutToDayBuilder(workout: Workout): DayBuilderValue {
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
        if ((block as { kind?: string }).kind === 'conditioning') {
          const cond = block as CondBlock;
          const heading = cond.heading;
          const stored = cond.category;
          /*
           * ABSENT, NOT EMPTY. `dayBuilderToWorkouts → workoutsToDayBuilder` is
           * asserted to be an identity, and a block the coach never named would
           * otherwise come back carrying `heading: ''` it did not go in with.
           */
          const named = (category: string) => (heading && heading !== category ? { heading } : {});
          const category = isCategory(stored) ? stored : isCategory(heading) ? heading : 'Conditioning';
          return {
            id: cond.id,
            category,
            ...named(category),
            conditioning: {
              fmt: cond.condFmt ?? 'steady',
              modality: cond.modality ?? '',
              effort: cond.effort ?? 'easy',
              minutes: cond.minutes === undefined ? '' : String(cond.minutes),
              targetDistanceM: cond.targetDistanceM === undefined ? '' : String(cond.targetDistanceM),
            } satisfies CondValue,
          };
        }
        // A TextBlock — Warm-up/Cooldown/Mobility, or a text block authored
        // anywhere else with a heading this dropdown does not offer.
        //
        // TextBlock has no `category` field of its own (unlike CondBlock,
        // which keeps one precisely so a custom-named conditioning section
        // survives), so the heading is the ONLY signal a TextBlock carries.
        // Matched case-INSENSITIVELY: every session template writes its
        // section names in caps ("WARM-UP"), which is the same word as the
        // category and must still round-trip as one, not fall back as an
        // unrecognised name. The fallback for a heading that matches no
        // NOTE category is the first NOTE category rather than the first
        // BLOCK category: a TextBlock never carries conditioning fields, so
        // defaulting it into 'Conditioning' would silently turn the coach's
        // words into a block they cannot see the next time this saves.
        const text = block as TextBlock;
        const heading = text.heading;
        const named = (category: string) => (heading && heading !== category ? { heading } : {});
        const category = NOTE_CATEGORIES.find((c) => c.toLowerCase() === heading?.toLowerCase()) ?? NOTE_CATEGORIES[0];
        return {
          id: text.id,
          category,
          ...named(category),
          ...(text.body ? { note: text.body } : {}),
        };
      }),
  };
}
