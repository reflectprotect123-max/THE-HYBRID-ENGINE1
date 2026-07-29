import { describe, expect, it } from 'vitest';
import { cellSummary, libraryCandidates } from '../src/builder/grid';
import type { CoachProgram, CoachSession } from '../src/model';

const session = (id: string, blocks: CoachSession['blocks']): CoachSession => ({ id, name: 'S', blocks, updatedAt: 1 });

describe('cellSummary', () => {
  it('is empty for no session', () => {
    expect(cellSummary(null)).toEqual({ status: 'empty', line: '', sets: 0, isCond: false });
  });

  it('lists up to 3 movement names, with a +N overflow', () => {
    const s = session('s1', [
      { id: 'b1', heading: 'Main', superset: false, exercises: [
        { id: 'e1', name: 'Back Squat', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
        { id: 'e2', name: 'Bench', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
        { id: 'e3', name: 'Row', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
        { id: 'e4', name: 'Curl', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
      ] },
    ]);
    const r = cellSummary(s);
    expect(r).toEqual({ status: 'filled', line: 'Back Squat · Bench · Row +1', sets: 4, isCond: false });
  });

  it('names the conditioning format when there are no lift exercises', () => {
    const s = session('s2', [{ id: 'b1', kind: 'conditioning', condFmt: 'intervals', targetZone: 'mod' }]);
    expect(cellSummary(s)).toEqual({ status: 'filled', line: 'Intervals', sets: 0, isCond: true });
  });

  it('says "No movements yet" for a session with an empty block', () => {
    const s = session('s3', [{ id: 'b1', heading: 'Main', superset: false, exercises: [{ id: 'e1', name: '', mode: 'reps_kg', rest: 90, sets: [] }] }]);
    expect(cellSummary(s).line).toBe('No movements yet');
  });
});

describe('libraryCandidates', () => {
  it('collects every distinct session across all weeks, deduplicated by id', () => {
    const a = session('a', []);
    const b = session('b', []);
    const program: CoachProgram = {
      id: 'p1', name: 'P',
      weeks: [
        { days: [a, null, b, null, null, null, null] },
        { days: [a, null, null, null, null, null, null] }, // same session reused on week 2
      ],
    };
    expect(libraryCandidates(program).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('is empty for a programme with nothing written', () => {
    const program: CoachProgram = { id: 'p1', name: 'P', weeks: [{ days: [null, null, null, null, null, null, null] }] };
    expect(libraryCandidates(program)).toEqual([]);
  });
});
