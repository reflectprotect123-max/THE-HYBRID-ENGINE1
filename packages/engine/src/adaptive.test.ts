import { describe, expect, it } from 'vitest';

import { nextWorkingWeight } from './lift';
import { explainWorkingWeight } from './adaptive/explain';

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

import { conPrescription } from './conditioning';
import { explainConPrescription } from './adaptive/explain';

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

import { conAdapt } from './conditioning';
import type { CondResult } from './types';
import { explainConAdapt } from './adaptive/explain';

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

import { explainWorkingWeight as explainWorkingWeightFromIndex } from './index';

describe('adaptive exports reach @hybrid/engine\'s public surface', () => {
  it('explainWorkingWeight is reachable from the package index, not just the adaptive module', () => {
    expect(typeof explainWorkingWeightFromIndex).toBe('function');
  });
});
