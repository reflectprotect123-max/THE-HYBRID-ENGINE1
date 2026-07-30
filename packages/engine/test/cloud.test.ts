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
import { ymd } from '../src/num';

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
        startedAt: RECENT - 45 * 60_000,
        completedAt: RECENT,
        blocks: [
          {
            id: 'b1',
            heading: 'Main',
            exercises: [
              {
                id: 'e',
                name: 'Squat',
                mode: 'reps_kg',
                sets: [
                  { t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '9', done: true },
                  { t: '5', rpe: '8', aVal: '100', aVal2: '5', done: false },
                ],
              },
            ],
          },
          {
            id: 'b2',
            kind: 'conditioning',
            condFmt: 'intervals',
            condResult: {
              id: 'c1',
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
    settings: {
      profile: { age: 30 },
      lexicon: { kw: { squat: 'Back Squat' } },
      whoopDaily: [
        { date: '2026-02-01', recovery: 71, strain: 12 },
        { date: '2019-05-05', recovery: 40, strain: 8 },
      ],
    },
  };

  /*
   * THE SHAPE IS THE CONTRACT. The coach dashboard reads exactly these fields
   * (coach/js/app.js athleteDetailHTML) and renders "0 sessions / NaN kg" —
   * silently, without erroring — if any of them is missing. This test exists
   * because the first port of coachDigest emitted a completely different shape
   * and nothing caught it.
   */
  it('emits the fields the coach dashboard actually reads', () => {
    const d = coachDigest(db, NOW);
    expect(d.v).toBe(1);
    const s = d.sessions[0];
    expect(Object.keys(s).sort()).toEqual(
      ['date', 'exercises', 'id', 'minutes', 'name', 'rpeFelt', 'rpeTarget', 'setsDone', 'setsTotal', 'status', 'volumeKg'].sort(),
    );
    expect(s.volumeKg).toBe(500); // one completed set: 100kg × 5
    expect(s.setsDone).toBe(1);
    expect(s.setsTotal).toBe(2);
    expect(s.minutes).toBe(45);
    expect(s.exercises).toEqual(['Squat']);
    expect(s.rpeFelt).toBe(9);
  });

  it('publishes conditioning and WHOOP as their own top-level arrays', () => {
    const d = coachDigest(db, NOW);
    expect(d.conditioning.length).toBe(1);
    expect(d.conditioning[0].hrr).toBe(22);
    expect(d.conditioning[0].zsec).toEqual({ low: 100, mod: 400, high: 400 });
    expect(d.whoop.map((w) => w.date)).toEqual(['2026-02-01']); // 2019 is outside the window
  });

  it('excludes the raw HR trace, settings and the lexicon', () => {
    const json = JSON.stringify(coachDigest(db, NOW));
    expect(json).not.toContain('trace');
    expect(json).not.toContain('lexicon');
    expect(json).not.toContain('profile');
  });

  it('is bounded to the window and never includes a live session', () => {
    const ids = coachDigest(db, NOW).sessions.map((s) => s.id);
    expect(ids).not.toContain('s2'); // outside 90 days
    expect(ids).not.toContain('s3'); // still in progress
    expect(ids).toEqual(['s1']);
  });

  it('windows standalone conditioning on startedAt and dates it', () => {
    const db2: EngineDB = { workouts: [], sessions: [], settings: {
      conditioning: [{ id: 'c1', fmt: 'steady', effort: 'easy', dur: 1200,
        zsec: { low: 600, mod: 600, high: 0 }, hrr: 10, startedAt: NOW - 3_600_000 }],
    } };
    const d = coachDigest(db2, NOW);
    expect(d.conditioning.length).toBe(1);
    expect(d.conditioning[0].date).toBe(ymd(new Date(NOW - 3_600_000)));
  });

  it('windows on `date`, so an unfinished session still reaches the coach', () => {
    // No completedAt at all — windowing on it would silently hide exactly the
    // sessions a coach most wants to ask about.
    const noStamp: EngineDB = {
      workouts: [],
      sessions: [{ id: 'x', date: '2026-02-01', status: 'incomplete', blocks: [] }],
      settings: {},
    };
    expect(coachDigest(noStamp, NOW).sessions.map((s) => s.id)).toEqual(['x']);
  });
});
