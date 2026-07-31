import {
  CON_EFFORTS,
  CON_RETENTION,
  PROGRESSED_FORMATS,
  ZONE_TO_EFFORT,
} from './constants';
import { fmtRpe } from './num';
import { recoveryBand, todayRecovery } from './hr';
import type {
  CondBlock,
  CondFmtKey,
  CondResult,
  EffortKey,
  Modality,
  Phase,
  Prescription,
  ProgressState,
  Settings,
  WhoopSample,
  ZoneKey,
} from './types';

export interface FormatParams {
  minutes?: number;
  rounds?: number;
  work?: number;
  rest?: number;
}

export interface FormatDef {
  key: CondFmtKey;
  name: string;
  desc: string;
  base?: FormatParams;
  build(p?: FormatParams): Phase[];
}

const roundsFormat = (p: FormatParams): Phase[] => {
  const s: Phase[] = [{ name: 'Warm-up', dur: 180, kind: 'warm' }];
  const rounds = p.rounds ?? 8;
  for (let i = 1; i <= rounds; i++) {
    s.push({ name: 'Work ' + i, dur: p.work ?? 30, kind: 'work', round: i });
    s.push({ name: 'Recover', dur: p.rest ?? 90, kind: 'rest', round: i });
  }
  s.push({ name: 'Cool-down', dur: 120, kind: 'cool' });
  return s;
};

export const CON_FORMATS: Record<CondFmtKey, FormatDef> = {
  steady: {
    key: 'steady',
    name: 'Steady-state',
    desc: 'Zone 2 · 20 min',
    base: { minutes: 20 },
    build(p) {
      const q = p || this.base || {};
      return [
        { name: 'Warm-up', dur: 120, kind: 'warm' },
        { name: 'Zone 2', dur: (q.minutes || 20) * 60, kind: 'work2' },
        { name: 'Cool-down', dur: 120, kind: 'cool' },
      ];
    },
  },
  intervals: {
    key: 'intervals',
    name: 'Intervals',
    desc: '8×30s / 90s',
    base: { rounds: 8, work: 30, rest: 90 },
    build(p) {
      return roundsFormat(p || this.base || {});
    },
  },
  tempo: {
    key: 'tempo',
    name: 'Tempo',
    desc: '10×15s / 60s',
    base: { rounds: 10, work: 15, rest: 60 },
    build(p) {
      return roundsFormat(p || this.base || {});
    },
  },
  custom: {
    key: 'custom',
    name: 'Custom',
    desc: 'your rounds',
    build(p) {
      return roundsFormat(p || { rounds: 6, work: 40, rest: 80 });
    },
  },
  free: {
    key: 'free',
    name: 'Free run',
    desc: 'just track HR',
    build() {
      // open-ended: one long phase, you finish when you're done
      return [{ name: 'Free run', dur: 8 * 3600, kind: 'work2' }];
    },
  },
};

export const CON_FORMAT_KEYS = Object.keys(CON_FORMATS) as CondFmtKey[];

export function isProgressedFmt(k: string): k is CondFmtKey {
  return (PROGRESSED_FORMATS as string[]).includes(k);
}

/**
 * The key a conditioning progression is tracked under: just the format when the
 * block is unlabeled, `format:modality` when a modality is set. Later tasks key
 * `conProgress` by this so an athlete's interval level on the rower does not
 * bleed into their runs.
 */
export function progressionKey(fmtKey: CondFmtKey, modality?: Modality): string {
  return modality ? fmtKey + ':' + modality : fmtKey;
}

/** The athlete's own custom format, clamped to values a session can survive. */
export function customFmtBase(settings?: Settings): Required<Pick<FormatParams, 'rounds' | 'work' | 'rest'>> {
  const c = (settings && settings.customFmt) || {};
  return {
    rounds: Math.max(1, Math.min(30, parseInt(String(c.rounds ?? ''), 10) || 6)),
    work: Math.max(10, Math.min(600, parseInt(String(c.work ?? ''), 10) || 40)),
    rest: Math.max(0, Math.min(600, parseInt(String(c.rest ?? ''), 10) || 80)),
  };
}

export function conProgLevel(fmtKey: string, settings?: Settings, modality?: Modality): number {
  const cp = (settings && settings.conProgress) || {};
  const f = cp[progressionKey(fmtKey as CondFmtKey, modality)];
  return f && Number.isFinite(f.level) ? Math.max(0, f.level | 0) : 0;
}

/* ---------- effort ---------- */

/** Resolve a block's authored effort, falling back to its legacy zone. */
export function condEffort(b: Partial<CondBlock> | CondResult | null | undefined) {
  const e = b && (b as CondBlock).effort;
  if (e && Object.prototype.hasOwnProperty.call(CON_EFFORTS, e)) return CON_EFFORTS[e];
  const zone = b && ((b as CondBlock).targetZone as ZoneKey | undefined);
  if (zone && Object.prototype.hasOwnProperty.call(ZONE_TO_EFFORT, zone)) return CON_EFFORTS[ZONE_TO_EFFORT[zone]];
  return CON_EFFORTS.medium;
}

/**
 * How far a felt rating sits OUTSIDE the band it was given.
 *
 * The chip promises a range ("Medium · RPE 5-7"), so anything inside that range
 * is on target and scores 0. Judging against the centre instead meant a 7
 * against Medium — the top of its own band — read as "ran harder than medium"
 * and told Readiness to pull back tomorrow. Sign is kept: + is harder than
 * asked, − is easier.
 */
export function condEffortGap(
  e: { rpe: [number, number] } | null | undefined,
  felt: unknown,
): number | null {
  const f = parseFloat(String(felt));
  if (!e || !Number.isFinite(f)) return null;
  if (f > e.rpe[1]) return f - e.rpe[1];
  if (f < e.rpe[0]) return f - e.rpe[0];
  return 0;
}

export function condEffortRpe(e: { rpe: [number, number] }): string {
  return fmtRpe(e.rpe[0]) + '-' + fmtRpe(e.rpe[1]);
}


/* ---------- earned progression ---------- */

export interface PrescriptionCtx {
  settings?: Settings;
  whoop?: WhoopSample | null;
  ignoreDaily?: boolean;
  modality?: Modality;
}

/**
 * What today's session should actually be: the earned baseline for this format,
 * then a daily readiness gate on top.
 *
 * Levers rotate for balanced overload — +1 round, then +5s work, then −5s rest
 * — rather than one axis running away.
 *
 * Two fixed bugs are load-bearing here:
 *  - The round-drop used to be gated on `level > 0`, so a level-0 athlete on
 *    25% recovery got no deload at all. The least-adapted athlete received the
 *    least protection, which is exactly backwards.
 *  - There used to be a `rec > 80` branch that set dailyAdj = 1 and changed no
 *    numbers whatsoever, while the UI announced the session had been adjusted
 *    for strong recovery. It hadn't. There is no evidence-based basis for
 *    scaling a session UP on a good day, so we no longer claim to.
 */
export function conPrescription(fmtKey: CondFmtKey, ctx: PrescriptionCtx = {}): Prescription {
  const { settings, whoop, ignoreDaily } = ctx;
  const rec = todayRecovery(whoop);

  if (fmtKey === 'free') return { level: 0, dailyAdj: 0, rec, note: 'open-ended' };

  const fmt = CON_FORMATS[fmtKey] || CON_FORMATS.intervals;
  const base: FormatParams = fmtKey === 'custom' ? customFmtBase(settings) : fmt.base || {};
  const level = isProgressedFmt(fmtKey) ? conProgLevel(fmtKey, settings, ctx.modality) : 0;

  const p: Prescription = { level: 0, dailyAdj: 0, rec, note: '' };

  if (fmtKey === 'custom') {
    p.rounds = base.rounds;
    p.work = base.work;
    p.rest = base.rest;
    let dailyAdj = 0;
    if (rec != null && !ignoreDaily && recoveryBand(rec) === 'low') {
      dailyAdj = -1;
      if ((p.rounds ?? 0) > 3) p.rounds = (p.rounds ?? 0) - 1;
      else p.rest = (p.rest ?? 0) + 10;
    }
    p.level = 0;
    p.dailyAdj = dailyAdj;
    p.note = dailyAdj < 0 ? 'eased today' + (rec != null ? ' for ' + rec + '% recovery' : '') : 'your format';
    return p;
  }

  if (fmtKey === 'steady') {
    p.minutes = Math.min(40, (base.minutes || 20) + 2 * level);
  } else {
    let rounds = base.rounds ?? 8;
    let work = base.work ?? 30;
    let rest = base.rest ?? 90;
    for (let i = 0; i < level; i++) {
      const m = i % 3;
      if (m === 0) rounds = Math.min(12, rounds + 1);
      else if (m === 1) work = Math.min((base.work ?? 30) * 2, work + 5);
      else rest = Math.max(Math.round((base.rest ?? 90) * 0.6), rest - 5);
    }
    p.rounds = rounds;
    p.work = work;
    p.rest = rest;
  }

  let dailyAdj = 0;
  if (rec != null && !ignoreDaily && recoveryBand(rec) === 'low') {
    dailyAdj = -1;
    if (fmtKey === 'steady') p.minutes = Math.max(10, (p.minutes ?? 20) - 5);
    else if ((p.rounds ?? 0) > 3) p.rounds = (p.rounds ?? 0) - 1;
    else p.rest = (p.rest ?? 0) + 10;
  }

  p.level = level;
  p.dailyAdj = dailyAdj;
  let note = '';
  if (level > 0) note = 'Level ' + level;
  if (dailyAdj < 0) note = (note ? note + ' · ' : '') + 'eased today' + (rec != null ? ' for ' + rec + '% recovery' : '');
  p.note = note;
  return p;
}

/** Turn a prescription back into the params a format's build() wants. */
export function paramsFor(fmtKey: CondFmtKey, p: Prescription): FormatParams {
  if (fmtKey === 'steady') return { minutes: p.minutes };
  if (fmtKey === 'free') return {};
  return { rounds: p.rounds, work: p.work, rest: p.rest };
}

export interface AdaptResult {
  delta: -1 | 0 | 1;
  conProgress: Record<string, ProgressState>;
}

/**
 * Did this session earn a level?
 *
 * Pure: returns the new progression map and lets the caller persist it, so the
 * decision can be replayed and tested without a storage layer.
 *
 * The denominator is the time actually spent working, NOT the whole session.
 * Dividing banked zone-seconds by total duration — warm-up, every rest, and the
 * cool-down included — meant clearing a 45% bar required the heart rate to stay
 * elevated THROUGH the rests. The test rewarded failing to recover, which is
 * close to the opposite of adaptation.
 *
 * HRR does not gate progression. The old tolerance was 1bpm, far inside HRR's
 * day-to-day noise, so the gate fired close to randomly. Until a noise floor is
 * established from the literature, HRR is recorded and displayed and nothing
 * more.
 */
export function conAdapt(rec: CondResult | null | undefined, settings: Settings = {}): AdaptResult {
  const cp: Record<string, ProgressState> = Object.assign({}, settings.conProgress);
  const none: AdaptResult = { delta: 0, conProgress: cp };

  if (!rec || rec.sim) return none;
  const fmtKey = rec.fmt;
  if (!fmtKey || !CON_FORMATS[fmtKey] || !isProgressedFmt(fmtKey)) return none;

  const z = rec.zsec || { low: 0, mod: 0, high: 0 };
  const zoned = (z.low || 0) + (z.mod || 0) + (z.high || 0);
  // No zone time banked at all means no heart-rate data — a strapless run, not
  // a failed one. Neither earn nor deload from a session the app could not
  // measure. A run WITH data that stayed out of zone still counts as a miss.
  if (zoned <= 0) return none;
  const total = Math.max(1, zoned || rec.dur || 0);
  const workSec = fmtKey === 'steady' ? (z.low || 0) + (z.mod || 0) : (z.mod || 0) + (z.high || 0);
  const frac = fmtKey === 'steady' ? 0.6 : 0.45; // PROVISIONAL
  const onTarget = workSec / total >= frac;
  const overcooked = (z.high || 0) / total > 0.6; // PROVISIONAL
  const hrrOk = true;

  // Use the recovery captured WITH the session, not whatever WHOOP says now —
  // re-processing or a late sync used to change the verdict retroactively.
  const sessionRec = Number.isFinite(rec.rec as number) ? (rec.rec as number) : null;
  const notRed = sessionRec == null || recoveryBand(sessionRec) !== 'low';

  const progKey = progressionKey(fmtKey, rec.modality);
  const cur: ProgressState = cp[progKey] || { level: 0, miss: 0 };
  let level = cur.level | 0;
  let miss = cur.miss | 0;
  let delta: -1 | 0 | 1 = 0;

  if (onTarget && hrrOk && !overcooked && notRed) {
    level = Math.min(20, level + 1);
    miss = 0;
    delta = 1;
  } else {
    miss += 1;
    if (miss >= 2) {
      level = Math.max(0, level - 1);
      miss = 0;
      delta = -1;
    }
  }

  cp[progKey] = { level, miss };
  return { delta, conProgress: cp };
}

/** Append a finished effort to the retained history, oldest trimmed first. */
export function pushCondHistory(settings: Settings, rec: CondResult): CondResult[] {
  const list = Array.isArray(settings.conditioning) ? settings.conditioning.slice() : [];
  list.push(rec);
  list.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  return list.slice(-CON_RETENTION);
}
