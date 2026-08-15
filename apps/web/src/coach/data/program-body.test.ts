import { describe, expect, it } from 'vitest';
import { sessionsFromBody } from './program-body';

/*
 * `program_template_versions.body` is unconstrained, coach-written jsonb — see
 * the migration's own comment ("the engine-shaped body: sessions per week,
 * weeks, progression model, blocks") and arc-athlete-sync.ts:385. So this
 * reader is defensive by contract, not by superstition: a Library that throws
 * on one malformed template shows the coach nothing at all, which is strictly
 * worse than showing that one template as empty.
 */
describe('sessionsFromBody', () => {
  it('reads sessions in the engine Workout shape', () => {
    const out = sessionsFromBody({
      sessions: [
        { id: 'w1', name: 'Day 1 · Squat', blocks: [] },
        { id: 'w2', name: 'Day 2 · Press', blocks: [] },
      ],
    });
    expect(out.map((s) => s.name)).toEqual(['Day 1 · Squat', 'Day 2 · Press']);
  });

  it('returns nothing for a body that carries no sessions', () => {
    expect(sessionsFromBody({ sessionsPerWeek: 3, weeks: 8 })).toEqual([]);
  });

  it('returns nothing rather than throwing for a malformed body', () => {
    expect(sessionsFromBody(undefined)).toEqual([]);
    expect(sessionsFromBody(null)).toEqual([]);
    expect(sessionsFromBody('not an object')).toEqual([]);
    expect(sessionsFromBody({ sessions: 'not an array' })).toEqual([]);
  });

  it('drops entries that are not usable sessions, keeping the ones that are', () => {
    const out = sessionsFromBody({
      sessions: [null, { name: 'no id' }, { id: 'w1', name: 'Real', blocks: [] }, 42],
    });
    expect(out.map((s) => s.id)).toEqual(['w1']);
  });

  it('tolerates a session with no blocks rather than dropping it', () => {
    const out = sessionsFromBody({ sessions: [{ id: 'w1', name: 'Shell' }] });
    expect(out).toHaveLength(1);
    expect(out[0].blocks).toEqual([]);
  });

  it('replaces a non-array blocks field rather than passing it through', () => {
    const out = sessionsFromBody({ sessions: [{ id: 'w1', name: 'Odd', blocks: 'nope' }] });
    expect(out[0].blocks).toEqual([]);
  });
});
