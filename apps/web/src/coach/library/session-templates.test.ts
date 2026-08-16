import { describe, expect, it } from 'vitest';
import { SESSION_TEMPLATES, templateToBlocks } from './session-templates';
import { dayBuilderToWorkouts, workoutsToDayBuilder } from './day-workout';
import { isConditioningCategory } from './day-workout';
import { BLOCK_CATEGORIES } from './BlockEditor';

const byId = (id: string) => {
  const t = SESSION_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return t;
};

describe('the templates themselves', () => {
  it('offers both of the shapes that were asked for — two strength pieces and one', () => {
    /* The owner's requirement in as many words: "one with 2 strength Intensity
       & another with only 1". Nothing reads a template's LENGTH, which is what
       makes a variable number of sections possible at all. */
    const two = byId('hybrid-2-intensity').sections.filter((s) => s.heading.startsWith('STRENGTH INTENSITY'));
    const one = byId('hybrid-1-intensity').sections.filter((s) => s.heading.startsWith('STRENGTH INTENSITY'));
    expect(two.map((s) => s.heading)).toEqual(['STRENGTH INTENSITY 1', 'STRENGTH INTENSITY 2']);
    expect(one.map((s) => s.heading)).toEqual(['STRENGTH INTENSITY']);
  });

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
});

describe('templateToBlocks', () => {
  it('brings no exercises and no sets — the coach still picks every movement', () => {
    const blocks = templateToBlocks(byId('hybrid-2-intensity'));
    expect(blocks).toHaveLength(6);
    expect(blocks.every((b) => b.exercises.length === 0)).toBe(true);
  });

  it('carries the name, the minutes and the pairing', () => {
    const blocks = templateToBlocks(byId('hybrid-2-intensity'));
    const finisher = blocks.find((b) => b.heading === 'FINISHER');
    expect(finisher).toMatchObject({ category: 'Strength/Power', minutes: '10', superset: true });
    /* Absent, not false — see `toBlock`. */
    expect(blocks.find((b) => b.heading === 'STRENGTH INTENSITY 1')).not.toHaveProperty('superset');
  });

  it('gives a conditioning section its dropdown defaults, at the template minutes', () => {
    /* A conditioning block with no `conditioning` value renders no fields at
       all, so the coach would be looking at an empty block they cannot edit. */
    const engine = templateToBlocks(byId('lift-and-engine')).find((b) => isConditioningCategory(b.category));
    expect(engine?.conditioning).toMatchObject({ fmt: 'steady', minutes: '20' });
  });

  it('mints ids that cannot collide with blocks already on the day', () => {
    const first = templateToBlocks(byId('hybrid-1-intensity'), 0);
    const second = templateToBlocks(byId('hybrid-1-intensity'), first.length);
    const ids = [...first, ...second].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a templated day, stored and reopened', () => {
  it('keeps every section name, its minutes and its pairing', () => {
    const value = { instructions: '', blocks: templateToBlocks(byId('hybrid-2-intensity')) };
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(value, { id: 'w1' }));

    /* The strength and conditioning halves are stored as separate workouts, so
       compare on the fields rather than on array order. */
    const seen = back.blocks.map((b) => ({
      heading: b.heading ?? '',
      category: b.category,
      minutes: b.minutes ?? '',
      superset: !!b.superset,
    }));
    expect(seen).toEqual([
      { heading: 'WARM-UP', category: 'Warm-up', minutes: '8', superset: false },
      { heading: 'STRENGTH INTENSITY 1', category: 'Strength/Power', minutes: '15', superset: false },
      { heading: 'STRENGTH INTENSITY 2', category: 'Strength/Power', minutes: '12', superset: false },
      { heading: 'STRENGTH BALANCE', category: 'Strength/Power', minutes: '10', superset: true },
      { heading: 'FINISHER', category: 'Strength/Power', minutes: '10', superset: true },
      { heading: 'COOLDOWN', category: 'Cooldown', minutes: '5', superset: true },
    ]);
  });

  it('reaches the athlete as the section name, not as the block kind', () => {
    /* `blockTitle` in @hybrid/session-authoring renders `heading`. Before the
       category moved to its own field this said "Strength/Power" on the phone
       for every strength section, which is why a template had nothing to say. */
    const value = { instructions: '', blocks: templateToBlocks(byId('hybrid-1-intensity')) };
    const [strength] = dayBuilderToWorkouts(value, { id: 'w1' });
    expect(strength.blocks?.map((b) => (b as { heading?: string }).heading)).toEqual([
      'WARM-UP',
      'STRENGTH INTENSITY',
      'STRENGTH BALANCE',
      'FINISHER',
      'COOLDOWN',
    ]);
  });

  it('still marks the warm-up section as a warm-up BLOCK', () => {
    /* `warmup: true` is what keeps prep out of tonnage and out of the earned
       working weight. It is keyed off the category, and the category is no
       longer the heading — so this is exactly the seam that could have broken. */
    const value = { instructions: '', blocks: templateToBlocks(byId('hybrid-1-intensity')) };
    const [strength] = dayBuilderToWorkouts(value, { id: 'w1' });
    const warm = strength.blocks?.find((b) => (b as { warmup?: boolean }).warmup);
    expect((warm as { heading?: string } | undefined)?.heading).toBe('WARM-UP');
  });
});

describe('a block authored before templates existed', () => {
  it('still opens under the right category, with an empty name', () => {
    /* Every session in the wild carries the category in `heading` and has no
       `category` field. It must open on the dropdown value it always did, and
       it must NOT show "Strength/Power" typed into the section-name box. */
    const legacy = {
      id: 'old',
      kind: 'strength' as const,
      blocks: [{ id: 'b0', heading: 'Cooldown', exercises: [] }],
    };
    const back = workoutsToDayBuilder([legacy as never]);
    expect(back.blocks[0]).toMatchObject({ category: 'Cooldown' });
    /* Absent rather than empty — the round trip is asserted to be an identity,
       and a name the coach never typed must not appear on the way back. */
    expect(back.blocks[0]).not.toHaveProperty('heading');
  });

  it('opens an unrecognised heading as a NAME under the default category', () => {
    /* A workout from the old Planner can head a block anything. It used to lose
       the heading entirely and open under the default; now the default is still
       the category, and the words survive as the section's name. */
    const foreign = {
      id: 'old',
      kind: 'strength' as const,
      blocks: [{ id: 'b0', heading: 'Squat + Row', exercises: [] }],
    };
    const back = workoutsToDayBuilder([foreign as never]);
    expect(back.blocks[0]).toMatchObject({ category: BLOCK_CATEGORIES[0], heading: 'Squat + Row' });
  });
});
