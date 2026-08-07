// Jest injects describe/it/expect/beforeEach as globals — see the sibling
// tests, none of which import a runner.
import {
  __resetDisciplineForTest,
  currentDiscipline,
  disciplineOf,
  setDiscipline,
  splitActiveSession,
  trainingScope,
} from '../src/discipline';

beforeEach(() => __resetDisciplineForTest());

describe('discipline store', () => {
  it('defaults a fresh install to strength', () => {
    expect(currentDiscipline()).toBe('strength');
  });

  it('remembers a switch', () => {
    setDiscipline('conditioning');
    expect(currentDiscipline()).toBe('conditioning');
  });

  it('holds the third world too, and comes back from it', () => {
    setDiscipline('nutrition');
    expect(currentDiscipline()).toBe('nutrition');
    setDiscipline('strength');
    expect(currentDiscipline()).toBe('strength');
  });
});

describe('trainingScope', () => {
  it('is the world itself while the athlete is in a training world', () => {
    expect(trainingScope('strength')).toBe('strength');
    expect(trainingScope('conditioning')).toBe('conditioning');
  });

  it('holds the training world a nutrition detour started from', () => {
    // Nutrition is not a training identity, so `restrictToProduct` and the
    // live-session split have no answer for it — and defaulting to strength
    // would silently re-scope a conditioning athlete's whole library for as
    // long as they were looking at their food.
    setDiscipline('conditioning');
    setDiscipline('nutrition');
    expect(trainingScope(currentDiscipline())).toBe('conditioning');
  });

  it('defaults to strength when nutrition is the only world ever chosen', () => {
    setDiscipline('nutrition');
    expect(trainingScope(currentDiscipline())).toBe('strength');
  });
});

describe('disciplineOf', () => {
  it('defaults absent/unknown kind to strength, never guesses conditioning', () => {
    expect(disciplineOf('conditioning')).toBe('conditioning');
    expect(disciplineOf(undefined)).toBe('strength');
    expect(disciplineOf('anything-else')).toBe('strength');
  });
});

describe('splitActiveSession', () => {
  const cond = { id: 'c1', kind: 'conditioning' } as const;
  it('routes a foreign live session to foreignActiveSession, never to null', () => {
    expect(splitActiveSession(cond, 'strength')).toEqual({
      activeSession: null,
      foreignActiveSession: cond,
    });
  });
  it('reports nothing live when nothing live', () => {
    expect(splitActiveSession(null, 'strength')).toEqual({
      activeSession: null,
      foreignActiveSession: null,
    });
  });
});
