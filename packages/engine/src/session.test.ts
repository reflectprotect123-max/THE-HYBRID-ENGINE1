/*
 * fillLinkedSets — the authoring-side counterpart to prefillPrimary.
 *
 * newEx() gives every fresh exercise three identical blank sets, and the
 * common case is that all three are meant to carry the same target. This is
 * what makes typing set 1 fill the untouched sets after it, so authoring a
 * plain 3x5 does not mean typing the same target three times.
 *
 * The rule is a strict analogue of prefillPrimary's own: "something already
 * typed must never be overwritten by a suggestion." A set only follows while
 * it still holds its PRE-edit value — the instant one is edited independently,
 * it diverges and the chain breaks there, for every set after it too.
 */
import { describe, expect, it } from 'vitest';
import {
  blockDurations,
  sessionDuration,
  detectPRs,
  duplicateExercise,
  duplicateWorkout,
  fillLinkedSets,
} from './session';
import type { Block, CondBlock, Exercise, LoggedSet, PlannedSet, Session, Workout } from './types';

const set = (t: string, rpe: string): PlannedSet => ({ t, rpe });
const ex = (name: string, over: Partial<Exercise> = {}): Exercise => ({
  id: 'orig-' + name,
  name,
  mode: 'reps_kg',
  sets: [set('5', '8')],
  ...over,
});

describe('fillLinkedSets', () => {
  it('propagates an edit into later blank sets', () => {
    const sets = [set('', ''), set('', ''), set('', '')];
    const out = fillLinkedSets(sets, 0, 't', '5');
    expect(out.map((s) => s.t)).toEqual(['5', '5', '5']);
  });

  it('stops at the first set already edited independently, and does not resume after it', () => {
    // Set 1 was typed by hand to '8' — a ladder rung. Set 2 is still blank and
    // would coincidentally match set 0's OLD value, but a later coincidental
    // match is not evidence it belongs to the same run.
    const sets = [set('', ''), set('8', ''), set('', '')];
    const out = fillLinkedSets(sets, 0, 't', '5');
    expect(out.map((s) => s.t)).toEqual(['5', '8', '']);
  });

  it('never crosses a warm-up/working boundary', () => {
    const sets = [set('', ''), set('W', '')];
    const out = fillLinkedSets(sets, 0, 't', '5');
    // sets[1] is a warm-up marker regardless of what is typed into sets[0];
    // the working edit must not leak into it.
    expect(out.map((s) => s.t)).toEqual(['5', 'W']);
  });

  it('only touches the field being edited', () => {
    const sets = [set('', '7'), set('', '')];
    const out = fillLinkedSets(sets, 0, 't', '5');
    expect(out[0]).toEqual({ t: '5', rpe: '7' });
    expect(out[1]).toEqual({ t: '5', rpe: '' });
  });

  it('propagates from a middle set forward, never backward', () => {
    const sets = [set('3', ''), set('', ''), set('', '')];
    const out = fillLinkedSets(sets, 1, 't', '5');
    expect(out.map((s) => s.t)).toEqual(['3', '5', '5']);
  });

  it('returns the original array unchanged for an out-of-range index', () => {
    const sets = [set('', '')];
    expect(fillLinkedSets(sets, 5, 't', '5')).toBe(sets);
  });

  it('is pure — the input array and its sets are not mutated', () => {
    const sets = [set('', ''), set('', '')];
    const snapshot = JSON.parse(JSON.stringify(sets));
    fillLinkedSets(sets, 0, 't', '5');
    expect(sets).toEqual(snapshot);
  });
});

/*
 * duplicateExercise — the fastest way to build a session with any repeated
 * structure, which is most of them: superset pairs, unilateral work,
 * near-identical accessories.
 */
describe('duplicateExercise', () => {
  it('inserts a copy immediately after the original, with a fresh id', () => {
    const exs = [ex('Bench Press'), ex('Row')];
    const out = duplicateExercise(exs, 0);
    expect(out.map((e) => e.name)).toEqual(['Bench Press', 'Bench Press', 'Row']);
    expect(out[1].id).not.toBe(out[0].id);
  });

  it('copies sets by value, not by reference', () => {
    const exs = [ex('Bench Press', { sets: [set('5', '8')] })];
    const out = duplicateExercise(exs, 0);
    out[1].sets[0].t = '10';
    expect(out[0].sets[0].t).toBe('5');
  });

  it('never links the copy onward by default', () => {
    const exs = [ex('Bench Press'), ex('Row')];
    const out = duplicateExercise(exs, 0);
    expect(out[1].ssNext).toBeFalsy();
  });

  it('breaks an existing superset link FROM the original rather than silently rerouting it to the copy', () => {
    // Bench was chained to Row. Duplicating Bench must not make the new copy
    // the thing Bench links to instead — that would rewire a chain the coach
    // never touched by duplicating a different exercise.
    const exs = [ex('Bench Press', { ssNext: true }), ex('Row')];
    const out = duplicateExercise(exs, 0);
    expect(out[0].ssNext).toBeFalsy();
    expect(out.map((e) => e.name)).toEqual(['Bench Press', 'Bench Press', 'Row']);
  });

  it('returns the original array unchanged for an out-of-range index', () => {
    const exs = [ex('Bench Press')];
    expect(duplicateExercise(exs, 5)).toBe(exs);
  });
});

/*
 * duplicateWorkout — clone a workout as a new, independent, unscheduled
 * record. Mirrors duplicateExercise's own reasoning one level up: every id
 * gets refreshed so an edit to the copy can never reach back into the
 * original, and the scheduled slot is cleared so the clone doesn't silently
 * double-book the original's weekday.
 */
describe('duplicateWorkout', () => {
  const strengthBlock = (over: Partial<Block> = {}): Block =>
    ({
      id: 'orig-block',
      heading: 'Main work',
      superset: false,
      exercises: [ex('Bench Press')],
      ...over,
    }) as Block;

  const workout = (over: Partial<Workout> = {}): Workout => ({
    id: 'orig-workout',
    name: 'Push Day',
    blocks: [strengthBlock()],
    ...over,
  });

  it('gives the copy a fresh workout id, different from the original', () => {
    const w = workout();
    const copy = duplicateWorkout(w);
    expect(copy.id).not.toBe(w.id);
  });

  it('gives every block a fresh id, different from the original', () => {
    const w = workout({ blocks: [strengthBlock({ id: 'block-a' }), strengthBlock({ id: 'block-b' })] });
    const copy = duplicateWorkout(w);
    expect(copy.blocks[0].id).not.toBe('block-a');
    expect(copy.blocks[1].id).not.toBe('block-b');
    expect(copy.blocks[0].id).not.toBe(copy.blocks[1].id);
  });

  it('gives every exercise a fresh id, different from the original', () => {
    const w = workout({ blocks: [strengthBlock({ exercises: [ex('Bench Press'), ex('Row')] })] });
    const copy = duplicateWorkout(w);
    const copiedExercises = (copy.blocks[0] as unknown as { exercises: Exercise[] }).exercises;
    expect(copiedExercises[0].id).not.toBe('orig-Bench Press');
    expect(copiedExercises[1].id).not.toBe('orig-Row');
    expect(copiedExercises[0].id).not.toBe(copiedExercises[1].id);
  });

  it('copies sets by value, not by reference — mutating the copy does not affect the original', () => {
    const w = workout({ blocks: [strengthBlock({ exercises: [ex('Bench Press', { sets: [set('5', '8')] })] })] });
    const copy = duplicateWorkout(w);
    const copiedBlock = copy.blocks[0] as unknown as { exercises: Exercise[] };
    copiedBlock.exercises[0].sets[0].t = '10';
    const origBlock = w.blocks[0] as unknown as { exercises: Exercise[] };
    expect(origBlock.exercises[0].sets[0].t).toBe('5');
  });

  it('clears days/dates on the copy even when the original had them set', () => {
    const w = workout({ days: [1, 3, 5], dates: ['2026-08-10'] });
    const copy = duplicateWorkout(w);
    expect(copy.days).toBeUndefined();
    expect(copy.dates).toBeUndefined();
  });

  it('appends " copy" to the name', () => {
    const w = workout({ name: 'Push Day' });
    const copy = duplicateWorkout(w);
    expect(copy.name).toBe('Push Day copy');
  });

  it('falls back to "Session copy" when the original has no name at all', () => {
    const w = workout({ name: undefined });
    const copy = duplicateWorkout(w);
    expect(copy.name).toBe('Session copy');
  });

  /*
   * The suffix earns its keep only if it stays readable as a suffix and stays
   * distinguishing. Plain concatenation failed both: "Push Day copy copy" (and
   * "copy copy copy", without limit), and two library cards both called
   * "Push Day copy" — the exact ambiguity the suffix exists to remove.
   */
  it('numbers a duplicate-of-a-duplicate instead of growing "copy copy"', () => {
    const copy = duplicateWorkout(workout({ name: 'Push Day copy' }));
    expect(copy.name).toBe('Push Day copy 2');
    expect(copy.name).not.toContain('copy copy');
  });

  it('keeps counting up rather than resetting, however many times it is repeated', () => {
    let name = 'Push Day';
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      name = duplicateWorkout(workout({ name })).name as string;
      seen.push(name);
    }
    expect(seen).toEqual(['Push Day copy', 'Push Day copy 2', 'Push Day copy 3', 'Push Day copy 4']);
  });

  it('steps past names already in the library when given them', () => {
    const existing = ['Push Day', 'Push Day copy', 'Push Day copy 2'];
    const copy = duplicateWorkout(workout({ name: 'Push Day' }), existing);
    expect(copy.name).toBe('Push Day copy 3');
  });

  it('duplicating the same source twice gives two distinguishable names', () => {
    const w = workout({ name: 'Push Day' });
    const names = ['Push Day'];
    const first = duplicateWorkout(w, names);
    names.push(first.name as string);
    const second = duplicateWorkout(w, names);
    expect(first.name).toBe('Push Day copy');
    expect(second.name).toBe('Push Day copy 2');
    expect(second.name).not.toBe(first.name);
  });

  it('reads a hand-typed "Copy" as the same suffix but always emits it lowercase', () => {
    expect(duplicateWorkout(workout({ name: 'Push Day Copy' })).name).toBe('Push Day copy 2');
  });

  it('treats a name that is only the word "copy" as a real name, not a suffix', () => {
    expect(duplicateWorkout(workout({ name: 'copy' })).name).toBe('copy copy');
  });

  it('strips a CondBlock\'s condResult on the copy — a template should not inherit another session\'s logged result', () => {
    const condBlock: CondBlock = {
      id: 'cond-block',
      kind: 'conditioning',
      heading: 'Conditioning',
      condFmt: 'intervals',
      effort: 'medium',
      targetZone: 'mod',
      minutes: 20,
      condResult: { fmt: 'intervals', felt: '7', dur: 1200 },
    };
    const w = workout({ blocks: [condBlock] });
    const copy = duplicateWorkout(w);
    expect((copy.blocks[0] as CondBlock).condResult).toBeUndefined();
    expect(condBlock.condResult).toBeDefined();
  });

  it('clears _rev even when present on the original', () => {
    const w = workout({ _rev: 'rev-123' });
    const copy = duplicateWorkout(w);
    expect(copy._rev).toBeUndefined();
  });

  // `updatedAt` is load-bearing for sync, not cosmetic. `notTombstoned` in
  // db.ts drops any record whose `updatedAt` is at or below a tombstone's
  // timestamp, so a clone that inherited an old original's stamp could be
  // deleted on the next merge by a tombstone that was never meant for it.
  // `pickWorkout` likewise resolves a conflict purely on `updatedAt`, so a
  // stale stamp makes the clone lose to whatever the remote already holds.
  it('refreshes updatedAt to now rather than copying the original\'s stale stamp', () => {
    const before = Date.now();
    const w = workout({ updatedAt: 1 });
    const copy = duplicateWorkout(w);
    expect(copy.updatedAt).toBeGreaterThanOrEqual(before);
    expect(copy.updatedAt).not.toBe(w.updatedAt);
  });

  // `sample` marks a record as seeded demo content rather than the athlete's
  // own. A clone is authored by the athlete the moment they press Duplicate,
  // so the marker must not ride along — same reasoning as `_rev`, it describes
  // the original record's provenance, not the copy's.
  it('clears sample even when the original is flagged as sample content', () => {
    const w = workout({ sample: true });
    const copy = duplicateWorkout(w);
    expect(copy.sample).toBeUndefined();
    expect(w.sample).toBe(true);
  });

  // `folderIds`, unlike `days`/`dates`/`sample`/`_rev` above, is deliberately
  // KEPT — see duplicateWorkout's own doc comment. A folder is organisational
  // metadata, not a scheduling/session-identity fact, so a duplicate of a
  // Week-1 workout is itself a Week-1 workout until the athlete refiles it.
  it("keeps the original's folderIds on the copy, unlike days/dates/sample/_rev", () => {
    const w = workout({ folderIds: ['week-1', 'conditioning'] });
    const copy = duplicateWorkout(w);
    expect(copy.folderIds).toEqual(['week-1', 'conditioning']);
  });
});

/*
 * detectPRs — E3: dedupe-BEFORE-scan meant the first block seen for a name
 * "claimed" it, so a heavier set of the SAME lift sitting in a later block
 * (a "Heavy single" block after the main work, a common authoring pattern)
 * was never even looked at, and the PR banner stayed silent while the
 * Progress chart jumped.
 */
const loggedSet = (kg: string, reps: string): LoggedSet =>
  ({ done: true, aVal: kg, aVal2: reps }) as LoggedSet;

describe('detectPRs scans every block for a lift, not just the first (E3)', () => {
  it('reports a PR set in a LATER block under the same exercise name', () => {
    const s: Session = {
      id: 'today',
      date: '2026-01-05',
      status: 'completed',
      completedAt: Date.parse('2026-01-05T18:00:00Z'),
      blocks: [
        {
          id: 'main',
          heading: 'Main work',
          superset: false,
          exercises: [
            { id: 'e1', name: 'Back squat', mode: 'reps_kg', rest: 90, sets: [loggedSet('100', '5')] },
          ],
        },
        {
          id: 'heavy',
          heading: 'Heavy single',
          superset: false,
          exercises: [
            { id: 'e2', name: 'Back squat', mode: 'reps_kg', rest: 90, sets: [loggedSet('150', '1')] },
          ],
        },
      ],
    } as unknown as Session;

    const prior: Session = {
      id: 'prior',
      date: '2025-12-20',
      status: 'completed',
      completedAt: Date.parse('2025-12-20T18:00:00Z'),
      blocks: [
        {
          id: 'main',
          heading: 'Main work',
          superset: false,
          exercises: [
            { id: 'e1', name: 'Back squat', mode: 'reps_kg', rest: 90, sets: [loggedSet('110', '5')] },
          ],
        },
      ],
    } as unknown as Session;

    const prs = detectPRs(s, [prior, s]);
    expect(prs).toHaveLength(1);
    expect(prs[0].name).toBe('Back squat');
    expect(prs[0].kg).toBe(150);
    expect(prs[0].reps).toBe(1);
    expect(prs[0].e1).toBeCloseTo(150, 2);
    expect(prs[0].prevE1).toBeCloseTo(128.33, 2);
  });
});


describe('how long each part took', () => {
  /*
   * Added 16 August 2026. The owner asked for a stopwatch per block; this is
   * the cheaper shape that answers the same question — wall-clock stamps, the
   * way session duration has always been known, so nothing has to survive the
   * phone locking or the app being reclaimed mid-session.
   */
  const sess = (over: Partial<Session>): Session =>
    ({ id: 's', date: '2026-08-16', status: 'completed', blocks: [], ...over }) as unknown as Session;

  it('measures each block up to the next one, and the last up to the finish', () => {
    const s = sess({
      blockLog: [
        { id: 'warm', at: 1_000_000 },
        { id: 'strength', at: 1_000_000 + 600_000 },
      ],
      completedAt: 1_000_000 + 600_000 + 900_000,
    });
    expect(blockDurations(s)).toEqual({ warm: 600, strength: 900 });
  });

  it('SUMS a block the athlete came back to', () => {
    /* The case one "first entered at" stamp per block could not describe, and
       the reason `blockLog` is a list. */
    const s = sess({
      blockLog: [
        { id: 'a', at: 0 },
        { id: 'b', at: 60_000 },
        { id: 'a', at: 90_000 },
      ],
      completedAt: 120_000,
    });
    /* `a` ran 0–60s and again 90–120s: sixty plus thirty. */
    expect(blockDurations(s)).toEqual({ a: 90, b: 30 });
  });

  it('leaves a block the athlete never opened OUT, rather than at zero', () => {
    /* Zero says "they were there and it took no time"; absent says "they were
       never there", and only the second is true of a session that ended early. */
    const s = sess({ blockLog: [{ id: 'a', at: 0 }], completedAt: 60_000 });
    expect(blockDurations(s).b).toBeUndefined();
  });

  it('needs a clock for a live session, and drops the open segment without one', () => {
    const live = sess({ status: 'active', blockLog: [{ id: 'a', at: 0 }, { id: 'b', at: 60_000 }] });
    expect(blockDurations(live)).toEqual({ a: 60 });
    expect(blockDurations(live, 90_000)).toEqual({ a: 60, b: 30 });
  });

  it('never reports negative time when the device clock went backwards', () => {
    const s = sess({ blockLog: [{ id: 'a', at: 60_000 }], completedAt: 0 });
    expect(blockDurations(s)).toEqual({ a: 0 });
  });

  it('is empty for a session logged before any of this existed', () => {
    expect(blockDurations(sess({ completedAt: 5 }))).toEqual({});
  });
});

describe('sessionDuration', () => {
  it('is the two stamps that have always been there', () => {
    expect(
      sessionDuration({ startedAt: 1_000, completedAt: 91_000 } as unknown as Session),
    ).toBe(90);
  });

  it('is zero for a session that never finished', () => {
    expect(sessionDuration({ startedAt: 1_000 } as unknown as Session)).toBe(0);
  });
});

describe('blockDurations survives a blob it did not write', () => {
  /* A stored session is a trust boundary — a backup restore, a hand-edited
     blob or a bad merge can put anything in `blockLog`, and `forEach` on a
     string would take the whole recap screen down. */
  it('treats a non-array log as no log rather than throwing', () => {
    expect(blockDurations({ blockLog: 'nope' } as unknown as Session)).toEqual({});
    expect(blockDurations({ blockLog: 7 } as unknown as Session)).toEqual({});
  });

  it('skips entries with no id or no numeric stamp', () => {
    const s = {
      completedAt: 120_000,
      blockLog: [null, { at: 0 }, { id: 'a' }, { id: 'b', at: 'soon' }, { id: 'c', at: 60_000 }],
    } as unknown as Session;
    expect(blockDurations(s)).toEqual({ c: 60 });
  });
});
