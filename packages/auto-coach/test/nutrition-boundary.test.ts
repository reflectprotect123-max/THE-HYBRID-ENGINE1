import { describe, expect, it } from 'vitest';
import type { Workout } from '@hybrid/engine';
import type { AthleteStateSnapshot, StateConstraint } from '@hybrid/whole-athlete-state';
import { DEFAULT_POLICY, resolveSession } from '../src/index';

/*
 * BOUNDARY 3 of CLAUDE.md's amended nutrition rule, at the layer where a
 * session is actually changed: pain and illness outrank every nutrition signal.
 *
 * The Coordinator test proves nutrition cannot move a WEEK. This proves it
 * cannot move a DAY either — auto-coach is the other thing that rewrites
 * training from a constraint list, and a `low_energy_availability` row arriving
 * in that list must be inert.
 *
 * Inert is the whole design: the resolver dispatches on specific constraint
 * CODES, so an unrecognised soft constraint produces no operation. This file
 * pins that, because "the resolver happens not to handle it yet" and "the
 * resolver must never handle it" look identical in the source.
 */

const sets = (n: number, t: string, rpe: string) => Array.from({ length: n }, () => ({ t, rpe }));

const workout = (): Workout =>
  ({
    id: 'w-str',
    name: 'Heavy Lower',
    kind: 'strength',
    blocks: [
      { id: 'work', exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets: sets(5, '5', '9') }] },
    ],
  }) as Workout;

const FUELLING: StateConstraint = {
  code: 'low_energy_availability',
  domain: 'both',
  hard: false,
  reason: 'Logged intake averages about 2400 kcal/day below the estimated expenditure.',
  adjustment: 'Expect less at the top end.',
};

const PAIN: StateConstraint = {
  code: 'pain_hold_active',
  domain: 'both',
  hard: true,
  reason: 'Pain hold: lower back.',
  adjustment: 'Do not push through the flagged pain.',
};

const snapshot = (constraints: StateConstraint[]): AthleteStateSnapshot =>
  ({
    schemaVersion: 1,
    asOf: '2026-08-07',
    readiness: { score: 80, band: 'high', confidence: 'good', signals: [], rationale: [] },
    recoveryDebt: { score: 5, band: 'low', daysObserved: 5, rationale: [] },
    capacity: { overall: 'high', strength: 'high', conditioning: 'high' },
    illness: { status: 'clear', source: 'none' },
    constraints,
    dataQuality: 'good',
    advisory: { hrvMs: null, note: '' },
  }) as AthleteStateSnapshot;

describe('a nutrition constraint cannot rewrite a session', () => {
  it('changes nothing about the resolved session', () => {
    const withFuelling = resolveSession({ workout: workout(), policy: DEFAULT_POLICY, state: snapshot([FUELLING]) });
    const without = resolveSession({ workout: workout(), policy: DEFAULT_POLICY, state: snapshot([]) });
    // Byte-identical, including the `keep_as_planned` no-op the resolver
    // always emits: nothing about the fuelling row reaches the output at all.
    expect(JSON.stringify(withFuelling)).toEqual(JSON.stringify(without));
    expect(withFuelling.operations.map((o) => o.reasonCode)).not.toContain('low_energy_availability');
  });

  it('cannot soften a pain hold into an ordinary adaptation', () => {
    const r = resolveSession({
      workout: workout(),
      policy: DEFAULT_POLICY,
      // Nutrition listed FIRST, to prove ordering does not buy it precedence.
      state: snapshot([FUELLING, PAIN]),
    });
    expect(r.state).toBe('safety_stop');
    expect(r.reasonCodes).toEqual(['pain_hold_active']);
    expect(r.autoApplyAllowed).toBe(false);
    expect(r.reasonCodes).not.toContain('low_energy_availability');
  });
});
