import { describe, expect, it } from 'vitest';
import { restrictToProduct, type EngineDB, type Session, type Workout } from '@hybrid/engine';
import { disciplineOf, splitActiveSession } from '../src/discipline';

/*
 * The two disciplines are one app but two separate experiences. These are the
 * rules that make that true without losing anything: reads are scoped, the
 * database is not, and a live session is never left with nowhere to appear.
 */

describe('disciplineOf', () => {
  it('treats only an explicit conditioning kind as conditioning', () => {
    expect(disciplineOf('conditioning')).toBe('conditioning');
    expect(disciplineOf('strength')).toBe('strength');
  });

  it('defaults an absent or unknown kind to strength rather than guessing', () => {
    // A legacy session written before `kind` existed is a lifting session.
    // Sending it to conditioning would move real history between disciplines.
    expect(disciplineOf(undefined)).toBe('strength');
    expect(disciplineOf('')).toBe('strength');
    expect(disciplineOf('something-new')).toBe('strength');
  });
});

describe('splitActiveSession', () => {
  const strengthLive = { id: 's1', kind: 'strength' } as const;
  const condLive = { id: 'c1', kind: 'conditioning' } as const;

  it('shows the live session when it belongs to the current discipline', () => {
    expect(splitActiveSession(strengthLive, 'strength')).toEqual({
      activeSession: strengthLive,
      foreignActiveSession: null,
    });
  });

  it('hands a live session from the other discipline to `foreign`, never to null', () => {
    // The safety case. If this returned {null, null} the athlete could switch
    // tab mid-session and the session would be unreachable from every screen
    // until expireStaleSessions ended it at the next day boundary.
    expect(splitActiveSession(condLive, 'strength')).toEqual({
      activeSession: null,
      foreignActiveSession: condLive,
    });
    expect(splitActiveSession(strengthLive, 'conditioning')).toEqual({
      activeSession: null,
      foreignActiveSession: strengthLive,
    });
  });

  it('reports nothing live when there is nothing live', () => {
    expect(splitActiveSession(null, 'strength')).toEqual({
      activeSession: null,
      foreignActiveSession: null,
    });
    expect(splitActiveSession(undefined, 'conditioning')).toEqual({
      activeSession: null,
      foreignActiveSession: null,
    });
  });
});

describe('the scoped view never becomes the written database', () => {
  it('leaves the source database whole so a write cannot drop the other discipline', () => {
    const db = {
      workouts: [] as Workout[],
      sessions: [
        { id: 's1', kind: 'strength' },
        { id: 'c1', kind: 'conditioning' },
      ] as unknown as Session[],
    } as unknown as EngineDB;

    const strengthView = restrictToProduct(db, 'strength');
    const condView = restrictToProduct(db, 'conditioning');

    expect(strengthView.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(condView.sessions.map((s) => s.id)).toEqual(['c1']);
    // The store hands `db` (not a view) to update/updateSession, the
    // Coordinator and whole-athlete-state. This is the assertion that the
    // mobile sync partition needed two rounds of review to learn.
    expect(db.sessions.map((s) => s.id)).toEqual(['s1', 'c1']);
  });
});
