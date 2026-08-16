import { describe, expect, it } from 'vitest';
import { conAdapt, condEffort, effortForFelt, withFeltZones, CON_EFFORTS } from './index';

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

import { cardioCompletionFor, painHoldFor, progressionKey, pushCondHistory } from './conditioning';
import { sanitizeDB } from './db';
import type { CondBlock, CondResult, Modality, Session, Settings } from './types';

describe('pushCondHistory survives a poisoned settings.conditioning array', () => {
  it('does not throw sorting past a null/garbage entry once sanitizeDB has run, and keeps the good ones plus the new record', () => {
    // Same reachability as the balance.ts crash: a backup restore (replace
    // mode) or stale local blob carries a settings.conditioning array with a
    // null/non-object entry through to this consumer, which used to throw on
    // `list.sort` reading `.startedAt`.
    const db = sanitizeDB({ settings: { conditioning: [null, 'garbage', { id: 'c1', startedAt: 100 }, 42] } });
    const rec: CondResult = { id: 'new', startedAt: 999 };
    expect(() => pushCondHistory(db.settings, rec)).not.toThrow();
    const list = pushCondHistory(db.settings, rec);
    expect(list).toEqual([{ id: 'c1', startedAt: 100 }, rec]);
  });
});

test('progressionKey is just the format when modality is absent', () => {
  expect(progressionKey('intervals', undefined)).toBe('intervals');
});

test('progressionKey composes format and modality when both are present', () => {
  expect(progressionKey('intervals', 'row')).toBe('intervals:row');
});

test('conAdapt keys progress by format+modality, not format alone', () => {
  const settings = {};
  const rowResult = { fmt: 'intervals', modality: 'row', zsec: { low: 0, mod: 10, high: 0 }, dur: 20, felt: '5' } as CondResult;
  const { conProgress } = conAdapt(rowResult, settings);
  expect(conProgress['intervals:row']).toBeDefined();
  expect(conProgress['intervals']).toBeUndefined();
});

test('intervals: felt RPE within the effort band counts as on-target even with weak zone time', () => {
  const settings = {};
  // effort 'hard' → RPE band per CON_EFFORTS; zone time deliberately below the
  // old 0.45 threshold to prove RPE, not zone time, is now driving this.
  const rec = { fmt: 'intervals', effort: 'hard', felt: '8', zsec: { low: 10, mod: 5, high: 0 }, dur: 20 } as CondResult;
  const { delta } = conAdapt(rec, settings);
  expect(delta).toBe(1);
});

test('intervals: no felt RPE falls back to the existing zone-time heuristic', () => {
  const settings = {};
  const rec = { fmt: 'intervals', effort: 'hard', zsec: { low: 0, mod: 10, high: 0 }, dur: 20 } as CondResult; // 50% >= 0.45
  const { delta } = conAdapt(rec, settings);
  expect(delta).toBe(1);
});

test('steady: still gated on zone time regardless of felt RPE', () => {
  const settings = {};
  // workSec for steady is low+mod = 5 of total 10 banked zone-seconds — 50%,
  // under the 0.6 gate (and high stays at 50%, under the overcooked line, so
  // the zone gate alone decides). If steady consulted RPE, felt 9 vs the easy
  // band would read as gap >= 0 and wrongly earn.
  const rec = { fmt: 'steady', effort: 'easy', felt: '9', zsec: { low: 5, mod: 0, high: 5 }, dur: 20 } as CondResult;
  const { delta } = conAdapt(rec, settings);
  expect(delta).toBe(0); // a miss, not an earn — high RPE does not override steady's HR gate
});

describe('cardioCompletionFor', () => {
  // Interval formats gate on mod+high work at 45% of the banked zone time
  // (dur is only the fallback denominator when no zone time exists at all);
  // the borderline band opens at 70% of that gate (0.315).
  it('intervals: mod+high fraction at or above 45% is met', () => {
    expect(cardioCompletionFor('intervals', { low: 55, mod: 45, high: 0 }, 100)).toBe('met'); // exactly 0.45
    expect(cardioCompletionFor('intervals', { low: 10, mod: 20, high: 30 }, 60)).toBe('met'); // 0.83
  });

  it('intervals: between 70% of the gate and the gate is borderline', () => {
    expect(cardioCompletionFor('intervals', { low: 60, mod: 40, high: 0 }, 100)).toBe('borderline'); // 0.40
    expect(cardioCompletionFor('intervals', { low: 68, mod: 0, high: 32 }, 100)).toBe('borderline'); // 0.32
  });

  it('intervals: under 70% of the gate is not met', () => {
    expect(cardioCompletionFor('intervals', { low: 69, mod: 31, high: 0 }, 100)).toBe('not_met'); // 0.31
    expect(cardioCompletionFor('intervals', { low: 100, mod: 0, high: 0 }, 100)).toBe('not_met'); // 0
  });

  // Steady counts low+mod as work and gates at 60% (borderline from 0.42).
  it('steady: low+mod fraction against the 60% gate, three bands', () => {
    expect(cardioCompletionFor('steady', { low: 30, mod: 30, high: 40 }, 100)).toBe('met'); // 0.60
    expect(cardioCompletionFor('steady', { low: 42, mod: 0, high: 58 }, 100)).toBe('borderline'); // 0.42
    expect(cardioCompletionFor('steady', { low: 41, mod: 0, high: 59 }, 100)).toBe('not_met'); // 0.41
  });

  it('a strapless run (no zone time at all) divides by dur and is not met', () => {
    expect(cardioCompletionFor('intervals', { low: 0, mod: 0, high: 0 }, 1200)).toBe('not_met');
    expect(cardioCompletionFor('intervals', undefined, 1200)).toBe('not_met');
  });
});

describe('modality, device, and completion fields', () => {
  it('CondBlock and CondResult accept the new optional fields', () => {
    const modality: Modality = 'air_bike';
    const block: CondBlock = {
      id: 'b1',
      kind: 'conditioning',
      condFmt: 'intervals',
      modality,
      device: { manufacturer: 'Rogue', model: 'Echo Bike', generation: 'V3', consoleMetric: 'watts' },
    };
    const result: CondResult = {
      id: 'r1',
      fmt: 'intervals',
      modality: 'air_bike',
      device: { manufacturer: 'Rogue', model: 'Echo Bike', generation: 'V3', consoleMetric: 'watts' },
      cardioCompletion: 'met',
      mechanicalCompletion: 'local_fatigue',
      avgPowerW: 210,
      avgCadenceRpm: 62,
    };
    expect(block.modality).toBe('air_bike');
    expect(result.cardioCompletion).toBe('met');
    expect(result.mechanicalCompletion).toBe('local_fatigue');
  });

  it('the new fields stay optional — existing shapes still compile untouched', () => {
    const bare: CondResult = { id: 'r2', fmt: 'steady' };
    expect(bare.modality).toBeUndefined();
    expect(bare.device).toBeUndefined();
  });
});

describe('painHoldFor', () => {
  const NOW = Date.parse('2026-02-03T12:00:00Z');
  const painResult = (over: Partial<CondResult> = {}): CondResult => ({
    id: 'r-pain',
    fmt: 'intervals',
    modality: 'row',
    startedAt: NOW - 24 * 3600_000,
    mechanicalCompletion: 'pain_stop',
    ...over,
  });

  it('holds nothing when there is no conditioning history at all', () => {
    const held = painHoldFor('intervals', [], {}, 'row');
    expect(held.held).toBe(false);
    expect(held.reasonCode).toBeNull();
  });

  it('holds nothing when the most recent result in the bucket is not a pain stop', () => {
    const settings: Settings = { conditioning: [painResult({ mechanicalCompletion: 'met', startedAt: NOW })] };
    expect(painHoldFor('intervals', [], settings, 'row').held).toBe(false);
  });

  it('holds the bucket when the most recent result ended in a reported pain stop', () => {
    const settings: Settings = { conditioning: [painResult()] };
    const held = painHoldFor('intervals', [], settings, 'row');
    expect(held.held).toBe(true);
    expect(held.reasonCode).toBe('pain_stop_pending_ack');
    expect(held.since).toBe(NOW - 24 * 3600_000);
  });

  it('clears once acknowledged at or after the pain-stop timestamp', () => {
    const paintAt = NOW - 24 * 3600_000;
    const settings: Settings = {
      conditioning: [painResult({ startedAt: paintAt })],
      conditioningAck: { 'intervals:row': paintAt },
    };
    expect(painHoldFor('intervals', [], settings, 'row').held).toBe(false);
  });

  it('an acknowledgement BEFORE the pain stop does not clear it (a stale ack from an earlier incident)', () => {
    const paintAt = NOW - 3600_000;
    const settings: Settings = {
      conditioning: [painResult({ startedAt: paintAt })],
      conditioningAck: { 'intervals:row': paintAt - 3600_000 },
    };
    expect(painHoldFor('intervals', [], settings, 'row').held).toBe(true);
  });

  it('does not bleed across modalities — a rowing pain stop says nothing about bike', () => {
    const settings: Settings = { conditioning: [painResult({ modality: 'row' })] };
    expect(painHoldFor('intervals', [], settings, 'bike').held).toBe(false);
  });

  it('a newer non-pain-stop result in the same bucket supersedes an older pain stop', () => {
    const settings: Settings = {
      conditioning: [
        painResult({ startedAt: NOW - 48 * 3600_000 }),
        painResult({ startedAt: NOW - 3600_000, mechanicalCompletion: 'met' }),
      ],
    };
    expect(painHoldFor('intervals', [], settings, 'row').held).toBe(false);
  });

  it('ignores a simulated session even if it carries pain_stop', () => {
    const settings: Settings = { conditioning: [painResult({ sim: true })] };
    expect(painHoldFor('intervals', [], settings, 'row').held).toBe(false);
  });

  it('reads a result banked inline on a session block, not only settings.conditioning', () => {
    const sessions: Session[] = [
      {
        id: 's1',
        date: '2026-02-02',
        status: 'completed',
        blocks: [{ id: 'b1', kind: 'conditioning', condFmt: 'intervals', condResult: painResult() }],
      },
    ];
    const held = painHoldFor('intervals', sessions, {}, 'row');
    expect(held.held).toBe(true);
  });
});

describe('a strapless session is credited from its own rating', () => {
  /*
   * The owner's decision, 16 August 2026: a conditioning session without a
   * strap "asks for RPE at the end of the session and adds up to the minutes
   * in that easy/medium/hard areas."
   *
   * The problem it solves is the one the deleted lab found: `conAdapt` returns
   * at `if (zoned <= 0)`, so a strapless session earned nothing AND was not
   * counted as a miss. Most sessions are strapless, so most sessions were
   * invisible to progression.
   */
  const rec = (over: Partial<CondResult> = {}): CondResult =>
    ({ fmt: 'steady', dur: 1200, ...over }) as CondResult;

  it('reads the effort band a rating falls in, including the gaps and the ends', () => {
    /* The bands are easy 3–4, medium 5–7, hard 8–9.5 — contiguous in intent,
       not in numbers, so 4.5 and 10 have to be decided rather than looked up. */
    expect(effortForFelt(2)).toBe('easy');
    expect(effortForFelt(4)).toBe('easy');
    expect(effortForFelt(4.5)).toBe('medium');
    expect(effortForFelt(6)).toBe('medium');
    expect(effortForFelt(8)).toBe('hard');
    expect(effortForFelt(10)).toBe('hard');
    expect(effortForFelt('7')).toBe('medium');
  });

  it('is null for no answer, which is not the same as an easy session', () => {
    expect(effortForFelt(undefined)).toBeNull();
    expect(effortForFelt('')).toBeNull();
    expect(effortForFelt('hard')).toBeNull();
  });

  it('puts the WHOLE duration in the one zone the rating names', () => {
    /* Cruder than a trace on purpose: a rating is one number about a whole
       session, so spreading it across zones would invent detail. */
    expect(withFeltZones(rec({ felt: '6' })).zsec).toEqual({ low: 0, mod: 1200, high: 0 });
    expect(withFeltZones(rec({ felt: '3' })).zsec).toEqual({ low: 1200, mod: 0, high: 0 });
    expect(withFeltZones(rec({ felt: '9' })).zsec).toEqual({ low: 0, mod: 0, high: 1200 });
  });

  it('MARKS it as derived, so nothing mistakes it for a chest strap', () => {
    expect(withFeltZones(rec({ felt: '6' })).zsrc).toBe('felt');
  });

  it('leaves a MEASURED record completely alone', () => {
    /* Real data always wins. */
    const measured = rec({ felt: '9', zsec: { low: 100, mod: 200, high: 300 } });
    const out = withFeltZones(measured);
    expect(out).toBe(measured);
    expect(out.zsrc).toBeUndefined();
  });

  it('does nothing without a rating or without a duration', () => {
    expect(withFeltZones(rec({})).zsec).toBeUndefined();
    expect(withFeltZones(rec({ felt: '6', dur: 0 })).zsec).toBeUndefined();
  });

  it('EARNS a level where the same session used to earn nothing', () => {
    /* The whole point. Twenty minutes rated 6 on a steady session is zone time
       the athlete really did, and progression can finally see it. */
    const before = conAdapt(rec({ felt: '6' }), {});
    expect(before.delta).toBe(0);
    const after = conAdapt(withFeltZones(rec({ felt: '6' })), {});
    expect(after.delta).toBe(1);
  });

  it('and can now MISS, which is the other half of being visible', () => {
    /* A steady session rated 9 banks all its time in the high zone, which is
       not what steady asked for — `overcooked`. Before this it was silence:
       no earn, no miss, nothing.
       The miss COUNTER moves and `delta` stays 0, because a deload needs two
       consecutive misses. Both halves matter — being counted is the change,
       and one bad session still not dropping the level is the existing rule
       working on data it could not previously see. */
    const first = conAdapt(withFeltZones(rec({ felt: '9' })), {});
    expect(first.delta).toBe(0);
    expect(first.conProgress.steady).toEqual({ level: 0, miss: 1 });

    const second = conAdapt(withFeltZones(rec({ felt: '9' })), { conProgress: first.conProgress });
    expect(second.delta).toBe(-1);
  });
});
