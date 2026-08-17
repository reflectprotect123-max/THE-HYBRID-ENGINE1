import { describe, it, expect } from 'vitest';
import { toCycleError, CycleError } from './exercise';

describe('toCycleError', () => {
  it('recognizes a reference_max_exercise_id cycle error', () => {
    const err = toCycleError({ message: 'reference_max_exercise_id must point at a root (depth <= 1)' });
    expect(err).toBeInstanceOf(CycleError);
  });

  it('recognizes a track_as_exercise_id cycle error', () => {
    const err = toCycleError({ message: 'track_as_exercise_id must point at a root (depth <= 1)' });
    expect(err).toBeInstanceOf(CycleError);
  });

  it('returns null for an unrelated postgres error', () => {
    expect(toCycleError({ message: 'duplicate key value violates unique constraint' })).toBeNull();
  });

  it('returns null when there is no message', () => {
    expect(toCycleError({})).toBeNull();
  });
});
