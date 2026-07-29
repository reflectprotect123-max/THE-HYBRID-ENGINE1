/*
 * Workout.note — the field the coach app's "Coach instructions" needs.
 *
 * It travels with the session (sessionToWorkout used to bolt it on via an
 * untyped `extra` param), but nothing reads it on the athlete side today —
 * that surfacing is a separate, later feature. This test only proves the
 * field has a typed home and survives the same trust boundary every other
 * workout field does.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeDB } from '../src/db';
import type { Workout } from '../src/types';

describe('Workout.note', () => {
  it('is a real field, not a bag-on-the-side property', () => {
    const w: Workout = { id: 'w1', name: 'Session', blocks: [], note: 'Warm up thoroughly today.' };
    expect(w.note).toBe('Warm up thoroughly today.');
  });

  it('survives sanitizeDB unchanged', () => {
    const db = sanitizeDB({ workouts: [{ id: 'w1', name: 'S', blocks: [], note: 'hello' }], sessions: [], settings: {} });
    expect(db.workouts[0].note).toBe('hello');
  });
});
