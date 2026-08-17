import { newCondValue, type BlockExercise, type BlockValue } from './BlockEditor';
import type { SetRow } from './SetRows';

/**
 * A session SHAPE, with the movements usually left out — and, as of
 * 17 August 2026, OPTIONALLY filled in.
 *
 * The owner's original ask, on 16 August 2026, in his own words: "a pre built
 * template where I can put a template in, and then I just need to select
 * exercise / rest timers / rpe". So the first three templates hold no
 * exercises and no sets, and prescribe nothing.
 *
 * The owner then sent two full sessions from another app and asked for them
 * "as templates… fill in just exercises & I'll adjust as needed" — real
 * movements, sets and reps, not just section shapes. `TemplateSection.exercises`
 * carries that, optionally, per section.
 *
 * TEMPLATES ARE STILL NOT A SECOND BUILDER, even with real content in them.
 * CLAUDE.md's rule about `library/DayBuilder` being the one authoring surface
 * stands: applying a template writes ordinary `BlockValue`s (and now ordinary
 * `BlockExercise`s) into the day the coach already has open, and from that
 * moment they are just blocks and exercises — editable, removable, and with no
 * memory of where they came from. There is nothing to open a template in, no
 * template store, and no way for a session to remember it came from one. A
 * shape that could drift away from the session built on it is a second source
 * of truth; seeding that session with real content on the way in does not
 * change that once it lands.
 *
 * THE NUMBER OF SECTIONS VARIES, and that was the explicit requirement — "one
 * with 2 strength intensity and another with only 1". So a template is a plain
 * list and nothing reads its length.
 */

export interface SessionTemplate {
  id: string;
  name: string;
  /** One line under the name in the picker. Says what the shape is FOR. */
  summary: string;
  sections: TemplateSection[];
}

interface TemplateSection {
  /** What the athlete will see this section called. Must not be a category name. */
  heading: string;
  /** One of `BLOCK_CATEGORIES`. */
  category: string;
  minutes: string;
  superset?: boolean;
  /**
   * Seed movements for this section, absent on every shape-only template.
   * Each becomes an ordinary `BlockExercise` with `sets` sets, all reading
   * the same shared `a`/`b` values — the same "one shared value per exercise"
   * shape the Exercise Wizard writes, because a coach opening this straight
   * into the wizard (or the block's own set-table escape hatch) should find
   * exactly what they'd expect from either path.
   */
  exercises?: TemplateExercise[];
}

interface TemplateExercise {
  name: string;
  /** `@hybrid/engine`'s `COLUMN_TYPES` value, e.g. `'reps'`. */
  columnA: string;
  /** `''` (via `NONE_COLUMN`) for a bodyweight/reps-only movement. */
  columnB: string;
  sets: number;
  /** The shared value for every set's first column. */
  a: string;
  /** The shared value for every set's second column, when `columnB` is set. */
  b?: string;
  rest: number;
  rpe?: string;
}

/**
 * The shape in the screenshots the owner sent: a warm-up, two graded strength
 * pieces, a balance block, a finisher and a cooldown.
 *
 * The minutes are his, read off the session he sent rather than invented.
 */
const HYBRID_TWO: TemplateSection[] = [
  { heading: 'WARM-UP', category: 'Warm-up', minutes: '8' },
  { heading: 'STRENGTH INTENSITY 1', category: 'Strength/Power', minutes: '15' },
  { heading: 'STRENGTH INTENSITY 2', category: 'Strength/Power', minutes: '12' },
  { heading: 'STRENGTH BALANCE', category: 'Strength/Power', minutes: '10', superset: true },
  { heading: 'FINISHER', category: 'Strength/Power', minutes: '10', superset: true },
  { heading: 'COOLDOWN', category: 'Cooldown', minutes: '5', superset: true },
];

/**
 * The same session with one strength piece instead of two.
 *
 * Its intensity block is called "STRENGTH INTENSITY", without the 1 — a lone
 * section numbered "1" implies a "2" that is not there, the same reason
 * `sessionLetters` leaves an unpaired exercise as "C" rather than "C1".
 */
const HYBRID_ONE: TemplateSection[] = [
  { heading: 'WARM-UP', category: 'Warm-up', minutes: '8' },
  { heading: 'STRENGTH INTENSITY', category: 'Strength/Power', minutes: '15' },
  { heading: 'STRENGTH BALANCE', category: 'Strength/Power', minutes: '10', superset: true },
  { heading: 'FINISHER', category: 'Strength/Power', minutes: '10', superset: true },
  { heading: 'COOLDOWN', category: 'Cooldown', minutes: '5', superset: true },
];

/** Lift then engine — the plainest hybrid day, and the one with real conditioning in it. */
const LIFT_AND_ENGINE: TemplateSection[] = [
  { heading: 'WARM-UP', category: 'Warm-up', minutes: '10' },
  { heading: 'STRENGTH', category: 'Strength/Power', minutes: '25' },
  { heading: 'ENGINE', category: 'Conditioning', minutes: '20' },
  { heading: 'COOLDOWN', category: 'Cooldown', minutes: '5' },
];

/**
 * The two sessions the owner sent from another app, 17 August 2026 — real
 * exercises and rep schemes, one block per row rather than named sections
 * (his own choice: "each row is its own block").
 *
 * Assumptions made reading the screenshots, so they're written down rather
 * than silently guessed: the "For Weight" main lift rests 180s (his own
 * words: "mains are rest 3 minutes"); everything else rests 90s, a plain
 * default — "double progression" has no representation in this app yet, so
 * the literal sets×reps from each screenshot are used rather than a guessed
 * rep-range split. Glute Ham Raise, TRX Bicep Curls, GHD Reverse Sit-Up, Rope
 * Pull-Ups and Recovery Breathing are reps-only (bodyweight); everything else
 * is reps + weight. D1/D2 and E1/E2 do NOT pair visually — `BlockValue.superset`
 * links exercises inside ONE block, and with each row its own block there is
 * no cross-block pairing left to carry.
 */
const HYBRID_ROOTS_1: TemplateSection[] = [
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Zercher Squat', columnA: 'reps', columnB: 'weight_kg', sets: 5, a: '5', rest: 180 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Glute Ham Raise', columnA: 'reps', columnB: '', sets: 4, a: '8', rest: 90 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Weighted Bar Dips', columnA: 'reps', columnB: 'weight_kg', sets: 4, a: '10', rest: 90 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'T-Bar Row (pronated)', columnA: 'reps', columnB: 'weight_kg', sets: 4, a: '10', rest: 90 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'TRX Bicep Curls', columnA: 'reps', columnB: '', sets: 3, a: '15', rest: 90 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'GHD Reverse Sit-Up', columnA: 'reps', columnB: '', sets: 3, a: '15', rest: 90 }],
  },
  {
    heading: '', category: 'Cooldown', minutes: '',
    exercises: [{ name: 'Recovery Breathing', columnA: 'reps', columnB: '', sets: 1, a: '10', rest: 0 }],
  },
];

const HYBRID_ROOTS_2: TemplateSection[] = [
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Slight Incline BB Bench Press', columnA: 'reps', columnB: 'weight_kg', sets: 5, a: '5', rest: 180 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Rope Pull-Ups', columnA: 'reps', columnB: '', sets: 1, a: '30', rest: 90 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Single Leg Assisted Pendulum Squat', columnA: 'reps', columnB: 'weight_kg', sets: 3, a: '8', rest: 90 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Symmetrical Stance DB Row - Pronated Grip', columnA: 'reps', columnB: 'weight_kg', sets: 3, a: '8', rest: 90 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Supported Single Leg RDLs', columnA: 'reps', columnB: 'weight_kg', sets: 3, a: '10', rest: 90 }],
  },
  {
    heading: '', category: 'Strength/Power', minutes: '',
    exercises: [{ name: 'Side Plank Row', columnA: 'reps', columnB: 'weight_kg', sets: 3, a: '10', rest: 90 }],
  },
];

export const SESSION_TEMPLATES: readonly SessionTemplate[] = [
  {
    id: 'hybrid-2-intensity',
    name: 'Hybrid — two strength pieces',
    summary: 'Warm-up, two graded strength blocks, balance work, a finisher and a cooldown.',
    sections: HYBRID_TWO,
  },
  {
    id: 'hybrid-1-intensity',
    name: 'Hybrid — one strength piece',
    summary: 'The same shape with a single strength block.',
    sections: HYBRID_ONE,
  },
  {
    id: 'lift-and-engine',
    name: 'Lift and engine',
    summary: 'One strength block, then a conditioning piece.',
    sections: LIFT_AND_ENGINE,
  },
  {
    id: 'hybrid-roots-1',
    name: 'Hybrid Roots — Day 1',
    summary: 'Zercher Squat, then five accessories and a cooldown, exercises already filled in.',
    sections: HYBRID_ROOTS_1,
  },
  {
    id: 'hybrid-roots-2',
    name: 'Hybrid Roots — Day 2',
    summary: 'Incline bench, then five accessories, exercises already filled in.',
    sections: HYBRID_ROOTS_2,
  },
];

/**
 * The template, as blocks the day builder can edit.
 *
 * `taken` is every block id already on the day, and the ids skip past all of
 * them. A COUNTER IS NOT ENOUGH, which is what this used to use: apply a
 * six-section template, remove one block, apply it again, and the second pass
 * starts at five — colliding with the sixth block from the first pass. Two
 * blocks sharing an id is a React key collision, and it shows up as the
 * coach's edits landing in a different block from the one they typed in.
 *
 * A conditioning section is seeded with `newCondValue`, the same defaults the
 * dropdown gives it, because a conditioning block with no `conditioning` value
 * is a block whose fields the coach cannot see.
 */
export function templateToBlocks(
  template: SessionTemplate,
  taken: readonly string[] = [],
): BlockValue[] {
  const used = new Set(taken);
  const mint = (i: number) => {
    let n = i;
    let id = `${template.id}-${n}`;
    while (used.has(id)) id = `${template.id}-${++n}`;
    used.add(id);
    return id;
  };
  return template.sections.map((section, i) => {
    const blockId = mint(i);
    return {
      id: blockId,
      category: section.category,
      heading: section.heading,
      minutes: section.minutes,
      ...(section.superset ? { superset: true } : {}),
      exercises: (section.exercises ?? []).map((ex, j) => seedExercise(blockId, j, ex)),
      ...(section.category === 'Conditioning' || section.category === 'Mixed modal'
        ? { conditioning: { ...newCondValue(section.category), minutes: section.minutes } }
        : {}),
    };
  });
}

/**
 * One seed exercise, as the ordinary `BlockExercise` the day builder edits —
 * the same shape the Exercise Wizard's own `commit()` writes: N sets sharing
 * one `a`/`b` value each. `b` is included only when the exercise tracks a
 * second measure, matching `NONE_COLUMN`'s convention elsewhere.
 */
function seedExercise(blockId: string, index: number, ex: TemplateExercise): BlockExercise {
  const id = `${blockId}-${index}-${ex.name}`;
  const sets: SetRow[] = Array.from({ length: ex.sets }, (_, i) => ({
    id: `${id}-s${i}`,
    a: ex.a,
    b: ex.columnB ? (ex.b ?? '') : '',
  }));
  return {
    id,
    name: ex.name,
    columnA: ex.columnA,
    columnB: ex.columnB,
    rest: ex.rest,
    sets: ex.rpe ? sets.map((s) => ({ ...s, rpe: ex.rpe })) : sets,
  };
}
