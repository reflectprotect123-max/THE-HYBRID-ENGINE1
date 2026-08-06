import { isWarmup } from './autoreg';
import { bestE1rmForMovement } from './session';
import { roundToIncrement } from './num';
import { AUTOREG } from './constants';
import type { AnySet, Exercise, Session } from './types';

/*
 * The RPE -> %1RM ramp.
 *
 * A coach authors ONE range per exercise, written onto every rated (non-
 * warm-up) set; the per-set percentage falls out of where that set's own
 * authored RPE sits between the exercise's lowest and highest rated RPE.
 * Flat (lo === hi) skips the ramp entirely.
 */

/** This set's own prescribed percentage of 1RM, or null if it carries none. */
export function pctForSet(ex: Exercise<AnySet>, si: number): number | null {
  const st = ex.sets[si];
  const pr = st && st.pct1rm;
  if (!st || !pr || isWarmup(st)) return null;
  if (pr.lo === pr.hi) return pr.hi;

  const rated = ex.sets.filter((s) => !isWarmup(s) && s.pct1rm);
  const rpes = rated.map((s) => Number(s.rpe)).filter((n) => Number.isFinite(n));
  const rpe = Number(st.rpe);
  if (!rpes.length || !Number.isFinite(rpe)) return pr.hi;

  const rpeMin = Math.min(...rpes);
  const rpeMax = Math.max(...rpes);
  if (rpeMax === rpeMin) return pr.hi;

  return pr.lo + ((rpe - rpeMin) / (rpeMax - rpeMin)) * (pr.hi - pr.lo);
}

/** A percentage, formatted for display: `65% of 1RM` -> `formatPct(65)` -> `'65%'`. */
export function formatPct(p: number): string {
  return `${Math.round(p * 10) / 10}%`;
}

/** This set's prescribed weight, rounded to a real plate increment. */
export function prescribedKgForSet(ex: Exercise<AnySet>, si: number, bestE1rm: number): number | null {
  const pct = pctForSet(ex, si);
  if (pct == null) return null;
  return roundToIncrement((pct / 100) * bestE1rm, AUTOREG.plateIncrement);
}

/** The Logger's "why this weight" sub-line for a pct1rm set, or '' if there's
 *  no logged e1RM yet to compute one from. */
export function pct1rmSourceNote(ex: Exercise<AnySet>, si: number, sessions: Session[]): string {
  const st = ex.sets[si];
  if (!st || !st.pct1rm) return '';
  const best = bestE1rmForMovement(ex.name, sessions);
  if (!best) return '';
  return `from your best e1RM · ${ex.name} ${Math.round(best.e1)}kg`;
}
