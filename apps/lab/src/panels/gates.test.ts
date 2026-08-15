import { describe, expect, it } from 'vitest';
import { conAdapt } from '@hybrid/engine';
import type { CondFmtKey, CondResult, Settings } from '@hybrid/engine';
import { gatesFor, type AdaptInputs } from './Adapt';
import { phasesFor, prescriptionFor, settingsFor, totalSeconds, whoopFor, type Rig } from '../rig';

/**
 * The Adapt panel restates conAdapt's gates in English. That mirror is only
 * safe while it agrees with the engine, so this asserts the agreement directly
 * rather than trusting it: across a spread of sessions, "every gate passed"
 * must mean exactly "conAdapt earned a level".
 *
 * If the engine gains a gate, or moves one of its thresholds, and the panel is
 * not updated, this fails — which is the whole reason the panel is allowed to
 * mirror at all.
 */

const rig = (over: Partial<Rig> = {}): Rig => ({
  fmt: 'intervals',
  modality: 'row',
  level: 3,
  rec: null,
  ...over,
});

const inputs = (over: Partial<AdaptInputs> = {}): AdaptInputs => ({
  low: 120,
  mod: 420,
  high: 260,
  dur: 900,
  felt: '6',
  effort: 'medium',
  rec: 62,
  miss: 0,
  ...over,
});

function resultFor(r: Rig, inp: AdaptInputs): CondResult {
  return {
    fmt: r.fmt,
    modality: r.modality,
    effort: inp.effort,
    felt: inp.felt,
    zsec: { low: inp.low, mod: inp.mod, high: inp.high },
    dur: inp.dur,
    rec: inp.rec,
    startedAt: 1,
  };
}

function settingsWith(r: Rig, inp: AdaptInputs): Settings {
  const key = r.fmt + ':' + r.modality;
  return { conProgress: { [key]: { level: r.level, miss: inp.miss } } } as Settings;
}

const CASES: Array<{ name: string; rig: Rig; inp: AdaptInputs }> = [
  { name: 'a good interval session', rig: rig(), inp: inputs() },
  { name: 'a strapless session', rig: rig(), inp: inputs({ low: 0, mod: 0, high: 0 }) },
  { name: 'far too easy', rig: rig(), inp: inputs({ low: 820, mod: 60, high: 20, felt: '3' }) },
  { name: 'overcooked', rig: rig(), inp: inputs({ low: 40, mod: 100, high: 760, felt: '9' }) },
  { name: 'a red recovery day', rig: rig(), inp: inputs({ rec: 20 }) },
  { name: 'not rated at all', rig: rig(), inp: inputs({ felt: '' }) },
  { name: 'steady, zone-graded', rig: rig({ fmt: 'steady' }), inp: inputs({ low: 500, mod: 300, high: 20 }) },
  { name: 'steady, mostly idle', rig: rig({ fmt: 'steady' }), inp: inputs({ low: 100, mod: 60, high: 600 }) },
  { name: 'tempo at the band ceiling', rig: rig({ fmt: 'tempo' }), inp: inputs({ felt: '7' }) },
  { name: 'a format that never progresses', rig: rig({ fmt: 'custom' }), inp: inputs() },
  { name: 'free run', rig: rig({ fmt: 'free' }), inp: inputs() },
];

describe('the Adapt panel explains what conAdapt actually did', () => {
  for (const c of CASES) {
    it(`agrees with the engine on ${c.name}`, () => {
      const rec = resultFor(c.rig, c.inp);
      const out = conAdapt(rec, settingsWith(c.rig, c.inp));
      const gates = gatesFor(c.rig, c.inp, rec);
      const allPass = gates.every((g) => g.pass);
      expect(allPass).toBe(out.delta === 1);
    });
  }

  it('names a reason for every failure it reports', () => {
    for (const c of CASES) {
      const gates = gatesFor(c.rig, c.inp, resultFor(c.rig, c.inp));
      for (const g of gates.filter((g) => !g.pass)) {
        expect(g.detail.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('the rig drives the engine rather than reimplementing it', () => {
  it('writes the level where conProgLevel reads it', () => {
    // If settingsFor used any other key, every level slider in the lab would
    // move nothing and the Progression table would be 21 identical rows.
    const s = settingsFor(rig({ level: 7 }));
    expect(s.conProgress?.['intervals:row']).toEqual({ level: 7, miss: 0 });
    expect(prescriptionFor(rig({ level: 7 }))).toMatchObject({ level: 7 });
  });

  it('builds a WhoopSample todayRecovery can actually read', () => {
    // `recovery` instead of `recoveryScore` reads back as null, so a low-recovery
    // rig would silently stop easing the session.
    expect(whoopFor(rig({ rec: 25 }))).toEqual({ recoveryScore: 25 });
    const eased = prescriptionFor(rig({ rec: 25 }));
    expect(eased.dailyAdj).toBe(-1);
    expect(prescriptionFor(rig({ rec: null })).dailyAdj).toBe(0);
  });

  it('grows the session as the level rises, for every progressed format', () => {
    for (const fmt of ['steady', 'intervals', 'tempo'] as CondFmtKey[]) {
      const lo = totalSeconds(phasesFor(rig({ fmt, level: 0 })));
      const hi = totalSeconds(phasesFor(rig({ fmt, level: 12 })));
      expect(hi).toBeGreaterThan(lo);
    }
  });

  it('leaves unprogressed formats flat however high the level goes', () => {
    for (const fmt of ['custom', 'free'] as CondFmtKey[]) {
      const lo = totalSeconds(phasesFor(rig({ fmt, level: 0 })));
      const hi = totalSeconds(phasesFor(rig({ fmt, level: 20 })));
      expect(hi).toBe(lo);
    }
  });
});
