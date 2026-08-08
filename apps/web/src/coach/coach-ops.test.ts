import { describe, expect, it } from 'vitest';
import { mergeEngines, sanitizeDB, type EngineDB, type Workout } from '@hybrid/engine';
import {
  applyWeekClear,
  applyWeekCopy,
  occurrenceKind,
  planWeekClear,
  planWeekCopy,
} from './ops';

const MON = '2026-08-10'; // a Monday
const NEXT = '2026-08-17';
const TODAY = '2026-08-06';

function w(over: Partial<Workout>): Workout {
  return { id: over.id ?? 'w1', blocks: [], ...over } as Workout;
}

describe('occurrenceKind', () => {
  it('classifies one-off dates, recurring days, and absence', () => {
    const oneoff = w({ dates: [MON] });
    const recurring = w({ days: [1] }); // Mondays (0=Sunday semantics)
    expect(occurrenceKind(oneoff, MON)).toBe('oneoff');
    expect(occurrenceKind(recurring, MON)).toBe('recurring');
    expect(occurrenceKind(recurring, '2026-08-11')).toBe('none');
  });

  it('prefers oneoff when a date is both explicit and recurring', () => {
    const both = w({ dates: [MON], days: [1] });
    expect(occurrenceKind(both, MON)).toBe('oneoff');
  });
});

describe('planWeekCopy', () => {
  it('copies one-off placements to the target week, same weekday offset', () => {
    const plan = planWeekCopy([w({ id: 'a', name: 'Test day', dates: ['2026-08-12'] })], MON, [NEXT], TODAY);
    expect(plan.creates).toEqual([
      { sourceId: 'a', name: 'Test day', kind: undefined, date: '2026-08-19' },
    ]);
    expect(plan.collisions).toEqual([]);
  });

  it('never copies recurring slots — they project into the target week on their own', () => {
    const plan = planWeekCopy([w({ id: 'r', name: 'Heavy Lower', days: [1] })], MON, [NEXT], TODAY);
    expect(plan.creates).toEqual([]);
    expect(plan.skippedRecurring).toEqual(['Heavy Lower']);
  });

  it('reports collisions when a target date already holds a one-off', () => {
    const plan = planWeekCopy(
      [
        w({ id: 'a', name: 'A', dates: ['2026-08-12'] }),
        w({ id: 'b', name: 'B', dates: ['2026-08-19'] }),
      ],
      MON,
      [NEXT],
      TODAY,
    );
    expect(plan.collisions).toEqual(['2026-08-19']);
    expect(plan.creates).toHaveLength(1); // only the SOURCE week's one-off copies
  });

  it('never targets the past', () => {
    const plan = planWeekCopy(
      [w({ id: 'a', dates: ['2026-07-29'] })], // Wed of an old week
      '2026-07-27',
      ['2026-08-03'], // current week — Wed 08-05 is before TODAY
      TODAY,
    );
    expect(plan.creates).toEqual([]);
  });
});

describe('applyWeekCopy', () => {
  it('creates independent one-off workouts with cloned blocks', () => {
    const src = w({
      id: 'a',
      name: 'Test day',
      kind: 'strength',
      dates: ['2026-08-12'],
      blocks: [{ id: 'b1', exercises: [{ id: 'e1', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }] }] as Workout['blocks'],
    });
    const db: EngineDB = { workouts: [src], sessions: [], settings: {} };
    const plan = planWeekCopy(db.workouts, MON, [NEXT], TODAY);
    let n = 0;
    const made = applyWeekCopy(db, plan, () => `new-${n++}`, 123);
    expect(made).toBe(1);
    const copy = db.workouts.find((x) => x.id === 'new-0')!;
    expect(copy.dates).toEqual(['2026-08-19']);
    expect(copy.kind).toBe('strength');
    // Cloned, not shared: mutating the copy must not touch the source.
    copy.blocks[0]!.exercises![0]!.name = 'Front Squat';
    expect(src.blocks[0]!.exercises![0]!.name).toBe('Squat');
  });
});

describe('planWeekClear / applyWeekClear', () => {
  it('strips one-off placements and deletes emptied one-off workouts', () => {
    const only = w({ id: 'a', dates: ['2026-08-12'] });
    const partial = w({ id: 'b', dates: ['2026-08-13', '2026-08-20'] });
    const db: EngineDB = { workouts: [only, partial], sessions: [], settings: {} };
    const plan = planWeekClear(db.workouts, MON, TODAY);
    expect(plan.removals).toHaveLength(2);
    applyWeekClear(db, plan, 123);
    expect(db.workouts.map((x) => x.id)).toEqual(['b']);
    expect(db.workouts[0]!.dates).toEqual(['2026-08-20']);
  });

  it('leaves recurring slots alone and names them', () => {
    const plan = planWeekClear([w({ id: 'r', name: 'Heavy Lower', days: [1] })], MON, TODAY);
    expect(plan.removals).toEqual([]);
    expect(plan.untouchableRecurring).toEqual(['Heavy Lower']);
  });

  it('never clears dates before today', () => {
    const plan = planWeekClear([w({ id: 'a', dates: ['2026-08-04'] })], '2026-08-03', TODAY);
    expect(plan.removals).toEqual([]);
  });
});

/*
 * The deletion has to survive the merge, which is a different claim from "the
 * workout is gone locally". The merge is ADDITIVE: the other device still holds
 * the workout and hands it straight back, so what gets lost in a splice-only
 * delete is the deletion, not the record.
 *
 * Found by `checks/coach-contract.mjs` — every athlete-side delete stamps
 * `deletedIds`; all three coach-surface deletes did not.
 */
describe('a coach-surface delete survives a sync', () => {
  const workout = (id: string, dates: string[]): Workout =>
    ({ id, name: id, blocks: [], dates, updatedAt: 1 }) as unknown as Workout;

  const dbWith = (ws: Workout[]): EngineDB =>
    sanitizeDB({ workouts: ws, sessions: [], settings: {} } as unknown as EngineDB);

  it('stamps a tombstone, so the other device cannot hand the workout back', () => {
    const local = dbWith([workout('w1', [MON])]);
    // The phone, which has not heard about the deletion yet.
    const remote = dbWith([workout('w1', [MON])]);

    applyWeekClear(local, planWeekClear(local.workouts, MON, MON), 5000);
    expect(local.workouts.find((w) => w.id === 'w1')).toBeUndefined();
    expect(local.settings.deletedIds?.w1).toBe(5000);

    // The whole point: after a merge with the device that still has it.
    const merged = mergeEngines(local, remote);
    expect(merged.workouts.find((w) => w.id === 'w1')).toBeUndefined();
  });
});
