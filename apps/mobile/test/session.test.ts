/*
 * sessionFrom: the ONE place a live session is minted from a workout — shared
 * by Home's Start CTA and Training's list so their behavior cannot diverge
 * (Home's Start used to be a placebo that only navigated).
 */
import { type StrengthBlock } from '@hybrid/engine';
import { liftWorkout } from './harness';
import { sessionFrom } from '../src/store/session';

describe('sessionFrom', () => {
  it('mints a live session: active, named, stamped with its source', () => {
    const w = liftWorkout('Back squat', 2);
    const s = sessionFrom(w, '2026-07-29');
    expect(s.status).toBe('active');
    expect(s.date).toBe('2026-07-29');
    expect(s.name).toBe(w.name);
    expect(s.workoutId).toBe(w.id);
    expect(s.startedAt).toBeGreaterThan(0);
  });

  it('falls back to "Session" for an unnamed workout', () => {
    const w = { ...liftWorkout(), name: '' };
    expect(sessionFrom(w, '2026-07-29').name).toBe('Session');
  });

  it('produces FRESH blocks — logging into the session never touches the source workout', () => {
    const w = liftWorkout('Back squat', 2);
    const s = sessionFrom(w, '2026-07-29');
    (s.blocks[0] as StrengthBlock).exercises[0].sets[0].t = 'MUTATED';
    expect((w.blocks[0] as StrengthBlock).exercises[0].sets[0].t).toBe('5');
  });
});
