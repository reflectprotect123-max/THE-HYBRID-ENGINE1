import { describe, expect, it } from 'vitest';
import { computeSetAdjustment } from '../src/autoreg';
import { explainSetAdjustment } from '../src/adaptive/explain';

describe('explainSetAdjustment', () => {
  it('wraps a missed set as reduce_load with a stable reason code, without altering the underlying math', () => {
    const adj = computeSetAdjustment(3, 10, 5, 24.9, 10);
    expect(adj).toEqual({ delta: -2.4, newWeight: 22.5, verdict: 'missed the rep floor', cls: 'bad' });
    expect(explainSetAdjustment(adj)).toEqual({
      action: 'reduce_load',
      confidence: 'high',
      reasonCodes: ['missed_rep_floor'],
      note: 'missed the rep floor',
      safetyState: 'approved',
      dataLimitations: [],
    });
  });

  it('wraps an exact on-target hold as hold', () => {
    const adj = computeSetAdjustment(5, 8.5, 5, 101, 8.5);
    const explained = explainSetAdjustment(adj);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['on_target']);
    expect(explained.note).toBe('right on target');
  });

  it('wraps an easy set (delta > 0) as progress_load', () => {
    const adj = computeSetAdjustment(5, 6, 0, 100, 8.5);
    expect(adj.delta).toBeGreaterThan(0);
    const explained = explainSetAdjustment(adj);
    expect(explained.action).toBe('progress_load');
    expect(explained.reasonCodes).toEqual(['too_light']);
  });

  it('wraps an on-target set with negative delta as hold (verdict overrides delta sign)', () => {
    const adj = computeSetAdjustment(5, 9.0, 0, 200, 8.5);
    // Verify the fixture: should have negative delta but "right on target" verdict
    expect(adj.delta).toBeLessThan(0);
    expect(adj.verdict).toBe('right on target');
    expect(adj.newWeight).toBe(197.5);
    const explained = explainSetAdjustment(adj);
    // The key fix: even though delta is negative, verdict is 'right on target' so action is 'hold'
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['on_target']);
    expect(explained.note).toBe('right on target');
  });
});

import { nextWorkingWeight } from '../src/lift';
import { explainWorkingWeight } from '../src/adaptive/explain';

describe('explainWorkingWeight', () => {
  it('reports pause_insufficient_data when nothing has been earned yet', () => {
    expect(nextWorkingWeight('Back squat', {})).toBeNull();
    const explained = explainWorkingWeight(null);
    expect(explained).toEqual({
      action: 'pause_insufficient_data',
      confidence: 'low',
      reasonCodes: ['no_earned_weight'],
      note: 'No working weight has been earned for this movement yet.',
      safetyState: 'approved',
      dataLimitations: ['no_lift_history'],
    });
  });

  it('holds at the earned weight on a green or amber day, with a non-empty note even though WorkingWeight.note is empty', () => {
    const settings = { liftProgress: { 'back squat': { kg: 100, at: 1 } } };
    const w = nextWorkingWeight('Back squat', settings, { recoveryScore: 80 });
    expect(w?.note).toBe('');
    const explained = explainWorkingWeight(w, 80);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['at_earned_weight']);
    expect(explained.confidence).toBe('high');
    expect(explained.note).toBe('At your earned working weight.');
    expect(explained.dataLimitations).toEqual([]);
  });

  it('reports low confidence and no_recovery_data when no recovery reading is passed (default, no second arg)', () => {
    const settings = { liftProgress: { 'back squat': { kg: 100, at: 1 } } };
    const w = nextWorkingWeight('Back squat', settings, { recoveryScore: 80 });
    const explained = explainWorkingWeight(w);
    expect(explained.action).toBe('hold');
    expect(explained.confidence).toBe('low');
    expect(explained.dataLimitations).toEqual(['no_recovery_data']);
  });

  it('reports high confidence and no data limitations when a recovery reading is passed', () => {
    const settings = { liftProgress: { 'back squat': { kg: 100, at: 1 } } };
    const w = nextWorkingWeight('Back squat', settings, { recoveryScore: 80 });
    const explained = explainWorkingWeight(w, 80);
    expect(explained.confidence).toBe('high');
    expect(explained.dataLimitations).toEqual([]);
  });

  it('eases and explains why on a red day', () => {
    const settings = { liftProgress: { 'back squat': { kg: 100, at: 1 } } };
    const w = nextWorkingWeight('Back squat', settings, { recoveryScore: 20 });
    expect(w?.note).toBe('eased for 20% recovery');
    const explained = explainWorkingWeight(w);
    expect(explained).toEqual({
      action: 'reduce_load',
      confidence: 'high',
      reasonCodes: ['eased_for_recovery'],
      note: 'eased for 20% recovery',
      safetyState: 'approved',
      dataLimitations: [],
    });
  });
});

import { conPrescription } from '../src/conditioning';
import { explainConPrescription } from '../src/adaptive/explain';

describe('explainConPrescription', () => {
  it('holds at baseline with low confidence when no device is connected, with a non-empty note even though Prescription.note is empty', () => {
    const p = conPrescription('intervals', {});
    expect(p.rec).toBeNull();
    expect(p.note).toBe('');
    const explained = explainConPrescription(p);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['baseline_format']);
    expect(explained.confidence).toBe('low');
    expect(explained.dataLimitations).toEqual(['no_recovery_data']);
    expect(explained.note).toBe('Baseline session — nothing earned for this format yet.');
  });

  it('holds at the earned level with high confidence when recovery data exists', () => {
    const settings = { conProgress: { intervals: { level: 3, miss: 0 } } };
    const p = conPrescription('intervals', { settings, whoop: { recoveryScore: 80 } });
    expect(p.note).toBe('Level 3');
    const explained = explainConPrescription(p);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['at_earned_level']);
    expect(explained.confidence).toBe('high');
    expect(explained.dataLimitations).toEqual([]);
  });

  it('explains an eased day', () => {
    const p = conPrescription('intervals', { whoop: { recoveryScore: 20 } });
    expect(p.note).toBe('eased today for 20% recovery');
    const explained = explainConPrescription(p);
    expect(explained).toEqual({
      action: 'reduce_volume',
      confidence: 'high',
      reasonCodes: ['eased_for_recovery'],
      note: 'eased today for 20% recovery',
      safetyState: 'approved',
      dataLimitations: [],
    });
  });
});

import { conAdapt } from '../src/conditioning';
import type { CondResult } from '../src/types';
import { explainConAdapt } from '../src/adaptive/explain';

describe('explainConAdapt', () => {
  it('explains a progressed level', () => {
    const rec = { fmt: 'intervals', effort: 'hard', felt: '8', zsec: { low: 10, mod: 5, high: 0 }, dur: 20 } as CondResult;
    const result = conAdapt(rec, {});
    expect(result.delta).toBe(1);
    const explained = explainConAdapt(rec, result);
    expect(explained.action).toBe('progress_load');
    expect(explained.reasonCodes).toEqual(['conditioning_level_progressed']);
    expect(explained.confidence).toBe('high');
  });

  it('explains a deload after two consecutive misses', () => {
    const rec = { fmt: 'steady', effort: 'easy', felt: '9', zsec: { low: 5, mod: 0, high: 5 }, dur: 20 } as CondResult;
    const r1 = conAdapt(rec, {});
    expect(r1.delta).toBe(0); // first miss, not yet deloaded
    const r2 = conAdapt(rec, { conProgress: r1.conProgress });
    expect(r2.delta).toBe(-1);
    const explained = explainConAdapt(rec, r2);
    expect(explained.action).toBe('deload');
    expect(explained.reasonCodes).toEqual(['conditioning_level_deloaded']);
  });

  it('explains a held level on a first miss (not yet deloaded)', () => {
    const rec = { fmt: 'steady', effort: 'easy', felt: '9', zsec: { low: 5, mod: 0, high: 5 }, dur: 20 } as CondResult;
    const result = conAdapt(rec, {});
    expect(result.delta).toBe(0);
    const explained = explainConAdapt(rec, result);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['conditioning_level_held']);
    expect(explained.confidence).toBe('medium');
  });

  it('explains a no-HR-data session as low confidence, not a miss', () => {
    const rec = { id: 'a', fmt: 'intervals', zsec: { low: 0, mod: 0, high: 0 }, dur: 1200 } as CondResult;
    const result = conAdapt(rec, {});
    expect(result.delta).toBe(0);
    const explained = explainConAdapt(rec, result);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['conditioning_no_hr_data']);
    expect(explained.dataLimitations).toEqual(['no_device_data']);
  });

  it('explains an excluded/simulated session', () => {
    const explained = explainConAdapt(null, { delta: 0, conProgress: {} });
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['conditioning_session_excluded']);
    expect(explained.dataLimitations).toEqual(['simulated_or_missing_session']);
  });

  it('explains a real, non-sim, non-progressed-format (custom) session as excluded, not as a held level', () => {
    const rec = { fmt: 'custom', zsec: { low: 10, mod: 10, high: 0 }, dur: 600 } as CondResult;
    const result = conAdapt(rec, {});
    expect(result.delta).toBe(0);
    const explained = explainConAdapt(rec, result);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['conditioning_session_excluded']);
    expect(explained.note).toBe('This format does not carry earned progression.');
    expect(explained.confidence).toBe('high');
    expect(explained.dataLimitations).toEqual([]);
  });
});

import { explainSetAdjustment as explainSetAdjustmentFromIndex } from '../src/index';

describe('adaptive exports reach @hybrid/engine\'s public surface', () => {
  it('explainSetAdjustment is reachable from the package index, not just the adaptive module', () => {
    expect(typeof explainSetAdjustmentFromIndex).toBe('function');
  });
});
