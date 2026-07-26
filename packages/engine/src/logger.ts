import { isWarmup } from './autoreg';
import { blockExercises, exLogFor, isCond, isLiftMode } from './session';
import type { Exercise, LoggedSet, Session } from './types';

/*
 * The guided set flow, as logic.
 *
 * The stage shows one set at a time; these functions decide which set that is,
 * where the flow goes after a confirm, and what to prefill. They are here
 * rather than in the UI because every one of them is a rule about training,
 * not about rendering — and because the React app and the React Native app must
 * agree on all of them exactly.
 */

/** Index of the first unfinished set, or -1 when the exercise is done. */
export function curSetIndex(ex: Exercise<LoggedSet>): number {
  return ex.sets.findIndex((st) => !st.done);
}

export function exFinished(ex: Exercise<LoggedSet>): boolean {
  return ex.sets.length > 0 && ex.sets.every((st) => st.done);
}

export interface LogLoc {
  bi: number;
  ei: number;
}

export interface NamedLoc extends LogLoc {
  name: string;
}

/**
 * Where "next exercise" points.
 *
 * It never points at the CURRENT location: the full-screen footer would
 * re-enter the exercise you are already on, and re-entering resets the stage —
 * silently discarding an RPE already dialled in.
 */
export function nextLoggerLocation(s: Session, bi: number, ei: number): NamedLoc | null {
  const flat: NamedLoc[] = [];
  s.blocks.forEach((b, bj) => {
    if (isCond(b)) return;
    blockExercises(b).forEach((e, ej) => {
      if (e.mode !== 'completion' && !exFinished(e)) flat.push({ bi: bj, ei: ej, name: e.name || 'Exercise' });
    });
  });
  if (!flat.length) return null;
  const rest = flat.filter((x) => x.bi !== bi || x.ei !== ei);
  if (!rest.length) return null;
  return rest.find((x) => x.bi > bi || (x.bi === bi && x.ei > ei)) || rest[0];
}

/**
 * The letter shown on each exercise. A superset block shares one letter across
 * its pair — A1, A2 — which is the whole visual point: they are one unit.
 * Conditioning gets a heart instead of a letter.
 */
export function sessionLetters(s: Session): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  let li = 0;
  s.blocks.forEach((b, bi) => {
    if (isCond(b)) {
      out[bi] = ['♥'];
      return;
    }
    if (b.superset) {
      const L = String.fromCharCode(65 + li++);
      out[bi] = blockExercises(b).map((_, ei) => L + (ei + 1));
    } else {
      out[bi] = blockExercises(b).map(() => String.fromCharCode(65 + li++));
    }
  });
  return out;
}

/** The target line on the stage: "5 @8", "max @9", "W10". */
export function targetLine(ex: Exercise<LoggedSet>, st: LoggedSet): string {
  if (ex.mode === 'amrap') return 'max' + (st.rpe ? ' @' + st.rpe : '');
  const t = st.t === 'max' ? 'max' : st.t || '—';
  return t + (st.rpe ? ' @' + st.rpe : '');
}

/**
 * What to put in the primary field before the athlete types.
 *
 * ONLY prefills from a set of the same kind. Carrying a 40kg warm-up into the
 * first working set — or a working weight back into a warm-up — is the same
 * contamination the isWarmup guards exist to prevent, just arriving through the
 * prefill instead of through the maths.
 */
export function prefillPrimary(ex: Exercise<LoggedSet>, si: number, sessions: Session[] = []): string {
  const st = ex.sets[si];
  if (!st) return '';
  if (st.aVal) return st.aVal;

  const warm = isWarmup(st);
  const same = (x: LoggedSet | undefined) => !!x && isWarmup(x) === warm;

  for (let i = si - 1; i >= 0; i--) {
    const p = ex.sets[i];
    if (p.aVal && same(p)) return p.aVal;
  }

  if (isLiftMode(ex.mode)) {
    const hist = exLogFor(ex.name, sessions);
    const last = hist[hist.length - 1];
    if (last) {
      // History stores only completed working sets, so anything found here is
      // already a like-for-like comparison.
      const at = last.sets[si];
      if (at && at.kg) return String(at.kg);
      const ls = last.sets.find((x) => x && x.kg);
      if (ls) return String(ls.kg);
    }
    return '';
  }

  return st.t && st.t !== 'max' ? st.t : '';
}

/** Reps field prefill: the planned target, unless it is a range or 'max'. */
export function prefillSecondary(ex: Exercise<LoggedSet>, si: number): string {
  const st = ex.sets[si];
  if (!st) return '';
  if (st.aVal2) return st.aVal2;
  const t = String(st.t || '');
  if (!t || t === 'max') return '';
  const m = t.match(/\d+/);
  return m ? m[0] : '';
}

/** Completed sets across a whole session, for the top-of-stage progress bar. */
export function sessionProgress(s: Session): { done: number; total: number; pct: number } {
  let done = 0;
  let total = 0;
  s.blocks.forEach((b) => {
    if (isCond(b)) {
      total += 1;
      if (b.condResult) done += 1;
      return;
    }
    blockExercises(b).forEach((e) => {
      total += e.sets.length;
      done += e.sets.filter((st) => st.done).length;
    });
  });
  return { done, total, pct: total ? Math.round((100 * done) / total) : 0 };
}

/**
 * Where the flow goes after a confirmed set, and whether rest sits in between.
 *
 * Inside a superset pair the flow moves A→B with NO rest, because that is what
 * makes it a superset. Rest is taken once the pair is complete.
 */
export function advanceAfterSet(
  s: Session,
  bi: number,
  ei: number,
): { next: LogLoc | null; restSec: number } {
  const b = s.blocks[bi];
  if (!b || isCond(b)) return { next: null, restSec: 0 };
  const exs = blockExercises(b);
  const ex = exs[ei];
  if (!ex) return { next: null, restSec: 0 };

  if (b.superset) {
    for (let j = ei + 1; j < exs.length; j++) {
      if (!exFinished(exs[j])) return { next: { bi, ei: j }, restSec: 0 };
    }
    for (let j = 0; j < exs.length; j++) {
      if (!exFinished(exs[j])) return { next: { bi, ei: j }, restSec: Number(ex.rest) || 0 };
    }
    return { next: null, restSec: 0 };
  }

  if (!exFinished(ex)) return { next: { bi, ei }, restSec: Number(ex.rest) || 0 };
  return { next: null, restSec: 0 };
}
