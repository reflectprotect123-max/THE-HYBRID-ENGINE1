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

export function uniqArr<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
