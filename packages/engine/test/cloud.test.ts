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
import { restrictToProduct } from '../src/session';
import { sanitizeDB } from '../src/db';
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

/*
 * The migration meets the sync protocol.
 *
 * sanitizeDB's split is not a load-time-only event — applyPull re-sanitises the
 * merge result of EVERY pull. While the server still holds the un-split mixed
 * record, that combination used to mint a brand-new conditioning workout per
 * pull, per device, forever.
 */
describe('a device that has split a mixed workout, pulling from a server that has not', () => {
  const mixedRaw = (): EngineDB =>
    ({
      workouts: [
        {
          id: 'w1',
          name: 'Leg Day',
          updatedAt: 1,
          blocks: [
            { id: 'sb1', exercises: [{ id: 'e1', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }] },
            { id: 'cb1', kind: 'conditioning', condFmt: 'intervals' },
          ],
        },
      ],
      sessions: [],
      settings: {},
    }) as unknown as EngineDB;

  const ids = (db: EngineDB) => db.workouts.map((w) => w.id).sort();

  it('converges on the same two records however many times it pulls', () => {
    const local = sanitizeDB(mixedRaw());
    expect(ids(local)).toEqual(['w1', 'w1-cond']);

    const first = applyPull(local, mixedRaw());
    expect(ids(first.db)).toEqual(['w1', 'w1-cond']);
    // the migrated strength half beat the server's stale mixed copy
    expect(first.db.workouts.find((w) => w.id === 'w1')!.blocks.map((b) => b.id)).toEqual(['sb1']);
    // and the merged result is not what the server holds, so it goes back up
    expect(first.needsPush).toBe(true);

    const second = applyPull(first.db, mixedRaw());
    const third = applyPull(second.db, mixedRaw());
    expect(ids(second.db)).toEqual(['w1', 'w1-cond']);
    expect(ids(third.db)).toEqual(['w1', 'w1-cond']);
  });

  it('pushes the split pair back up, so the server stops holding the mixed record', () => {
    const local = sanitizeDB(mixedRaw());
    const pushed = buildPushState(local, { hybridEngine: mixedRaw() }) as { hybridEngine: EngineDB };
    expect(ids(pushed.hybridEngine)).toEqual(['w1', 'w1-cond']);
    expect(pushed.hybridEngine.workouts.find((w) => w.id === 'w1')!.blocks.map((b) => b.id)).toEqual(['sb1']);
  });
});

describe('a device that has split a mixed SESSION, pulling from a server that has not', () => {
  const mixedRaw = (): EngineDB =>
    ({
      workouts: [],
      sessions: [
        {
          id: 's1',
          date: '2026-08-10',
          status: 'completed',
          updatedAt: 1,
          completedAt: 1,
          workoutId: 'w1',
          blocks: [
            {
              id: 'sb1',
              exercises: [{ id: 'e1', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8', done: true }] }],
            },
            { id: 'cb1', kind: 'conditioning', condFmt: 'intervals', condResult: { id: 'cr1', secs: 600 } },
          ],
        },
      ],
      settings: {},
    }) as unknown as EngineDB;

  /*
   * pickSession ranks logged work above recency, and the mixed original carries
   * BOTH halves' work — so the server's copy still wins the merge for this one
   * record. What must not happen is the conditioning half multiplying: the
   * derived sibling id means the re-split lands on the record already there
   * instead of minting another one, however many times it pulls.
   */
  it('stays at exactly two records however many times it pulls', () => {
    let cur = sanitizeDB(mixedRaw());
    expect(cur.sessions.map((s) => s.id).sort()).toEqual(['s1', 's1-cond']);
    for (let i = 0; i < 3; i++) {
      cur = applyPull(cur, mixedRaw()).db;
      expect(cur.sessions.map((s) => s.id).sort()).toEqual(['s1', 's1-cond']);
      expect(cur.sessions.find((s) => s.id === 's1')!.blocks.map((b) => b.id)).toEqual(['sb1']);
      expect(cur.sessions.find((s) => s.id === 's1-cond')!.blocks.map((b) => b.id)).toEqual(['cb1']);
      // and the conditioning half never re-acquires the strength workout's id
      expect(cur.sessions.find((s) => s.id === 's1-cond')!.workoutId).toBeUndefined();
    }
  });
});

describe('restrictToProduct + pull/push round-trip', () => {
  it('a conditioning-filtered pull keeps the strength record out of the merge, but a strength device still has it after its own pull', () => {
    const remote: EngineDB = {
      workouts: [wk('w-strength', { kind: 'strength' }), wk('w-cond', { kind: 'conditioning' })],
      sessions: [],
      settings: {},
    };
    const conditioningLocal: EngineDB = { workouts: [], sessions: [], settings: {} };
    const conditioningResult = applyPull(
      restrictToProduct(conditioningLocal, 'conditioning'),
      restrictToProduct(remote, 'conditioning'),
    );
    expect(conditioningResult.db.workouts.map((w) => w.id)).toEqual(['w-cond']);

    const strengthLocal: EngineDB = { workouts: [], sessions: [], settings: {} };
    const strengthResult = applyPull(
      restrictToProduct(strengthLocal, 'strength'),
      restrictToProduct(remote, 'strength'),
    );
    expect(strengthResult.db.workouts.map((w) => w.id)).toEqual(['w-strength']);
  });

  it('a conditioning push filtered from a local db that also holds a leftover strength workout does not erase that workout from the pushed state', () => {
    const local: EngineDB = {
      workouts: [wk('w-strength', { kind: 'strength' }), wk('w-cond', { kind: 'conditioning' })],
      sessions: [],
      settings: {},
    };
    const existingRemoteState = {
      hybridEngine: { workouts: [wk('w-strength', { kind: 'strength' })], sessions: [], settings: {} },
    };
    const pushed = buildPushState(restrictToProduct(local, 'conditioning'), existingRemoteState) as {
      hybridEngine: EngineDB;
    };
    expect(pushed.hybridEngine.workouts.map((w) => w.id).sort()).toEqual(['w-cond', 'w-strength']);
  });

  it('a record that exists only locally survives an unfiltered merge, and the push payload built from that unfiltered merge still contains it even though the local write-back is later filtered to one product', () => {
    const local: EngineDB = {
      workouts: [wk('w-lift', { kind: 'strength' }), wk('w-run', { kind: 'conditioning' })],
      sessions: [],
      settings: {},
    };
    // Nothing on the server yet for this account.
    const { db: merged } = applyPull(local, null);
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['w-lift', 'w-run']);

    // Push against the full unfiltered merge — this is what must happen
    // BEFORE any product filtering, so w-run is never lost.
    const pushed = buildPushState(merged, {}) as { hybridEngine: EngineDB };
    expect(pushed.hybridEngine.workouts.map((w) => w.id).sort()).toEqual(['w-lift', 'w-run']);

    // Only now is the on-device write-back narrowed — w-run is gone from
    // THIS device's local view, but it already reached the server above.
    const localWriteBack = restrictToProduct(merged, 'strength');
    expect(localWriteBack.workouts.map((w) => w.id)).toEqual(['w-lift']);
  });

  it('a legacy mixed workout split into two siblings on the remote keeps both siblings after a strength device merges and pushes, since push is no longer filtered', () => {
    const remote: EngineDB = {
      workouts: [wk('w1', { kind: 'strength', updatedAt: 10 }), wk('w1-cond', { kind: 'conditioning', updatedAt: 10 })],
      sessions: [],
      settings: {},
    };
    const strengthLocal: EngineDB = {
      workouts: [wk('w1', { kind: 'strength', updatedAt: 11 })], // this device only ever sees/edits its own kind
      sessions: [],
      settings: {},
    };
    const { db: merged } = applyPull(strengthLocal, remote);
    const pushed = buildPushState(merged, { hybridEngine: remote }) as { hybridEngine: EngineDB };
    expect(pushed.hybridEngine.workouts.map((w) => w.id).sort()).toEqual(['w1', 'w1-cond']);
  });
});
