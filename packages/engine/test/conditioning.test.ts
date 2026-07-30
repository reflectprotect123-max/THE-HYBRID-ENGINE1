import { describe, expect, it } from 'vitest';
import { conAdapt, condEffort, CON_EFFORTS } from '../src/index';

describe('conAdapt no-data guard', () => {
  it('a run with no zone time earns nothing and costs nothing', () => {
    const settings = { conProgress: { intervals: { level: 5, miss: 0 } } };
    const r1 = conAdapt({ id: 'a', fmt: 'intervals', zsec: { low: 0, mod: 0, high: 0 }, dur: 1200 }, settings);
    expect(r1.conProgress.intervals).toEqual({ level: 5, miss: 0 });
    const r2 = conAdapt({ id: 'b', fmt: 'intervals', zsec: { low: 0, mod: 0, high: 0 }, dur: 1200 },
      { conProgress: r1.conProgress });
    expect(r2.conProgress.intervals).toEqual({ level: 5, miss: 0 }); // still not deloaded
  });
});

describe('condEffort prototype guard', () => {
  it('a prototype-named effort falls back to medium instead of the Object constructor', () => {
    expect(condEffort({ effort: 'constructor' } as never)).toEqual(CON_EFFORTS.medium);
  });
});
