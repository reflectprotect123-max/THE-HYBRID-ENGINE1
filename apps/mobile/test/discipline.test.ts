// Jest injects describe/it/expect/beforeEach as globals — see the sibling
// tests, none of which import a runner.
import {
  __resetDisciplineForTest,
  currentDiscipline,
  disciplineOf,
  setDiscipline,
  splitActiveSession,
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
