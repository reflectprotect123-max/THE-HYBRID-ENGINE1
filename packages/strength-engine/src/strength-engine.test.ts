import { describe, expect, it } from 'vitest';
import { workoutToStrengthProposal } from '.';

describe('Strength Engine boundary', () => {
  it('emits a coordinator proposal without leaking UI or logged-set data', () => {
    const out = workoutToStrengthProposal({
      id: 'w1',
      name: 'Lower A',
      kind: 'strength',
      blocks: [{ id: 'b', exercises: [{ id: 'e', name: 'Back squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '7' }] }] }],
      days: [2],
    });
    expect(out.domain).toBe('strength');
    expect(out.preferredWeekdays).toEqual([2]);
    expect(out.tags).toContain('heavy_lower');
    expect(JSON.stringify(out)).not.toContain('aVal');
  });
});
