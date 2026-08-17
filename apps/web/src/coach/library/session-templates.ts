import { newCondValue, type BlockValue } from './BlockEditor';

/**
 * A session SHAPE — section names, kinds and minutes, with no movements to
 * choose (there is nothing left to choose since strength authoring was
 * deleted on 17 August 2026; see CLAUDE.md's "the fire-sale rebuild").
 *
 * `HYBRID_TWO`, `HYBRID_ONE`, `HYBRID_ROOTS_1` and `HYBRID_ROOTS_2` were pure
 * strength shapes (or strength shapes with real seeded exercises) and were
 * deleted whole with the category they depended on. `LIFT_AND_ENGINE` mixed a
 * strength section with a conditioning one; its strength section is gone and
 * what is left is the conditioning piece it always had, framed by the same
 * warm-up and cooldown.
 *
 * TEMPLATES ARE STILL NOT A SECOND BUILDER. CLAUDE.md's rule about
 * `library/DayBuilder` being the one authoring surface stands: applying a
 * template writes ordinary `BlockValue`s into the day the coach already has
 * open, and from that moment they are just blocks — editable, removable, and
 * with no memory of where they came from. There is nothing to open a
 * template in, no template store, and no way for a session to remember it
 * came from one.
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
}

/** Lift then engine — now just the engine piece, framed by a warm-up and cooldown, since
 *  the strength section it used to lead with was deleted on 17 August 2026. */
const LIFT_AND_ENGINE: TemplateSection[] = [
  { heading: 'WARM-UP', category: 'Warm-up', minutes: '10' },
  { heading: 'ENGINE', category: 'Conditioning', minutes: '20' },
  { heading: 'COOLDOWN', category: 'Cooldown', minutes: '5' },
];

export const SESSION_TEMPLATES: readonly SessionTemplate[] = [
  {
    id: 'lift-and-engine',
    name: 'Lift and engine',
    summary: 'A conditioning piece, framed by a warm-up and a cooldown.',
    sections: LIFT_AND_ENGINE,
  },
];

/**
 * The template, as blocks the day builder can edit.
 *
 * `taken` is every block id already on the day, and the ids skip past all of
 * them. A COUNTER IS NOT ENOUGH, which is what this used to use: apply a
 * multi-section template, remove one block, apply it again, and the second
 * pass could collide with a block from the first. Two blocks sharing an id is
 * a React key collision, and it shows up as the coach's edits landing in a
 * different block from the one they typed in.
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
    ...(section.category === 'Conditioning' || section.category === 'Mixed modal'
      ? { conditioning: { ...newCondValue(section.category), minutes: section.minutes } }
      : {}),
  }));
}
