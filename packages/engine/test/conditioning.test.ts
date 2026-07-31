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

import { progressionKey } from '../src/conditioning';
import type { CondBlock, CondResult, Modality } from '../src/types';

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
