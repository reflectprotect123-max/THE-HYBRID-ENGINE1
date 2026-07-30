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
import { detectPRs, duplicateExercise, fillLinkedSets } from '../src/session';
import type { Exercise, LoggedSet, PlannedSet, Session } from '../src/types';

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
