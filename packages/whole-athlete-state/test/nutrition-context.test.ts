import { describe, expect, it } from 'vitest';
import { emptySharedCore } from '@hybrid/shared-core';
import { deriveAthleteState, type NutritionContext } from '../src';

/*
 * The three boundaries CLAUDE.md's amended nutrition rule draws, as tests.
 *
 * These are NOT happy-path tests. Each one is written so that it fails if the
 * wall it guards is quietly removed later:
 *
 *  1. A nutrition TARGET is never read as an instruction. Proven structurally
 *     (`NutritionContext` has no target field, so the fixture below cannot even
 *     express one) and behaviourally, in the adapter suite, by projecting two
 *     slices whose targets differ wildly and asserting the facts are identical.
 *  2. Nutrition never edits a weekly plan. Proven where the plan is actually
 *     built — `packages/coordinator/test/nutrition-boundary.test.ts` — because
 *     that is the only place the claim means anything.
 *  3. Pain and illness outrank every nutrition signal. Proven here: no
 *     nutrition constraint is ever hard, the safety constraints survive
 *     untouched beside the most extreme fuelling deficit expressible, and
 *     nutrition cannot move the readiness score that the softer training
 *     adaptations key on.
 */

const STARVING: NutritionContext = {
  windowDays: 7,
  loggedDays: 7,
  meanIntakeKcal: 400,
  estimatedExpenditureKcal: 3200,
};

const WELL_FED: NutritionContext = {
  windowDays: 7,
  loggedDays: 7,
  meanIntakeKcal: 3200,
  estimatedExpenditureKcal: 3200,
};

const painAndIllness = () => {
  const core = emptySharedCore(1);
  core.safety = {
    painHold: { active: true, areas: ['lower back'], updatedAt: 1 },
    illness: { status: 'active', updatedAt: 1 },
  };
  return core;
};

describe('nutrition facts as whole-athlete-state context', () => {
  it('reads energy availability as a SOFT constraint when the window is well logged', () => {
    const out = deriveAthleteState({ core: emptySharedCore(1), today: '2026-08-07', nutrition: STARVING });
    const fuelling = out.constraints.find((c) => c.code === 'low_energy_availability');
    expect(fuelling).toBeDefined();
    expect(fuelling?.hard).toBe(false);
    // The adjustment talks about the SESSION, never about what to eat: telling
    // the athlete to eat here would be nutrition prescription outside
    // @hybrid/nutrition-engine.
    expect(fuelling?.adjustment).not.toMatch(/\beat\b|calorie|protein|macro/i);
  });

  it('says nothing at all when the athlete is eating at their expenditure', () => {
    const out = deriveAthleteState({ core: emptySharedCore(1), today: '2026-08-07', nutrition: WELL_FED });
    expect(out.constraints.map((c) => c.code)).not.toContain('low_energy_availability');
  });

  /*
   * ADHERENCE GATES THE FACT. A single logged day inside a week is a
   * measurement of app usage, not of intake, and acting on it would put a
   * constraint on an athlete who simply stopped logging.
   */
  it('ignores a deficit computed from a thinly logged window', () => {
    const out = deriveAthleteState({
      core: emptySharedCore(1),
      today: '2026-08-07',
      nutrition: { ...STARVING, loggedDays: 2 },
    });
    expect(out.constraints.map((c) => c.code)).not.toContain('low_energy_availability');
  });

  it('treats a holding expenditure estimate as unknown, not as zero', () => {
    const out = deriveAthleteState({
      core: emptySharedCore(1),
      today: '2026-08-07',
      nutrition: { ...STARVING, estimatedExpenditureKcal: null },
    });
    expect(out.constraints.map((c) => c.code)).not.toContain('low_energy_availability');
  });

  /* ---- BOUNDARY 1: a target is not an instruction ---------------------- */

  it('exposes no channel through which a macro target could arrive', () => {
    /* The compile-time half of boundary 1. `NutritionContext` is four
       observations; if someone adds `targetCalories` to it, this object literal
       stops being an exhaustive description of the type and the next reader has
       to notice. The behavioural half lives in the adapter suite, which builds
       the context from a slice that DOES carry a program. */
    const keys = Object.keys(STARVING).sort();
    expect(keys).toEqual(['estimatedExpenditureKcal', 'loggedDays', 'meanIntakeKcal', 'windowDays']);
  });

  /* ---- BOUNDARY 3: pain and illness win ------------------------------- */

  it('never raises a hard constraint from a nutrition fact', () => {
    const out = deriveAthleteState({ core: emptySharedCore(1), today: '2026-08-07', nutrition: STARVING });
    expect(out.constraints.filter((c) => c.hard)).toEqual([]);
  });

  it('leaves the pain and illness constraints first, hard, and unaltered', () => {
    const withFacts = deriveAthleteState({ core: painAndIllness(), today: '2026-08-07', nutrition: STARVING });
    const withoutFacts = deriveAthleteState({ core: painAndIllness(), today: '2026-08-07' });

    const safety = withFacts.constraints.filter((c) => c.hard).map((c) => c.code);
    expect(safety).toEqual(['pain_hold_active', 'illness_flag_active']);
    // Ordering, not just membership: the safety flags stay at the head of the
    // list, so a consumer that reads the first constraint reads a safety flag.
    expect(withFacts.constraints.slice(0, 2)).toEqual(withoutFacts.constraints.slice(0, 2));
    // The illness status itself is untouched by anything the food log says.
    expect(withFacts.illness).toEqual(withoutFacts.illness);
  });

  /*
   * The side door. `low_readiness` and `recovery_debt_high` ARE acted on —
   * auto-coach caps intensity and holds progression off them — so if nutrition
   * could move the readiness score it would be editing training without ever
   * emitting a nutrition constraint. It must not, in either direction.
   */
  it('cannot move the readiness score, the recovery debt or the capacity bands', () => {
    const core = emptySharedCore(1);
    core.recovery = [{ id: 'r1', date: '2026-08-07', sleepHours: 7, energy: 6, soreness: 4, stress: 4, recordedAt: 1 }];
    const starving = deriveAthleteState({ core, today: '2026-08-07', nutrition: STARVING });
    const fed = deriveAthleteState({ core, today: '2026-08-07', nutrition: WELL_FED });
    const none = deriveAthleteState({ core, today: '2026-08-07' });

    expect(starving.readiness).toEqual(none.readiness);
    expect(fed.readiness).toEqual(none.readiness);
    expect(starving.recoveryDebt).toEqual(none.recoveryDebt);
    expect(starving.capacity).toEqual(none.capacity);
    expect(starving.dataQuality).toBe(none.dataQuality);
    // The only difference the facts are allowed to make is one extra soft row.
    expect(starving.constraints.filter((c) => c.code !== 'low_energy_availability')).toEqual(none.constraints);
  });
});
