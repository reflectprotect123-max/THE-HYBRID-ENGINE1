import { describe, expect, it } from 'vitest';
import type { Workout } from '@hybrid/engine';
import type { LedgerEntry } from '../store/ledger';
import { plannedForToday, showZonesCard } from './Home';

describe('showZonesCard', () => {
  it('hides the zones door for a strength-scoped build', () => {
    expect(showZonesCard('strength', true)).toBe(false);
  });

  it('keeps the zones door for a conditioning-scoped build', () => {
    expect(showZonesCard('conditioning', true)).toBe(true);
  });

  it('keeps the zones door for the unscoped dashboard build, even if the product defaulted to strength', () => {
    expect(showZonesCard('strength', false)).toBe(true);
  });
});

/*
 * Approving an Auto-Coached proposal for a RECURRING session writes a one-off
 * fork dated today rather than mutating the template. Both then matched the
 * planned-today filter — the fork by `dates`, the original still by `days` —
 * so "Today's plan" showed the session twice and "Start today's session"
 * attached to the first card, the un-adjusted original.
 */
const TODAY = '2026-08-10';
const DOW = new Date(`${TODAY}T00:00:00Z`).getUTCDay(); // Monday = 1

const recurring = { id: 'w-1', name: 'Heavy Lower', kind: 'strength', blocks: [], days: [DOW] } as unknown as Workout;
const fork = { id: 'w-fork', name: 'Heavy Lower', kind: 'strength', blocks: [], dates: [TODAY] } as unknown as Workout;
const other = { id: 'w-2', name: 'Zone 2', kind: 'conditioning', blocks: [], days: [DOW] } as unknown as Workout;

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'l-1',
    at: 1,
    date: TODAY,
    workoutId: 'w-1',
    action: 'applied',
    wasForked: true,
    forkedWorkoutId: 'w-fork',
    operations: [],
    reasonCodes: [],
    ...over,
  } as LedgerEntry;
}

describe('plannedForToday', () => {
  it('lists both a dated and a recurring session when nothing has been forked', () => {
    expect(plannedForToday([recurring, other], [], TODAY, DOW).map((w) => w.id)).toEqual(['w-1', 'w-2']);
  });

  it('shows only the fork, not the original, once today has been forked from it', () => {
    const out = plannedForToday([recurring, fork, other], [entry()], TODAY, DOW);
    expect(out.map((w) => w.id)).toEqual(['w-fork', 'w-2']);
  });

  it('brings the original back when the fork was undone', () => {
    // recordUndo prepends an `undone` copy; the fork itself is deleted.
    const out = plannedForToday(
      [recurring, other],
      [entry({ id: 'l-2', action: 'undone' }), entry()],
      TODAY,
      DOW,
    );
    expect(out.map((w) => w.id)).toEqual(['w-1', 'w-2']);
  });

  it('ignores a fork entry from another date', () => {
    const out = plannedForToday([recurring, fork], [entry({ date: '2026-08-09' })], TODAY, DOW);
    expect(out.map((w) => w.id)).toEqual(['w-1', 'w-fork']);
  });

  it('keeps the original when the ledger names a fork that no longer exists', () => {
    const out = plannedForToday([recurring], [entry()], TODAY, DOW);
    expect(out.map((w) => w.id)).toEqual(['w-1']);
  });

  it('leaves an in-place (unforked) apply alone — there is no second card to drop', () => {
    const dated = { id: 'w-1', name: 'Heavy Lower', kind: 'strength', blocks: [], dates: [TODAY] } as unknown as Workout;
    const out = plannedForToday([dated], [entry({ wasForked: false, forkedWorkoutId: undefined })], TODAY, DOW);
    expect(out.map((w) => w.id)).toEqual(['w-1']);
  });
});
