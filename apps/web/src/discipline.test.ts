// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiscipline, setDiscipline, __resetDisciplineForTest } from './discipline';

describe('useDiscipline', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDisciplineForTest();
  });

  it('defaults to training when nothing is persisted', () => {
    const { result } = renderHook(() => useDiscipline());
    expect(result.current).toBe('training');
  });

  it('reflects setDiscipline immediately, including in other hook instances', () => {
    const { result: a } = renderHook(() => useDiscipline());
    const { result: b } = renderHook(() => useDiscipline());

    act(() => setDiscipline('nutrition'));

    expect(a.current).toBe('nutrition');
    expect(b.current).toBe('nutrition');
  });

  it('persists across a fresh hook mount (simulating reload)', () => {
    act(() => setDiscipline('nutrition'));
    const { result } = renderHook(() => useDiscipline());
    expect(result.current).toBe('nutrition');
  });
});
