import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type AutoCoachResolution, type AutonomyPolicy } from '@hybrid/auto-coach';
import type { AthleteStateSnapshot, StateConstraint } from '@hybrid/whole-athlete-state';
import { buildDecisionTrace } from '../src/coach/trace';

const constraint = (over: Partial<StateConstraint> = {}): StateConstraint => ({
  code: 'low_readiness',
  domain: 'both',
  hard: false,
  reason: 'Readiness is low',
  adjustment: 'Cap the session around RPE 7',
  ...over,
});

const snapshot = (constraints: StateConstraint[]): AthleteStateSnapshot =>
  ({
    schemaVersion: 1,
    asOf: '2026-08-06',
    readiness: { score: 40, band: 'low', confidence: 'good', signals: [], rationale: [] },
    recoveryDebt: { score: 10, band: 'low', daysObserved: 5, rationale: [] },
    capacity: { overall: 'moderate', strength: 'moderate', conditioning: 'moderate' },
    illness: { status: 'clear', source: 'none' },
    constraints,
    dataQuality: 'good',
    advisory: { hrvMs: null, note: '' },
  }) as AthleteStateSnapshot;

const resolution = (over: Partial<AutoCoachResolution> = {}): AutoCoachResolution =>
  ({
    schemaVersion: 1,
    state: 'advisory',
    originalWorkoutId: 'w1',
    resolvedWorkout: { id: 'w1', name: 'Session', blocks: [] },
    operations: [],
    signals: [],
    inferences: [],
    reasonCodes: [],
    confidence: 'high',
    requiresConfirmation: false,
    autoApplyAllowed: false,
    athleteMessage: '',
    ...over,
  }) as AutoCoachResolution;

const op = (reasonCode: string, type = 'cap_intensity') =>
  ({
    type,
    targetPath: 'blocks[0]',
    before: 'effort hard',
    after: 'effort medium',
    reasonCode,
    materiality: 'low',
    reversible: true,
  }) as AutoCoachResolution['operations'][number];

const policyWith = (over: Partial<AutonomyPolicy>): AutonomyPolicy => ({
  ...DEFAULT_POLICY,
  ...over,
});

describe('buildDecisionTrace', () => {
  it('attributes an operation to the constraint whose code it carries', () => {
    const trace = buildDecisionTrace(
      snapshot([constraint()]),
      resolution({ operations: [op('low_readiness')] }),
      DEFAULT_POLICY,
      'strength',
    );
    expect(trace.lines).toHaveLength(1);
    expect(trace.lines[0].outcome).toBe('applied');
    expect(trace.lines[0].operations).toHaveLength(1);
    expect(trace.unattributedOperations).toEqual([]);
  });

  it('marks a constraint scoped to the other domain as out_of_domain', () => {
    const trace = buildDecisionTrace(
      snapshot([constraint({ code: 'time_limited', domain: 'conditioning' })]),
      resolution(),
      DEFAULT_POLICY,
      'strength',
    );
    expect(trace.lines[0].outcome).toBe('out_of_domain');
  });

  it('distinguishes a suppressed permission from nothing-to-change', () => {
    const off = policyWith({
      permissions: { cap_intensity: 'off', trim_conditioning_minutes: 'ask_first', hold_progression: 'off' },
    });
    expect(
      buildDecisionTrace(snapshot([constraint()]), resolution(), off, 'strength').lines[0].outcome,
    ).toBe('permission_off');

    // Same constraint, same empty result — but the policy allowed it, so the
    // honest reading is that the session had nothing matching to change.
    expect(
      buildDecisionTrace(snapshot([constraint()]), resolution(), DEFAULT_POLICY, 'strength').lines[0]
        .outcome,
    ).toBe('no_change');
  });

  it('only reports permission_off when EVERY acting permission is off', () => {
    const partly = policyWith({
      permissions: { cap_intensity: 'off', trim_conditioning_minutes: 'off', hold_progression: 'auto' },
    });
    // low_readiness is actionable via cap_intensity OR hold_progression.
    expect(
      buildDecisionTrace(snapshot([constraint()]), resolution(), partly, 'strength').lines[0].outcome,
    ).toBe('no_change');
  });

  it('reports soft constraints as not reached when a hard flag stopped the session', () => {
    const state = snapshot([
      constraint({ code: 'pain_hold_active', hard: true, reason: 'Pain hold', adjustment: 'Stop' }),
      constraint(),
    ]);
    const trace = buildDecisionTrace(
      state,
      resolution({ state: 'safety_stop', operations: [op('pain_hold_active', 'rest_or_pause')] }),
      DEFAULT_POLICY,
      'strength',
    );
    expect(trace.lines[0].outcome).toBe('applied');
    expect(trace.lines[1].outcome).toBe('superseded_by_safety');
  });

  it('reports everything as not_evaluated when the policy is not active', () => {
    const paused = policyWith({ status: 'paused' });
    const trace = buildDecisionTrace(
      snapshot([constraint(), constraint({ code: 'time_limited' })]),
      resolution({ reasonCodes: ['policy_paused'], abstentionReason: 'policy_not_active' }),
      paused,
      'strength',
    );
    expect(trace.lines.map((l) => l.outcome)).toEqual(['not_evaluated', 'not_evaluated']);
  });

  it('names a constraint the v1 resolver has no operation for', () => {
    const trace = buildDecisionTrace(
      snapshot([constraint({ code: 'physical_load_high' })]),
      resolution(),
      DEFAULT_POLICY,
      'strength',
    );
    expect(trace.lines[0].outcome).toBe('no_action_defined');
  });

  it('collects operations that no active constraint accounts for', () => {
    const trace = buildDecisionTrace(
      snapshot([]),
      resolution({ operations: [op('recovery_debt_high', 'hold_progression')] }),
      DEFAULT_POLICY,
      'strength',
    );
    expect(trace.lines).toEqual([]);
    expect(trace.unattributedOperations).toHaveLength(1);
  });

  it('ignores the keep_as_planned placeholder entirely', () => {
    const trace = buildDecisionTrace(
      snapshot([constraint()]),
      resolution({ state: 'normal', operations: [op('no_material_conflict', 'keep_as_planned')] }),
      DEFAULT_POLICY,
      'strength',
    );
    expect(trace.lines[0].operations).toEqual([]);
    expect(trace.lines[0].outcome).toBe('no_change');
    expect(trace.unattributedOperations).toEqual([]);
  });
});
