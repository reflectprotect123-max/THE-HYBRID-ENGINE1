/*
 * sessionFrom: the ONE place a live session is minted from a workout — shared
 * by Home's Start CTA and Training's list so their behavior cannot diverge
 * (Home's Start used to be a placebo that only navigated).
 */
import { type TextBlock } from '@hybrid/engine';
import { textWorkout } from '../../test/harness';
import { resolveDayTarget, sessionFrom } from './session';

describe('sessionFrom', () => {
  it('mints a live session: active, named, stamped with its source', () => {
    const w = textWorkout('Lower');
    const s = sessionFrom(w, '2026-07-29');
    expect(s.status).toBe('active');
    expect(s.date).toBe('2026-07-29');
    expect(s.name).toBe(w.name);
    expect(s.workoutId).toBe(w.id);
    expect(s.startedAt).toBeGreaterThan(0);
  });

  it('falls back to "Session" for an unnamed workout', () => {
    const w = { ...textWorkout(), name: '' };
    expect(sessionFrom(w, '2026-07-29').name).toBe('Session');
  });

  it('produces FRESH blocks — logging into the session never touches the source workout', () => {
    const w = textWorkout('Lower');
    const s = sessionFrom(w, '2026-07-29');
    (s.blocks[0] as TextBlock).heading = 'MUTATED';
    expect((w.blocks[0] as TextBlock).heading).toBe('Metcon');
  });
});

/*
 * resolveDayTarget: the ONE place a tapped calendar day (or Home's date) is
 * turned into a navigation target — shared by Calendar and Home so their
 * "what happens when you tap this day" logic cannot diverge.
 */
describe('resolveDayTarget', () => {
  it('returns recap when a sessionId is present, even if the date is today — a completed session wins over the "start" flow', () => {
    expect(resolveDayTarget('2026-07-29', '2026-07-29', 'w1', 's1')).toEqual({ kind: 'recap', id: 's1' });
  });

  it('returns today when the date matches today and there is no sessionId', () => {
    expect(resolveDayTarget('2026-07-29', '2026-07-29')).toEqual({ kind: 'today' });
  });

  it('returns preview with the workoutId passed through for any other date', () => {
    expect(resolveDayTarget('2026-07-30', '2026-07-29', 'w1')).toEqual({ kind: 'preview', date: '2026-07-30', workoutId: 'w1' });
  });

  it('returns preview with workoutId undefined when nothing is scheduled — a valid preview state', () => {
    expect(resolveDayTarget('2026-07-30', '2026-07-29')).toEqual({ kind: 'preview', date: '2026-07-30', workoutId: undefined });
  });
});
