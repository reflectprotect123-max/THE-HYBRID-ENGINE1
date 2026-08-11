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
  detectPRs,
  duplicateExercise,
  duplicateWorkout,
  fillLinkedSets,
  lastTimeSets,
  workingSetOrdinal,
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

/*
 * `lastTimeSets` / `workingSetOrdinal` — the reference the logger shows above
 * the inputs: what you did on this lift last time, set by set.
 *
 * The pair exists because the two sides count sets differently. The logger
 * indexes every set on the exercise, warm-ups included; the history record
 * (`exLogFor`) drops warm-ups entirely. Reading last time's list at the
 * logger's own index therefore lines today's set 3 up against last time's set
 * 1 the moment an exercise opens with two warm-ups — and reporting the wrong
 * weight to chase is worse than reporting none, so the translation is tested
 * rather than assumed.
 */
const doneSet = (kg: string, reps: string, felt = ''): LoggedSet =>
  ({ done: true, aVal: kg, aVal2: reps, felt }) as LoggedSet;
const warmSet = (kg: string, reps: string): LoggedSet =>
  ({ t: 'W10', done: true, aVal: kg, aVal2: reps }) as LoggedSet;

const squatSession = (id: string, at: string, sets: LoggedSet[]): Session =>
  ({
    id,
    date: at.slice(0, 10),
    status: 'completed',
    completedAt: Date.parse(at),
    blocks: [
      {
        id: 'main',
        heading: 'Main',
        superset: false,
        exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', rest: 180, sets }],
      },
    ],
  }) as unknown as Session;

describe('lastTimeSets', () => {
  it('returns the sets from the MOST RECENT completed session, not the oldest', () => {
    const older = squatSession('s1', '2026-01-01T18:00:00Z', [doneSet('100', '8', '7.5')]);
    const newer = squatSession('s2', '2026-01-08T18:00:00Z', [doneSet('105', '6', '9')]);

    // Passed newest-FIRST on purpose: the answer must come from the session
    // dates, not from whatever order the caller happened to hand them over.
    const sets = lastTimeSets('Back Squat', [newer, older]);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ kg: 105, reps: 6, felt: '9' });
  });

  it('ignores the session being logged right now, which has no completedAt', () => {
    const done = squatSession('s1', '2026-01-01T18:00:00Z', [doneSet('100', '8')]);
    const live = {
      ...squatSession('s2', '2026-01-08T18:00:00Z', [doneSet('140', '1')]),
      status: 'active',
      completedAt: undefined,
    } as unknown as Session;

    // Without this the set just logged would be offered as its own "last time".
    expect(lastTimeSets('Back Squat', [done, live]).map((s) => s.kg)).toEqual([100]);
  });

  it('is empty for a lift with no history, rather than throwing', () => {
    expect(lastTimeSets('Front Squat', [squatSession('s1', '2026-01-01T18:00:00Z', [doneSet('100', '8')])])).toEqual([]);
    expect(lastTimeSets('Back Squat', [])).toEqual([]);
  });

  it('drops warm-ups, so the reference is working sets only', () => {
    const s = squatSession('s1', '2026-01-01T18:00:00Z', [warmSet('60', '10'), doneSet('100', '8')]);
    expect(lastTimeSets('Back Squat', [s]).map((x) => x.kg)).toEqual([100]);
  });
});

describe('workingSetOrdinal', () => {
  it('counts only working sets, so a warm-up does not shift the reference', () => {
    const sets = [warmSet('60', '10'), warmSet('80', '5'), doneSet('100', '8'), doneSet('100', '8')];
    // The bug this prevents: index 2 read straight into last time's list is
    // set 3, which does not exist — the first WORKING set is ordinal 0.
    expect(workingSetOrdinal(sets, 2)).toBe(0);
    expect(workingSetOrdinal(sets, 3)).toBe(1);
  });

  it('is -1 for a warm-up, which is never in the record at all', () => {
    const sets = [warmSet('60', '10'), doneSet('100', '8')];
    expect(workingSetOrdinal(sets, 0)).toBe(-1);
  });

  it('is -1 out of range rather than guessing', () => {
    expect(workingSetOrdinal([doneSet('100', '8')], 5)).toBe(-1);
    expect(workingSetOrdinal([doneSet('100', '8')], -1)).toBe(-1);
  });

  it('is the identity when nothing is a warm-up', () => {
    const sets = [doneSet('100', '8'), doneSet('100', '8'), doneSet('100', '6')];
    expect(sets.map((_, i) => workingSetOrdinal(sets, i))).toEqual([0, 1, 2]);
  });
});
