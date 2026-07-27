import { MAX_KG } from './constants';

/**
 * Epley one-rep-max estimate. Returns null rather than a number when either
 * input is missing or nonsensical — a fabricated e1RM would silently become a
 * personal record.
 */
export function epley(kg: unknown, reps: unknown): number | null {
  const k = Number(kg);
  const r = Number(reps);
  if (!(k > 0) || !(r > 0)) return null;
  return r === 1 ? k : k * (1 + r / 30);
}

/**
 * Snap a load to the nearest loadable increment, clamped into the sane range.
 *
 * The clamps are not decoration: a non-finite value used to propagate straight
 * into the next set's prescription, and `Infinity` kg is what an athlete then
 * saw on the stage.
 */
export function roundToIncrement(v: number, inc: number): number {
  if (!Number.isFinite(v)) return 0;
  if (!inc) return Math.max(0, v);
  return Math.max(0, Math.min(MAX_KG, Math.round(Math.round(v / inc) * inc * 100) / 100));
}

/** A weight we are willing to store. Anything else becomes 0. */
export function saneKg(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_KG) : 0;
}

/**
 * Keep what was typed when it is a sane number, drop it when it is not.
 * Empty stays empty — a blank field is a legitimate "did not record this",
 * which is different from a zero.
 */
export function sanNumStr(v: unknown): string {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return '';
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return '';
  return String(Math.max(0, Math.min(n, 1e6)));
}

/** One decimal place, no trailing zero: 8 → "8", 8.5 → "8.5". */
export function fmtRpe(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** Seconds as m:ss. */
export function fmtRest(s: unknown): string {
  const n = Number(s) || 0;
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}

export interface BarScale {
  /** the value the bottom of the card represents */
  floor: number;
  /** the value the top represents */
  top: number;
  /** true when the axis does NOT start at zero, so a surface can say so */
  floating: boolean;
  /** 0–100 height for a value; 0 for anything at or under the floor */
  pct(v: number): number;
}

/**
 * Where to put the bottom of a bar chart.
 *
 * A zero baseline is the honest default and it is also, for this app, useless.
 * Eight weeks of consistent training produced seven bars spanning 92%–100% of
 * the card: a wall of identical beige occupying the largest element on the
 * Progress screen while distinguishing nothing. The one question it exists to
 * answer — is volume trending up — was invisible, and the actual answer had
 * been demoted to "peak 6,548kg" in small text underneath.
 *
 * So the floor drops to just below the smallest bar, which makes real variation
 * legible. That is a truncated axis, and a truncated axis exaggerates: the
 * surface MUST say what the floor is rather than implying the shortest bar is
 * nothing. `floating` is how it knows to.
 *
 * Zero baseline is kept in the two cases where a floating one would mislead
 * rather than clarify: when everything is identical (no variation to show, and
 * a floor equal to the values divides by zero), and when a value is actually
 * zero — a week you did not train reads as an empty slot, not as a short bar.
 */
export function barScale(values: number[]): BarScale {
  const vals = (values || []).filter((v) => Number.isFinite(v));
  const max = Math.max(...vals, 1);
  const nonZero = vals.filter((v) => v > 0);
  const min = nonZero.length ? Math.min(...nonZero) : 0;
  const spread = max - min;

  // A rest week among training weeks is real signal, not noise to zoom past —
  // and with a zero in the set the distance from zero IS the information.
  const hasZero = vals.some((v) => v <= 0);
  const flat = spread <= 0 || max <= 0;
  // Below ~4% the bars genuinely are the same height; zooming in would magnify
  // rounding into a trend that is not there.
  const worthFloating = !hasZero && !flat && spread / max < 0.4 && spread / max > 0.04;

  const floor = worthFloating ? Math.max(0, min - spread * 0.35) : 0;
  const span = max - floor || 1;

  return {
    floor,
    top: max,
    floating: floor > 0,
    pct: (v) => {
      if (!Number.isFinite(v) || v <= 0) return 0;
      return Math.max(0, Math.min(100, ((v - floor) / span) * 100));
    },
  };
}

/** Seconds as h:mm:ss when it runs past an hour, else m:ss. */
export function fmtClock(s: unknown): string {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Local YYYY-MM-DD. Deliberately not toISOString — that would shift timezone. */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * "today" / "yesterday" / "4 days ago" / "3 weeks ago" from a YYYY-MM-DD.
 *
 * Here rather than in either app so both phrase it identically — the same
 * reason `fmtClock` and `fmtRpe` live in this file. Compared at local midday to
 * dodge the DST hour: at midnight a clock change flips "yesterday" to "today".
 */
export function agoLabel(date: string | null | undefined, now: Date = new Date()): string {
  const t = Date.parse(String(date || '') + 'T12:00:00');
  if (!Number.isFinite(t)) return '';
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
  const days = Math.round((ref - t) / 864e5);
  if (days < 0) return 'scheduled';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return days + ' days ago';
  const wk = Math.floor(days / 7);
  if (wk < 9) return wk + ' weeks ago';
  const mo = Math.floor(days / 30);
  return mo + (mo === 1 ? ' month ago' : ' months ago');
}

/**
 * De-duplicate, dropping holes. A legacy blob can carry `null` in a workout's
 * days/dates, and the merge that unions them runs before any sanitize on the
 * push path — so a hole kept here is written straight back to the cloud.
 */
export function uniqArr<T>(a: T[]): T[] {
  return Array.from(new Set((a || []).filter((v) => v != null)));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
