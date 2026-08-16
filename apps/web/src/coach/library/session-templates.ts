import { newCondValue, type BlockValue } from './BlockEditor';

/**
 * A session SHAPE, with the movements left out.
 *
 * The owner's ask, on 16 August 2026, in his own words: "a pre built template
 * where I can put a template in, and then I just need to select exercise /
 * rest timers / rpe". So a template is not a workout — it holds no exercises
 * and no sets, and it prescribes nothing. It lays out the sections a session
 * is built from, names them, budgets the minutes, and marks which ones pair.
 * Everything a coach still has to decide is still theirs to decide.
 *
 * TEMPLATES ARE NOT A SECOND BUILDER. CLAUDE.md's rule about `library/DayBuilder`
 * being the one authoring surface stands: applying a template writes ordinary
 * `BlockValue`s into the day the coach already has open, and from that moment
 * they are just blocks. There is nothing to open a template in, no template
 * store, and no way for a session to remember it came from one — which is the
 * point. A shape that could drift away from the session built on it is a
 * second source of truth.
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
  return template.sections.map((section, i) => ({
    id: mint(i),
    category: section.category,
    heading: section.heading,
    minutes: section.minutes,
    ...(section.superset ? { superset: true } : {}),
    exercises: [],
    ...(section.category === 'Conditioning' || section.category === 'Mixed modal'
      ? { conditioning: { ...newCondValue(section.category), minutes: section.minutes } }
      : {}),
  }));
}
