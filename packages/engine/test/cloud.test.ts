/*
 * The sync rules, tested directly.
 *
 * These are the paths that lose people's training when they go wrong, and none
 * of them are observable from the UI until the damage is already done. They are
 * pure functions precisely so they can be asserted here instead of discovered
 * in a support message.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPull,
  buildPushState,
  coachDigest,
  reconcileAssignments,
  type AssignmentRow,
} from '../src/cloud';
import type { EngineDB, Session, Settings, Workout } from '../src/types';

const wk = (id: string, extra: Partial<Workout> = {}): Workout => ({
  id,
  name: id,
  blocks: [],
  updatedAt: 1,
  ...extra,
});

const coachWk = (aid: string, rev: string): Workout =>
  wk('coach:' + aid, { origin: 'coach', assignmentId: aid, _rev: rev });

const row = (id: string, updated: string): AssignmentRow => ({
  id,
  status: 'assigned',
  updated_at: updated,
  scheduled_date: '2026-02-01',
  session_snapshot: { name: 'Coach Day', blocks: [] },
});

const sess = (id: string, workoutId: string, over: Partial<Session> = {}): Session => ({
  id,
  date: '2026-02-01',
  status: 'completed',
  blocks: [],
  workoutId,
  ...over,
});

describe('reconcileAssignments', () => {
  it('adds a newly assigned session', () => {
    const r = reconcileAssignments([], [], {}, [row('a1', '2026-01-01T00:00:00Z')]);
    expect(r.changed).toBe(true);
    expect(r.workouts.map((w) => w.id)).toEqual(['coach:a1']);
    expect(r.workouts[0].origin).toBe('coach');
    expect(r.workouts[0].dates).toEqual(['2026-02-01']);
  });

  it('updates only when the row actually changed', () => {
    const same = reconcileAssignments([coachWk('a1', 'REV1')], [], {}, [row('a1', 'REV1')]);
    expect(same.changed).toBe(false);

    const moved = reconcileAssignments([coachWk('a1', 'REV1')], [], {}, [row('a1', 'REV2')]);
    expect(moved.changed).toBe(true);
    expect(moved.workouts[0]._rev).toBe('REV2');
  });

  it('NEVER re-materialises a session the athlete has started', () => {
    // Re-materialising discards logged sets. This is the single most damaging
    // thing reconcile can do, so it is asserted for both "active" and "has
    // logged work but was left unfinished".
    const active = sess('s1', 'coach:a1', { status: 'active' });
    const r1 = reconcileAssignments([coachWk('a1', 'REV1')], [active], {}, [row('a1', 'REV2')]);
    expect(r1.changed).toBe(false);
    expect(r1.workouts[0]._rev).toBe('REV1');

    const logged = sess('s2', 'coach:a1', {
      status: 'incomplete',
      blocks: [
        {
          id: 'b',
          exercises: [{ id: 'e', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8', aVal: '100', done: true }] }],
        },
      ],
    });
    const r2 = reconcileAssignments([coachWk('a1', 'REV1')], [logged], {}, [row('a1', 'REV2')]);
    expect(r2.changed).toBe(false);
  });

  it('removes an unassigned template, but keeps one a session still references', () => {
    const gone = reconcileAssignments([coachWk('a1', 'REV1')], [], {}, []);
    expect(gone.changed).toBe(true);
    expect(gone.workouts).toEqual([]);

    const inUse = reconcileAssignments([coachWk('a1', 'REV1')], [sess('s1', 'coach:a1', { status: 'active' })], {}, []);
    expect(inUse.workouts.map((w) => w.id)).toEqual(['coach:a1']);
  });

  it('respects a local delete until the coach changes the row again', () => {
    const settings: Settings = { deletedIds: { 'coach:a1': Date.parse('2026-01-05T00:00:00Z') } };
    const stale = reconcileAssignments([], [], settings, [row('a1', '2026-01-01T00:00:00Z')]);
    expect(stale.workouts).toEqual([]);

    const reassigned = reconcileAssignments([], [], settings, [row('a1', '2026-01-09T00:00:00Z')]);
    expect(reassigned.workouts.map((w) => w.id)).toEqual(['coach:a1']);
  });

  it('leaves the athlete’s own workouts alone', () => {
    const mine = wk('local1');
    const r = reconcileAssignments([mine], [], {}, []);
    expect(r.workouts).toEqual([mine]);
    expect(r.changed).toBe(false);
  });
});

describe('buildPushState', () => {
  it('strips coach materialisations from BOTH sides', () => {
    const local: EngineDB = { workouts: [wk('w1'), coachWk('a1', 'r')], sessions: [], settings: {} };
    const remote = {
      other: 'keep me',
      hybridEngine: { workouts: [coachWk('a2', 'r')], sessions: [], settings: {} },
    };
    const out = buildPushState(local, remote) as { other: string; hybridEngine: EngineDB };
    expect(out.other).toBe('keep me');
    expect(out.hybridEngine.workouts.map((w) => w.id)).toEqual(['w1']);
  });

  it('preserves unrelated keys in the state row', () => {
    const out = buildPushState({ workouts: [], sessions: [], settings: {} }, { someOtherApp: { a: 1 } }) as Record<string, unknown>;
    expect(out.someOtherApp).toEqual({ a: 1 });
  });
});

describe('applyPull', () => {
  const local: EngineDB = { workouts: [wk('w1')], sessions: [], settings: {} };

  it('pushes when the remote has nothing yet', () => {
    const r = applyPull(local, null);
    expect(r.needsPush).toBe(true);
    expect(r.db).toBe(local);
  });

  it('is a no-op when both sides already agree', () => {
    const r = applyPull(local, JSON.parse(JSON.stringify(local)));
    expect(r.needsPush).toBe(false);
  });

  it('merges rather than overwriting, and pushes the union back', () => {
    const remote: EngineDB = { workouts: [wk('w2')], sessions: [], settings: {} };
    const r = applyPull(local, remote);
    expect(r.db.workouts.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
    // the remote is missing w1, so the merged result has to go back up
    expect(r.needsPush).toBe(true);
  });

  it('a logged session beats an empty one of the same id, whichever side it is on', () => {
    const logged: Session = {
      id: 's1',
      date: '2026-02-01',
      status: 'completed',
      completedAt: 10,
      blocks: [
        {
          id: 'b',
          exercises: [{ id: 'e', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', done: true }] }],
        },
      ],
    };
    const empty: Session = { id: 's1', date: '2026-02-01', status: 'completed', completedAt: 999, blocks: [] };

    const a = applyPull({ workouts: [], sessions: [logged], settings: {} }, { workouts: [], sessions: [empty], settings: {} });
    expect(a.db.sessions[0].blocks.length, 'logged local must survive a newer empty remote').toBe(1);

    const b = applyPull({ workouts: [], sessions: [empty], settings: {} }, { workouts: [], sessions: [logged], settings: {} });
    expect(b.db.sessions[0].blocks.length, 'logged remote must survive a newer empty local').toBe(1);
  });
});

describe('coachDigest', () => {
  // Real epoch milliseconds: with toy values `now − 90 days` goes negative and
  // the window can never exclude anything, so the bound would test nothing.
  const NOW = Date.parse('2026-02-03T12:00:00Z');
  const RECENT = Date.parse('2026-02-01T18:00:00Z');
  const ANCIENT = Date.parse('2020-01-01T12:00:00Z');

  const db: EngineDB = {
    workouts: [],
    sessions: [
      {
        id: 's1',
        date: '2026-02-01',
        name: 'Lower',
        status: 'completed',
        completedAt: RECENT,
        blocks: [
          {
            id: 'b1',
            heading: 'Main',
            exercises: [
              { id: 'e', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '9', done: true }] },
            ],
          },
          {
            id: 'b2',
            kind: 'conditioning',
            condFmt: 'intervals',
            condResult: {
              fmt: 'intervals',
              effort: 'hard',
              dur: 900,
              felt: '8',
              zsec: { low: 100, mod: 400, high: 400 },
              hrr: 22,
              trace: { every: 2, pts: [120, 150, 170] },
            },
          },
        ],
      },
      { id: 's2', date: '2020-01-01', status: 'completed', completedAt: ANCIENT, blocks: [] },
      { id: 's3', date: '2026-02-02', status: 'active', blocks: [] },
    ],
    settings: { profile: { age: 30 }, lexicon: { kw: { squat: 'Back Squat' } } },
  };

  it('carries logged work and the conditioning summary', () => {
    const d = coachDigest(db, NOW);
    expect(d.sessions.length).toBe(1);
    expect(d.sessions[0].blocks[0].exercises[0].sets[0].felt).toBe('9');
    expect(d.sessions[0].blocks[1].cond?.hrr).toBe(22);
  });

  it('excludes the raw HR trace, settings and the lexicon', () => {
    const json = JSON.stringify(coachDigest(db, NOW));
    expect(json).not.toContain('trace');
    expect(json).not.toContain('lexicon');
    expect(json).not.toContain('profile');
  });

  it('is bounded to the window and never includes a live session', () => {
    const d = coachDigest(db, NOW);
    const ids = d.sessions.map((s) => s.id);
    expect(ids).not.toContain('s2'); // outside 90 days
    expect(ids).not.toContain('s3'); // still in progress
  });
});
