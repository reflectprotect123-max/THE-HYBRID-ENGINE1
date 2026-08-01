/*
 * The sync rules, tested directly.
 *
 * These are the paths that lose people's training when they go wrong, and none
 * of them are observable from the UI until the damage is already done. They are
 * pure functions precisely so they can be asserted here instead of discovered
 * in a support message.
 */
import { describe, expect, it } from 'vitest';
import { applyPull, buildPushState } from '../src/cloud';
import type { EngineDB, Session, Workout } from '../src/types';

const wk = (id: string, extra: Partial<Workout> = {}): Workout => ({
  id,
  name: id,
  blocks: [],
  updatedAt: 1,
  ...extra,
});

const sess = (id: string, workoutId: string, over: Partial<Session> = {}): Session => ({
  id,
  date: '2026-02-01',
  status: 'completed',
  blocks: [],
  workoutId,
  ...over,
});

describe('buildPushState', () => {
  it('merges local and remote workouts, keeping unrelated remote keys', () => {
    const local: EngineDB = { workouts: [wk('w1')], sessions: [], settings: {} };
    const remote = {
      other: 'keep me',
      hybridEngine: { workouts: [wk('w2')], sessions: [], settings: {} },
    };
    const out = buildPushState(local, remote) as { other: string; hybridEngine: EngineDB };
    expect(out.other).toBe('keep me');
    expect(out.hybridEngine.workouts.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
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

describe('mergeSettings carries earned working weights', () => {
  const at = (kg: number, when: number) => ({ workouts: [], sessions: [], settings: { liftProgress: { squat: { kg, at: when } } } });

  it('a DELOAD survives a merge against a higher, older weight', () => {
    // The case that makes this rule different from conProgress's max-wins.
    // A missed set, or a deliberate back-off, lowers the weight — and max-wins
    // would restore the higher number on the next sync, so the one outcome an
    // athlete most needs to stick is the one it would eat.
    const deloaded = at(90, 2000);
    const stale = at(110, 1000);

    expect(applyPull(deloaded, stale).db.settings.liftProgress?.squat.kg, 'local deload vs older remote').toBe(90);
    expect(applyPull(stale, deloaded).db.settings.liftProgress?.squat.kg, 'remote deload vs older local').toBe(90);
  });

  it('a lift only one side knows about is kept, not dropped', () => {
    const a: EngineDB = { workouts: [], sessions: [], settings: { liftProgress: { squat: { kg: 100, at: 1 } } } };
    const b: EngineDB = { workouts: [], sessions: [], settings: { liftProgress: { bench: { kg: 60, at: 1 } } } };
    const lp = applyPull(a, b).db.settings.liftProgress || {};
    expect(Object.keys(lp).sort()).toEqual(['bench', 'squat']);
  });
});

describe('sessions unrelated to a workout id are unaffected by a merge', () => {
  it('keeps a session referencing a workout that no longer exists', () => {
    const a: EngineDB = { workouts: [], sessions: [sess('s1', 'gone')], settings: {} };
    const r = applyPull(a, null);
    expect(r.db.sessions.map((s) => s.id)).toEqual(['s1']);
  });
});
