import {
  CON_MAX_POINTS,
  HRR_TOLERANCE_SEC,
  HRR_WINDOW_SEC,
  RECOVERY_BANDS,
  REZONE_PROVISIONAL,
  ZONE_NAMES,
} from './constants';
import type {
  Downsampled,
  HrContext,
  HrSample,
  Profile,
  RecoveryBand,
  WhoopSample,
  ZoneBand,
  ZoneKey,
  Zones,
} from './types';

/**
 * Max HR. Tanaka (208 − 0.7 × age) is the meta-analysis-validated formula; it
 * beats 220−age, which overestimates for the young and underestimates past 40.
 * A manually tested max is authoritative and wins outright. Otherwise the
 * estimate is auto-raised by any corroborated observed beat — what Morpheus
 * does — so an athlete who is genuinely above the curve gets correct zones.
 */
export function conMaxHr(profile?: Profile): number {
  const p = profile || {};
  const age = parseInt(String(p.age ?? ''), 10) || 30;
  const manual = parseInt(String(p.maxHr ?? ''), 10) || 0;
  if (manual > 0) return manual;
  const est = Math.round(208 - 0.7 * age);
  const obs = parseInt(String(p.obsMaxHr ?? ''), 10) || 0;
  return Math.max(est, obs);
}

/** Resting HR: manual override, else WHOOP's measured value, else null. */
export function restingHr(profile?: Profile, whoop?: WhoopSample | null): number | null {
  const p = profile || {};
  const manual = parseInt(String(p.restingHr ?? ''), 10) || 0;
  if (manual > 0) return manual;
  const w = whoop ? parseInt(String(whoop.restingHr ?? ''), 10) || 0 : 0;
  return w > 0 ? w : null;
}

/**
 * Band a recovery score.
 *
 * The null/''/undefined cases are guarded explicitly because Number(null) is 0,
 * which is finite — a missing score would otherwise read as "low recovery" and
 * tell the athlete to pull back purely because WHOOP hadn't synced yet.
 */
export function recoveryBand(v: unknown): RecoveryBand | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.max(0, Math.min(100, Math.round(n)));
  return r >= RECOVERY_BANDS.good ? 'good' : r >= RECOVERY_BANDS.watch ? 'watch' : 'low';
}

/** Today's recovery as a rounded number, or null. Single accessor by design. */
export function todayRecovery(whoop?: WhoopSample | null): number | null {
  const n = whoop ? Number(whoop.recoveryScore) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Today's strain on WHOOP's 0–21 scale, to one decimal, or null. */
export function todayStrain(whoop?: WhoopSample | null): number | null {
  const n = whoop ? Number(whoop.strain) : NaN;
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/** Today's HRV in milliseconds, or null. */
export function todayHrv(whoop?: WhoopSample | null): number | null {
  const n = whoop ? Number(whoop.hrvMs) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Last night's sleep performance, 0–100, or null. */
export function todaySleepPerformance(whoop?: WhoopSample | null): number | null {
  const n = whoop ? Number(whoop.sleepPerformance) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * The three-band zone model.
 *
 * Karvonen/HRR is used whenever a resting HR is known and plausible, because
 * percentage-of-max ignores the athlete's own floor and misplaces the easy
 * band badly for anyone well trained. Without a resting HR it falls back to
 * percentage of max.
 *
 * Today's recovery then shifts the two ceilings by REZONE_PROVISIONAL — a red
 * day widens Recovery and pulls Overload down; a green day does the reverse,
 * more modestly. The final clamps guarantee the bands stay ordered and
 * non-degenerate even with absurd inputs.
 */
export function conZones(ctx: HrContext = {}): Zones {
  const m = conMaxHr(ctx.profile);
  const rest = restingHr(ctx.profile, ctx.whoop);
  const rec = todayRecovery(ctx.whoop);
  const band = recoveryBand(rec);

  let dLow = 0;
  let dMod = 0;
  if (band === 'low') {
    dLow = REZONE_PROVISIONAL.lowOnRed;
    dMod = REZONE_PROVISIONAL.modOnRed;
  } else if (band === 'good') {
    dLow = REZONE_PROVISIONAL.lowOnGreen;
    dMod = REZONE_PROVISIONAL.modOnGreen;
  }

  let floor: number;
  let lowTop: number;
  let modTop: number;
  let method: 'hrr' | 'pctmax';

  if (rest && rest > 0 && rest < m - 20) {
    const R = m - rest;
    method = 'hrr';
    floor = Math.round(rest + R * 0.3);
    lowTop = Math.round(rest + R * (0.6 + dLow));
    modTop = Math.round(rest + R * (0.85 + dMod));
  } else {
    method = 'pctmax';
    floor = Math.round(m * 0.5);
    lowTop = Math.round(m * (0.7 + dLow));
    modTop = Math.round(m * (0.88 + dMod));
  }

  lowTop = Math.max(floor + 4, Math.min(lowTop, m - 6));
  modTop = Math.max(lowTop + 4, Math.min(modTop, m - 2));

  const list: [ZoneBand, ZoneBand, ZoneBand] = [
    { key: 'low', name: ZONE_NAMES.low, lo: floor, hi: lowTop },
    { key: 'mod', name: ZONE_NAMES.mod, lo: lowTop, hi: modTop },
    { key: 'high', name: ZONE_NAMES.high, lo: modTop, hi: m },
  ];

  return { floor, max: m, rest: rest || null, rec, adj: dMod, method, list };
}

/** Which band a beat falls in. Boundaries are exclusive upward. */
export function conZoneOf(bpm: number, z: Zones): ZoneBand {
  return bpm < z.list[0].hi ? z.list[0] : bpm < z.list[1].hi ? z.list[1] : z.list[2];
}

export function zoneKeyOf(bpm: number, z: Zones): ZoneKey {
  return conZoneOf(bpm, z).key;
}

/**
 * Heart-rate recovery: how far the beat dropped in the minute after the
 * session's peak. Searches outward from the ideal index so a single dropped
 * sample doesn't void the measurement, and returns the window actually used
 * so the UI can be honest about it.
 */
export function conHrr(ds: Downsampled | null | undefined): { hrr: number | null; win: number | null } {
  const pts = (ds && ds.pts) || [];
  const every = (ds && ds.every) || 2;

  let peakI = -1;
  pts.forEach((b, i) => {
    if (b != null && (peakI < 0 || b > (pts[peakI] as number))) peakI = i;
  });
  if (peakI < 0) return { hrr: null, win: null };

  const want = peakI + Math.round(HRR_WINDOW_SEC / every);
  const tol = Math.max(1, Math.round(HRR_TOLERANCE_SEC / every));

  let bestI = -1;
  for (let d = 0; d <= tol; d++) {
    if (want - d > peakI && pts[want - d] != null) {
      bestI = want - d;
      break;
    }
    if (want + d < pts.length && pts[want + d] != null) {
      bestI = want + d;
      break;
    }
  }
  if (bestI < 0) return { hrr: null, win: null };

  return { hrr: Math.max(0, (pts[peakI] as number) - (pts[bestI] as number)), win: (bestI - peakI) * every };
}

/**
 * Compress a session's samples to a storable trace.
 *
 * The bin WIDENS to fit rather than the index being clamped. The clamped
 * version fixed the bin at 2s, so on a session past ~90 minutes every later
 * sample folded into the final bin — real data loss, silently. The trace now
 * always spans the whole session.
 */
export function conDownsample(samples: HrSample[], dur: number): Downsampled {
  const every = Math.max(2, Math.ceil(Math.max(0, dur) / (CON_MAX_POINTS - 1)));
  const n = Math.max(1, Math.min(Math.ceil(dur / every) + 1, CON_MAX_POINTS));
  const sum = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  samples.forEach((s) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor(s.t / every)));
    sum[i] += s.bpm;
    cnt[i] += 1;
  });
  return { every, pts: sum.map((v, i) => (cnt[i] ? Math.round(v / cnt[i]) : null)) };
}

/**
 * Seconds banked per zone across a trace.
 *
 * Every recorded beat is banked, including one under the floor — `conZoneOf`
 * puts those in Recovery, which is what warm-up and cool-down time is. Dropping
 * them would shrink the denominator `conAdapt` divides by and hand out levels
 * for sessions that did not earn them.
 */
export function zoneSeconds(ds: Downsampled, z: Zones): Record<ZoneKey, number> {
  const out: Record<ZoneKey, number> = { low: 0, mod: 0, high: 0 };
  ds.pts.forEach((b) => {
    if (b == null) return;
    out[zoneKeyOf(b, z)] += ds.every;
  });
  return out;
}

/** The five %HRmax bands coaches prescribe against. */
export type HrMaxBand = 'z1' | 'z2' | 'z3' | 'z4' | 'z5';

/**
 * Seconds banked in each %HRmax band across a trace.
 *
 * DISPLAY ONLY, and deliberately separate from `zoneSeconds`. The three-zone
 * model above is what `conAdapt` divides by and what every prescription is
 * written in; this is coach-facing context for where a week's load actually
 * went. Nothing may read it as an instruction.
 *
 * Two rules differ from `zoneSeconds`, both on purpose:
 *
 *  - A beat under 50% of max is DROPPED, not banked. `zoneSeconds` banks
 *    sub-floor beats into Recovery because its total is a denominator;
 *    nothing divides by this one, and folding warm-up and rest drift into Z1
 *    would report easy time the athlete never spent there.
 *  - An absent trace returns zeroes rather than throwing. A session with no
 *    heart-rate recorded is unknown, not zero — the caller states that, and
 *    excludes such sessions rather than charting them flat.
 */
export function hrMaxBandSeconds(
  ds: Downsampled | null | undefined,
  maxHr: number,
): Record<HrMaxBand, number> {
  const out: Record<HrMaxBand, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  if (!ds || !Array.isArray(ds.pts) || !Number.isFinite(maxHr) || maxHr <= 0) return out;
  ds.pts.forEach((b) => {
    if (b == null || !Number.isFinite(b)) return;
    const pct = (b / maxHr) * 100;
    if (pct < 50) return;
    const band: HrMaxBand = pct < 60 ? 'z1' : pct < 70 ? 'z2' : pct < 80 ? 'z3' : pct < 90 ? 'z4' : 'z5';
    out[band] += ds.every;
  });
  return out;
}
