import { describe, expect, it } from 'vitest';
import { SESSION_TEMPLATES, templateToBlocks } from './session-templates';
import { dayBuilderToWorkouts, workoutsToDayBuilder } from './day-workout';
import { isConditioningCategory } from './day-workout';
import { BLOCK_CATEGORIES } from './BlockEditor';

/*
 * `hybrid-2-intensity`, `hybrid-1-intensity`, `hybrid-roots-1` and
 * `hybrid-roots-2` were deleted on 17 August 2026 along with the
 * Strength/Power category and the exercise-authoring model they depended on
 * — see `session-templates.ts`'s own header. `lift-and-engine` is the one
 * template left standing: it used to lead with a strength block, and now
 * leads with nothing but its conditioning piece, framed by the same warm-up
 * and cooldown it always had.
 */

const byId = (id: string) => {
  const t = SESSION_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return t;
};

describe('the templates themselves', () => {
  it('never names a section after its own category', () => {
    /* A heading equal to the category is how the builder says "this section has
       no name of its own" — it opens the name field empty. A template whose
       heading collided with its category would round-trip its name away. */
    for (const t of SESSION_TEMPLATES) {
      for (const s of t.sections) expect(s.heading).not.toBe(s.category);
    }
  });

  it('only uses categories the block dropdown actually offers', () => {
    for (const t of SESSION_TEMPLATES) {
      for (const s of t.sections) expect(BLOCK_CATEGORIES as readonly string[]).toContain(s.category);
    }
  });

  it('lifts and engine keeps its conditioning piece, framed by a warm-up and cooldown', () => {
    const sections = byId('lift-and-engine').sections;
    expect(sections.map((s) => s.category)).toEqual(['Warm-up', 'Conditioning', 'Cooldown']);
  });
});

describe('templateToBlocks', () => {
  it('mints one block per section', () => {
    const blocks = templateToBlocks(byId('lift-and-engine'));
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.heading)).toEqual(['WARM-UP', 'ENGINE', 'COOLDOWN']);
  });

  it('gives a conditioning section its dropdown defaults, at the template minutes', () => {
    /* A conditioning block with no `conditioning` value renders no fields at
       all, so the coach would be looking at an empty block they cannot edit. */
    const engine = templateToBlocks(byId('lift-and-engine')).find((b) => isConditioningCategory(b.category));
    expect(engine?.conditioning).toMatchObject({ fmt: 'steady', minutes: '20' });
  });

  it('mints ids that cannot collide with blocks already on the day', () => {
    const first = templateToBlocks(byId('lift-and-engine'));
    const second = templateToBlocks(byId('lift-and-engine'), first.map((b) => b.id));
    const ids = [...first, ...second].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips past ids still on the day after one was REMOVED', () => {
    /* The case a counter could not survive, and this used to use one: apply a
       multi-section template, delete one, apply again, and the second pass
       started where a counter would have collided with a block from the
       first pass. Two blocks sharing an id is a React key collision, and it
       lands the coach's edits in a different block from the one they typed
       in. */
    const first = templateToBlocks(byId('lift-and-engine'));
    const kept = first.filter((_, i) => i !== 1).map((b) => b.id);
    const second = templateToBlocks(byId('lift-and-engine'), kept);
    expect(second.some((b) => kept.includes(b.id))).toBe(false);
    expect(new Set([...kept, ...second.map((b) => b.id)]).size).toBe(kept.length + second.length);
  });
});

describe('a templated day, stored and reopened', () => {
  it('keeps every section name and category', () => {
    const value = { instructions: '', blocks: templateToBlocks(byId('lift-and-engine')) };
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(value, { id: 'w1' }));

    /* The note and conditioning halves are stored as separate workouts, so
       compare on the fields rather than on array order. */
    const seen = back.blocks.map((b) => ({ heading: b.heading ?? '', category: b.category }));
    expect(seen).toEqual([
      { heading: 'WARM-UP', category: 'Warm-up' },
      { heading: 'COOLDOWN', category: 'Cooldown' },
      { heading: 'ENGINE', category: 'Conditioning' },
    ]);
  });

  it('reaches the athlete as the section name, not as the block kind', () => {
    const value = { instructions: '', blocks: templateToBlocks(byId('lift-and-engine')) };
    const [textSibling] = dayBuilderToWorkouts(value, { id: 'w1' });
    expect(textSibling.blocks?.map((b) => (b as { heading?: string }).heading)).toEqual(['WARM-UP', 'COOLDOWN']);
  });
});

describe('a block authored before templates existed', () => {
  it('still opens under the right category, with an empty name', () => {
    /* Every session in the wild carries the category in `heading` and has no
       `category` field. It must open on the dropdown value it always did, and
       it must NOT show "Cooldown" typed into the section-name box. */
    const legacy = {
      id: 'old',
      kind: 'strength' as const,
      blocks: [{ id: 'b0', kind: 'text' as const, heading: 'Cooldown' }],
    };
    const back = workoutsToDayBuilder([legacy as never]);
    expect(back.blocks[0]).toMatchObject({ category: 'Cooldown' });
    /* Absent rather than empty — the round trip is asserted to be an identity,
       and a name the coach never typed must not appear on the way back. */
    expect(back.blocks[0]).not.toHaveProperty('heading');
  });

  it('opens an unrecognised heading as a NAME under the default note category', () => {
    /* A workout from elsewhere can head a text block anything. It used to lose
       the heading entirely and open under the default; now the default is
       still a note category, and the words survive as the section's name. */
    const foreign = {
      id: 'old',
      kind: 'strength' as const,
      blocks: [{ id: 'b0', kind: 'text' as const, heading: 'Squat + Row' }],
    };
    const back = workoutsToDayBuilder([foreign as never]);
    expect(back.blocks[0]).toMatchObject({ category: 'Warm-up', heading: 'Squat + Row' });
  });
});
