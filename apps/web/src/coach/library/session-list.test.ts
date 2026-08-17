import { describe, expect, it } from 'vitest';
import type { Workout } from '@hybrid/engine';
import { authoredSessions, filterSessions } from './session-list';
import { INSTRUCTIONS_HEADING } from './day-workout';

function workout(over: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    name: 'Heavy Squat A',
    kind: 'strength',
    blocks: [{ id: 'b0', kind: 'text' as const, heading: 'Strength/Power' }],
    ...over,
  } as Workout;
}

describe('authoredSessions', () => {
  it('lists what the coach has written, newest first', () => {
    const out = authoredSessions([
      workout({ id: 'a', name: 'Older', updatedAt: 100 }),
      workout({ id: 'b', name: 'Newer', updatedAt: 200 }),
    ]);
    expect(out.map((s) => s.name)).toEqual(['Newer', 'Older']);
  });

  it('drops empty workouts, which are half-open editors rather than sessions', () => {
    // GuidedBuilder creates an empty shell up front. Offering it here would
    // let a coach paste nothing onto a day.
    expect(authoredSessions([workout({ blocks: [] })])).toEqual([]);
  });

  it('drops sample data, which is not the coach’s work', () => {
    expect(authoredSessions([workout({ sample: true })])).toEqual([]);
  });

  it('does not count the coach-instructions note as a block of work', () => {
    const out = authoredSessions([
      workout({
        blocks: [
          { id: 'note', kind: 'text', heading: INSTRUCTIONS_HEADING, body: 'Ease in' },
          { id: 'b0', kind: 'text' as const, heading: 'Strength/Power' },
        ],
      }),
    ]);
    expect(out[0].blockCount).toBe(1);
  });

  it('keeps a session whose ONLY content is an instructions note out of the list', () => {
    // Its block count is zero once the note is discounted, so it would paste
    // nothing — the same reason an empty workout is dropped.
    const out = authoredSessions([
      workout({ blocks: [{ id: 'note', kind: 'text', heading: INSTRUCTIONS_HEADING, body: 'Ease in' }] }),
    ]);
    expect(out).toEqual([]);
  });

  it('names an unnamed session rather than showing a blank row', () => {
    expect(authoredSessions([workout({ name: '   ' })])[0].name).toBe('Untitled session');
  });

  it('reports the dates a session is already on, so a coach can see it is scheduled', () => {
    expect(authoredSessions([workout({ dates: ['2026-08-14'] })])[0].dates).toEqual(['2026-08-14']);
  });

  it('leaves kind absent rather than guessing one', () => {
    expect(authoredSessions([workout({ kind: undefined })])[0].kind).toBeUndefined();
  });
});

describe('filterSessions', () => {
  const sessions = authoredSessions([
    workout({ id: 'a', name: 'Heavy Squat A', updatedAt: 2 }),
    workout({ id: 'b', name: 'Easy row', updatedAt: 1 }),
  ]);

  it('filters nothing on an empty query', () => {
    expect(filterSessions(sessions, '  ')).toHaveLength(2);
  });

  it('matches on any part of the name, ignoring case', () => {
    expect(filterSessions(sessions, 'squat').map((s) => s.id)).toEqual(['a']);
    expect(filterSessions(sessions, 'ROW').map((s) => s.id)).toEqual(['b']);
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(filterSessions(sessions, 'deadlift')).toEqual([]);
  });
});
