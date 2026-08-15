import { useMemo, useState } from 'react';
import {
  CON_EFFORTS,
  CON_EFFORT_KEYS,
  cardioCompletionFor,
  conAdapt,
  condEffort,
  condEffortGap,
  isProgressedFmt,
  recoveryBand,
} from '@hybrid/engine';
import type { CondResult, EffortKey, Settings } from '@hybrid/engine';
import { settingsFor, type Rig } from '../rig';

export interface AdaptInputs {
  low: number;
  mod: number;
  high: number;
  dur: number;
  felt: string;
  effort: EffortKey;
  rec: number | null;
  miss: number;
}

const DEFAULTS: AdaptInputs = {
  low: 120,
  mod: 420,
  high: 260,
  dur: 900,
  felt: '6',
  effort: 'medium',
  rec: 62,
  miss: 0,
};

export interface Gate {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

/**
 * The gates `conAdapt` applies, restated so a person can read them.
 *
 * This MIRRORS engine logic, which is normally the thing to avoid — a mirror
 * drifts, and a drifted explanation is worse than none because it is believed.
 * It earns its place two ways: it never feeds the verdict (the verdict comes
 * from `conAdapt` itself), and `gates.test.ts` asserts that the mirror's own
 * conclusion agrees with `conAdapt`'s `delta` across a spread of inputs. If the
 * engine's rule changes and this does not, that test fails.
 */
export function gatesFor(rig: Rig, inp: AdaptInputs, rec: CondResult): Gate[] {
  const z = rec.zsec || { low: 0, mod: 0, high: 0 };
  const zoned = (z.low || 0) + (z.mod || 0) + (z.high || 0);
  const total = Math.max(1, zoned || rec.dur || 0);
  const workSec = rig.fmt === 'steady' ? (z.low || 0) + (z.mod || 0) : (z.mod || 0) + (z.high || 0);
  const frac = rig.fmt === 'steady' ? 0.6 : 0.45;
  const zoneOnTarget = workSec / total >= frac;

  const eff = condEffort(rec);
  const gap = condEffortGap(eff, rec.felt);
  const rpeApplies = rig.fmt !== 'steady' && rec.felt != null && rec.felt !== '';
  const onTarget = rpeApplies ? (gap != null ? gap >= 0 : zoneOnTarget) : zoneOnTarget;

  const overcooked = (z.high || 0) / total > 0.6;
  const band = recoveryBand(inp.rec);
  const notRed = inp.rec == null || band !== 'low';

  return [
    {
      id: 'progressed',
      label: 'format progresses',
      pass: isProgressedFmt(rig.fmt),
      detail: isProgressedFmt(rig.fmt)
        ? `${rig.fmt} is in PROGRESSED_FORMATS`
        : `${rig.fmt} is not in PROGRESSED_FORMATS — conAdapt returns immediately`,
    },
    {
      id: 'zoned',
      label: 'heart-rate data',
      pass: zoned > 0,
      detail:
        zoned > 0
          ? `${zoned}s banked across zones`
          : 'no zone seconds at all — a strapless session. conAdapt returns without earning OR deloading',
    },
    {
      id: 'onTarget',
      label: rpeApplies ? 'effort on target (RPE)' : 'effort on target (zone time)',
      pass: onTarget,
      detail: rpeApplies
        ? `felt ${rec.felt} against ${eff.name} ${eff.rpe[0]}–${eff.rpe[1]} → gap ${gap}${gap != null && gap >= 0 ? ' (at or above the band)' : ' (under the band)'}`
        : `${workSec}s working of ${total}s counted = ${Math.round((workSec / total) * 100)}%, needs ${Math.round(frac * 100)}%`,
    },
    {
      id: 'overcooked',
      label: 'not overcooked',
      pass: !overcooked,
      detail: `${Math.round(((z.high || 0) / total) * 100)}% of counted time in the high zone, ceiling is 60%`,
    },
    {
      id: 'notRed',
      label: 'not a red day',
      pass: notRed,
      detail:
        inp.rec == null
          ? 'no recovery captured with the session — treated as not-red'
          : `${inp.rec}% is band "${band}"${notRed ? '' : ' — a level cannot be earned on a low day'}`,
    },
  ];
}

export function Adapt({ rig }: { rig: Rig }) {
  const [inp, setInp] = useState<AdaptInputs>(DEFAULTS);
  const set = <K extends keyof AdaptInputs>(k: K, v: AdaptInputs[K]) =>
    setInp((s) => ({ ...s, [k]: v }));
  const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);

  const result = useMemo<CondResult>(
    () => ({
      fmt: rig.fmt,
      modality: rig.modality,
      effort: inp.effort,
      felt: inp.felt,
      zsec: { low: inp.low, mod: inp.mod, high: inp.high },
      dur: inp.dur,
      rec: inp.rec,
      startedAt: 1,
    }),
    [rig, inp],
  );

  // `miss` is part of the state conAdapt reads, so it is a lab input: two
  // consecutive misses is what actually costs a level, and a panel that always
  // started from miss 0 could never show the second one landing.
  const settings = useMemo<Settings>(() => {
    const base = settingsFor(rig);
    const key = rig.fmt + ':' + rig.modality;
    return { ...base, conProgress: { [key]: { level: rig.level, miss: inp.miss } } } as Settings;
  }, [rig, inp.miss]);

  const out = useMemo(() => conAdapt(result, settings), [result, settings]);
  const gates = useMemo(() => gatesFor(rig, inp, result), [rig, inp, result]);
  const after = out.conProgress[rig.fmt + ':' + rig.modality] || { level: rig.level, miss: inp.miss };
  const cardio = cardioCompletionFor(rig.fmt, result.zsec, inp.dur);

  const verdict =
    out.delta === 1 ? 'Level earned' : out.delta === -1 ? 'Level lost' : 'Nothing changed';
  const cls = out.delta === 1 ? 'up' : out.delta === -1 ? 'down' : 'flat';

  return (
    <>
      <section className="panel">
        <h2>Bank a session</h2>
        <p className="hint">
          Feed <code>conAdapt</code> a finished session and watch what it does with it. The zone
          seconds are what a chest strap would have banked.
        </p>

        <div className="controls">
          <div className="field">
            <label htmlFor="a-low">Low zone (s)</label>
            <input id="a-low" type="number" min={0} value={inp.low} onChange={(e) => set('low', num(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="a-mod">Moderate zone (s)</label>
            <input id="a-mod" type="number" min={0} value={inp.mod} onChange={(e) => set('mod', num(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="a-high">High zone (s)</label>
            <input id="a-high" type="number" min={0} value={inp.high} onChange={(e) => set('high', num(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="a-dur">Session length (s)</label>
            <input id="a-dur" type="number" min={0} value={inp.dur} onChange={(e) => set('dur', num(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="a-effort">Effort asked for</label>
            <select id="a-effort" value={inp.effort} onChange={(e) => set('effort', e.target.value as EffortKey)}>
              {CON_EFFORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CON_EFFORTS[k].name} · RPE {CON_EFFORTS[k].rpe[0]}–{CON_EFFORTS[k].rpe[1]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-felt">Felt RPE (blank = not rated)</label>
            <input id="a-felt" type="text" inputMode="decimal" value={inp.felt} placeholder="—" onChange={(e) => set('felt', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="a-rec">Recovery with session</label>
            <input
              id="a-rec"
              type="number"
              min={0}
              max={100}
              value={inp.rec ?? ''}
              placeholder="—"
              onChange={(e) => {
                const raw = e.target.value.trim();
                set('rec', raw === '' ? null : Math.max(0, Math.min(100, parseInt(raw, 10) || 0)));
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="a-miss">Misses already banked</label>
            <input id="a-miss" type="number" min={0} max={1} value={inp.miss} onChange={(e) => set('miss', Math.min(1, num(e.target.value)))} />
          </div>
        </div>

        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => setInp({ ...DEFAULTS, low: 0, mod: 0, high: 0 })}>
            Strapless run
          </button>
          <button type="button" className="btn ghost" onClick={() => setInp({ ...DEFAULTS, mod: 60, high: 20, low: 820 })}>
            Too easy
          </button>
          <button type="button" className="btn ghost" onClick={() => setInp({ ...DEFAULTS, low: 40, mod: 100, high: 760, felt: '9' })}>
            Overcooked
          </button>
          <button type="button" className="btn ghost" onClick={() => setInp(DEFAULTS)}>
            Reset
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Verdict</h2>
        <p className={'verdict ' + cls}>{verdict}</p>

        <div className="readout">
          <div>
            <span className="k">level </span>
            {rig.level} → {after.level}
            <span className="k"> · misses </span>
            {inp.miss} → {after.miss}
          </div>
          <div>
            <span className="k">cardio completion </span>
            {cardio.replace('_', ' ')}
          </div>
        </div>

        <div className="chips" style={{ marginTop: 12 }}>
          {gates.map((g) => (
            <span key={g.id} className={'chip ' + (g.pass ? 'pass' : 'fail')} title={g.detail}>
              {g.pass ? '✓' : '✗'} {g.label}
            </span>
          ))}
        </div>

        <div className="scroller" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Gate</th>
                <th style={{ textAlign: 'left' }}>Why</th>
              </tr>
            </thead>
            <tbody>
              {gates.map((g) => (
                <tr key={g.id} className={g.pass ? '' : 'moved'}>
                  <td>{g.label}</td>
                  <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{g.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {inp.low + inp.mod + inp.high === 0 && (
          <p className="note">
            <strong>This is the one worth staring at.</strong> With no zone seconds,{' '}
            <code>conAdapt</code> returns before it grades anything — no level earned, no miss
            recorded. A session run without a strap is invisible to progression, however hard it
            was. That is the single biggest reason conditioning can feel like it never moves.
          </p>
        )}

        {out.delta === 0 && after.miss > inp.miss && (
          <p className="note">
            Counted as a miss, but a level costs <em>two</em>. Set &ldquo;misses already
            banked&rdquo; to 1 and run the same session again to watch the level come down.
          </p>
        )}
      </section>
    </>
  );
}
