import { describe, expect, it } from 'vitest';
import { buildCatalogue, filterCatalogue, tagCounts, CATALOGUE_TAGS } from './catalogue';
import type { Session, Workout } from './types';

/*
 * The catalogue DERIVES its movement list from what the athlete actually has —
 * authored workouts and logged sessions — and takes its tags from a
 * coach-owned store. It never invents a tag from context: a movement that
 * appeared in a conditioning block is not thereby "Conditioning", because that
 * is a guess wearing the costume of a fact, and the picker then FILTERS on it.
 *
 * Why this does not call `knownMovements`, which derives from the same two
 * sources: that function filters to `isLiftMode` — `reps_kg` and `amrap` only —
 * because its job is to stop one LIFT being written two ways, where
 * `exLogFor`, `detectPRs` and `bestE1rmByLift` all key on the name. The
 * exercise picker needs everything a block can hold, conditioning included;
 * the mockup's own seed tags "Row Erg" as Conditioning. So the lift-only
 * contract stays intact for the progression paths that depend on it, and the
 * catalogue derives beside it.
 *
 * It DOES copy `knownMovements`' de-duplication rule — case-insensitive,
 * keeping the most recent spelling — because two lists that disagree about
 * whether it is "Back Squat" or "back squat" are worse than one list.
 */
function w(id: string, movements: [string, Workout['blocks'][number] extends never ? never : string][], at = 1): Workout {
  return {
    id,
    name: id,
    updatedAt: at,
    blocks: [
      {
        id: `${id}-b`,
        exercises: movements.map(([name, mode], i) => ({
          id: `${id}-e${i}`,
          name,
          mode,
          sets: [],
        })),
      },
    ],
  } as unknown as Workout;
}

function s(id: string, movements: [string, string][], at = 1): Session {
  return {
    id,
    completedAt: at,
    blocks: [
      {
        id: `${id}-b`,
        exercises: movements.map(([name, mode], i) => ({
          id: `${id}-e${i}`,
          name,
          mode,
          sets: [],
        })),
      },
    ],
  } as unknown as Session;
}

describe('buildCatalogue', () => {
  it('lists every movement the athlete actually has, once each', () => {
    const out = buildCatalogue(
      [w('a', [['Back Squat', 'reps_kg']]), w('b', [['Back Squat', 'reps_kg']]), w('c', [['Row Erg', 'seconds']])],
      [],
      undefined,
    );
    expect(out.map((e) => e.name)).toEqual(['Back Squat', 'Row Erg']);
  });

  /*
   * The whole reason this is not `knownMovements`: a conditioning movement is
   * a real thing a coach puts in a block, and the picker must offer it.
   */
  it('includes movements that are not lifts', () => {
    const out = buildCatalogue([w('a', [['Row Erg', 'seconds']], 1), w('b', [['Burpee', 'reps']], 2)], [], undefined);
    expect(out.map((e) => e.name)).toEqual(['Burpee', 'Row Erg']);
  });

  it('counts how often a movement is used, across workouts and sessions', () => {
    const out = buildCatalogue(
      [w('a', [['Back Squat', 'reps_kg']]), w('b', [['Back Squat', 'reps_kg']])],
      [s('s1', [['Back Squat', 'reps_kg']])],
      undefined,
    );
    expect(out.find((e) => e.name === 'Back Squat')?.uses).toBe(3);
  });

  it('de-duplicates case-insensitively, keeping the most recent spelling', () => {
    const out = buildCatalogue(
      [w('old', [['back squat', 'reps_kg']], 1), w('new', [['Back Squat', 'reps_kg']], 99)],
      [],
      undefined,
    );
    expect(out.map((e) => e.name)).toEqual(['Back Squat']);
    expect(out[0].uses).toBe(2);
  });

  it('takes tags from the store, and leaves an unlisted movement untagged', () => {
    const out = buildCatalogue(
      [w('a', [['Back Squat', 'reps_kg']]), w('b', [['Row Erg', 'seconds']])],
      [],
      { 'Back Squat': ['Barbell'] },
    );
    expect(out.find((e) => e.name === 'Back Squat')?.tags).toEqual(['Barbell']);
    expect(out.find((e) => e.name === 'Row Erg')?.tags).toEqual([]);
  });

  it('returns nothing for an athlete with no workouts and no sessions', () => {
    expect(buildCatalogue([], [], undefined)).toEqual([]);
  });

  it('survives a malformed workout rather than throwing', () => {
    const out = buildCatalogue(
      [null as unknown as Workout, { id: 'x', name: 'x', updatedAt: 1 } as unknown as Workout],
      [],
      undefined,
    );
    expect(out).toEqual([]);
  });

  it('ignores a nameless exercise', () => {
    const out = buildCatalogue([w('a', [['   ', 'reps_kg'], ['Pull-Up', 'reps']])], [], undefined);
    expect(out.map((e) => e.name)).toEqual(['Pull-Up']);
  });
});

describe('tagCounts', () => {
  it('counts each tag across the catalogue and reports zero for unused ones', () => {
    const entries = buildCatalogue(
      [w('a', [['Back Squat', 'reps_kg']]), w('b', [['Pull-Up', 'reps']])],
      [],
      { 'Back Squat': ['Barbell'], 'Pull-Up': ['Bodyweight', 'Band'] },
    );
    const counts = tagCounts(entries);
    expect(counts.find((c) => c.tag === 'Barbell')?.count).toBe(1);
    expect(counts.find((c) => c.tag === 'Bodyweight')?.count).toBe(1);
    expect(counts.find((c) => c.tag === 'Band')?.count).toBe(1);
    expect(counts.find((c) => c.tag === 'Warm-up')?.count).toBe(0);
  });

  it('reports every tag the picker offers, in the mockup order', () => {
    expect(tagCounts([]).map((c) => c.tag)).toEqual([...CATALOGUE_TAGS]);
  });
});

describe('filterCatalogue', () => {
  const entries = buildCatalogue(
    [w('a', [['Back Squat', 'reps_kg']]), w('b', [['Pull-Up', 'reps']]), w('c', [['Row Erg', 'seconds']])],
    [],
    { 'Back Squat': ['Barbell'], 'Pull-Up': ['Bodyweight'] },
  );

  it('matches a search regardless of case', () => {
    expect(filterCatalogue(entries, 'squat', []).map((e) => e.name)).toEqual(['Back Squat']);
  });

  it('filters to movements carrying ANY active tag', () => {
    expect(filterCatalogue(entries, '', ['Bodyweight']).map((e) => e.name)).toEqual(['Pull-Up']);
  });

  it('applies search and tags together', () => {
    expect(filterCatalogue(entries, 'u', ['Bodyweight']).map((e) => e.name)).toEqual(['Pull-Up']);
  });

  it('returns everything when nothing is asked for', () => {
    expect(filterCatalogue(entries, '', []).length).toBe(3);
  });

  it('returns nothing when a filter excludes everything, rather than falling back to all', () => {
    expect(filterCatalogue(entries, 'zzzz', [])).toEqual([]);
  });
});
