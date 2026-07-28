import { isWarmup, repTopOf } from './autoreg';
import { nextWorkingWeight } from './lift';
import { blockExercises, isCond, isLiftMode } from './session';
import type { AnySet, Block, Exercise, LoggedSet, Session, Settings, WhoopSample } from './types';

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
 * The exercises of a block, grouped into superset chains.
 *
 * One group per run of linked exercises; an unlinked exercise is a group of
 * one. This is the single place the two ways of saying "superset" are
 * reconciled — the legacy block flag (every exercise links to the next) and
 * the per-exercise `ssNext` — so no caller has to know both exist.
 */
export function ssGroups(b: Block<AnySet>): number[][] {
  if (isCond(b)) return [];
  const exs = blockExercises(b);
  const groups: number[][] = [];
  let cur: number[] = [];
  exs.forEach((ex, i) => {
    cur.push(i);
    // A link on the LAST exercise points at nothing and simply ends the chain,
    // which is what a half-finished edit leaves behind.
    const linked = i < exs.length - 1 && (b.superset || !!ex.ssNext);
    if (!linked) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

/** The chain containing this exercise — at minimum, itself. */
export function ssGroupOf(b: Block<AnySet>, ei: number): number[] {
  return ssGroups(b).find((g) => g.includes(ei)) || [ei];
}

/**
 * The letter shown on each exercise. A superset chain shares one letter across
 * its members — A1, A2 — which is the whole visual point: they are one unit.
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
    const letters: string[] = [];
    ssGroups(b).forEach((g) => {
      const L = String.fromCharCode(65 + li++);
      // A chain shares its letter and numbers within it; a lone exercise is
      // just "C", never "C1" — a number implies a partner that is not there.
      g.forEach((ei, k) => {
        letters[ei] = g.length > 1 ? L + (k + 1) : L;
      });
    });
    out[bi] = letters;
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
 * The last session that logged this movement, with its sets left at their
 * ORIGINAL indices — a hole for anything unlogged.
 *
 * Positional, deliberately: set 3 prefills from set 3 of last time. The
 * compacted history `exLogFor` returns has warm-ups and gaps squeezed out, so
 * reading it by index silently walks the athlete onto a heavier set.
 */
function lastTimeFor(name: string, sessions: Session[]): (LoggedSet | null)[] | null {
  // `.trim()` matters and was missing: every OTHER place that keys on a
  // movement name trims first — exLogFor, detectPRs, bestE1rmByLift, liftMoves,
  // nextWorkingWeight — so a name saved with a trailing space found its earned
  // weight and its PRs but not its own last session.
  const key = String(name || '').trim().toLowerCase();
  const done = sessions
    .filter((s) => s.status === 'completed' || s.status === 'incomplete')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  for (const s of done) {
    for (const b of s.blocks) {
      for (const e of blockExercises<LoggedSet>(b)) {
        if (String(e.name || '').toLowerCase() !== key) continue;
        const sets = e.sets.map((st) => (st.done && (st.aVal || st.aVal2) ? st : null));
        if (sets.some(Boolean)) return sets;
      }
    }
  }
  return null;
}

/** Where the earned weight comes from. Optional — omit it and nothing changes. */
export interface PrefillCtx {
  settings?: Settings;
  whoop?: WhoopSample | null;
}

/**
 * What to put in the primary field before the athlete types.
 *
 * ONLY prefills from a set of the same kind. Carrying a 40kg warm-up into the
 * first working set — or a working weight back into a warm-up — is the same
 * contamination the isWarmup guards exist to prevent, just arriving through the
 * prefill instead of through the maths.
 *
 * The order below is the whole rule, and each step outranks the next for a
 * reason: something already typed must never be overwritten by a suggestion;
 * this exercise's own earlier sets are more current than any history; the
 * EARNED weight is what the last session decided you should be on; and only
 * when nothing has been earned does it fall back to repeating last time.
 */
export function prefillPrimary(
  ex: Exercise<LoggedSet>,
  si: number,
  sessions: Session[] = [],
  ctx: PrefillCtx = {},
): string {
  const st = ex.sets[si];
  if (!st) return '';
  if (st.aVal) return st.aVal;

  const warm = isWarmup(st);
  const same = (x: LoggedSet | null | undefined) => !!x && isWarmup(x) === warm;

  for (let i = si - 1; i >= 0; i--) {
    const p = ex.sets[i];
    if (p.aVal && same(p)) return p.aVal;
  }

  if (isLiftMode(ex.mode)) {
    // Working sets only. A warm-up prefilled from the earned working weight is
    // the exact contamination the `same` guard exists to stop, and it would
    // arrive here through the front door.
    if (!warm) {
      const w = nextWorkingWeight(ex.name, ctx.settings, ctx.whoop);
      if (w) return String(w.kg);
    }

    const last = lastTimeFor(ex.name, sessions);
    if (last) {
      const at = last[si];
      if (at && at.aVal && same(at)) return at.aVal;
      const ls = last.find((x) => x && x.aVal && same(x));
      if (ls && ls.aVal) return ls.aVal;
    }
    return '';
  }

  return st.t && st.t !== 'max' ? st.t : '';
}

/**
 * Reps field prefill: what was done on an earlier set of this exercise, else
 * the top of the planned target. Reps carry forward because they are the thing
 * an athlete repeats — unlike load, they are not kind-sensitive, so a warm-up's
 * count is a fine starting point for the next set.
 */
export function prefillSecondary(ex: Exercise<LoggedSet>, si: number): string {
  const st = ex.sets[si];
  if (!st) return '';
  if (st.aVal2) return st.aVal2;
  for (let i = si - 1; i >= 0; i--) {
    const p = ex.sets[i];
    if (p && p.aVal2) return p.aVal2;
  }
  return repTopOf(st.t);
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

  const group = ssGroupOf(b, ei);
  if (group.length > 1) {
    const at = group.indexOf(ei);
    // Forward through the rest of the chain with NO rest — that is what makes
    // it a superset.
    for (let k = at + 1; k < group.length; k++) {
      if (!exFinished(exs[group[k]])) return { next: { bi, ei: group[k] }, restSec: 0 };
    }
    // Chain complete: back to its first unfinished member, and NOW rest.
    for (let k = 0; k < group.length; k++) {
      if (!exFinished(exs[group[k]])) return { next: { bi, ei: group[k] }, restSec: Number(ex.rest) || 0 };
    }
    return { next: null, restSec: 0 };
  }

  if (!exFinished(ex)) return { next: { bi, ei }, restSec: Number(ex.rest) || 0 };
  return { next: null, restSec: 0 };
}
