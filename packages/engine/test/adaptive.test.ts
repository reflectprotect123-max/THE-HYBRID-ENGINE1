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
});
