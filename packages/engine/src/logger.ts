import { blockExercises, isCond, isText } from './session';
import type { AnySet, Block, Exercise, LoggedSet, Session } from './types';

/*
 * WHAT IS LEFT OF THE OLD GUIDED LOGGER, AND WHY.
 *
 * This file used to be the whole guided set flow: which set is current, where
 * the flow goes after a confirm, what to prefill, and how a superset chain is
 * walked. That flow belonged to the WEB logger, which is deleted — the phone's
 * round-major logger runs `@hybrid/session-authoring`'s state machine instead,
 * and takes its load rule straight from `@hybrid/engine`'s `foldExercise`.
 *
 * So `curSetIndex`, `nextLoggerLocation`, `targetLine`, `prefillPrimary`,
 * `prefillSecondary`, `advanceAfterSet`, `ssGroupOf` and the `LogLoc`/
 * `NamedLoc`/`PrefillCtx` shapes went with it (15 August 2026). Every one of
 * them had a test and no caller, which is the shape that reads as coverage and
 * is really just weight: a suite proving that deleted UI's helpers still work.
 *
 * THE ONE THING WORTH CARRYING FORWARD, because it was expensive to learn and
 * is now only in git: `prefillPrimary`'s ladder was ordered, and the order was
 * the rule. Something already typed outranks any suggestion; this exercise's
 * own earlier sets outrank history; an authored percentage outranks the earned
 * weight; and only with nothing earned does it repeat last time. If the phone's
 * logger ever grows a prefill of its own, that precedence is the thing to copy
 * — not the function.
 *
 * What remains are shape questions about a session that both apps still ask:
 * is this exercise finished, what letter does it carry, how far through are we.
 */

/** Is every set of this exercise logged? */
export function exFinished(ex: Exercise<LoggedSet>): boolean {
  return ex.sets.length > 0 && ex.sets.every((st) => st.done);
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
  // Neither conditioning nor a text block has exercises to chain.
  if (isCond(b) || isText(b)) return [];
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
    if (isText(b)) {
      // A ticked metcon is training that happened — hasLoggedWork already
      // counts it (session.ts:232-243); without this the meter sat at 0% with
      // the metcon done, and the finish button never turned brass.
      total += 1;
      if (b.done) done += 1;
      return;
    }
    blockExercises(b).forEach((e) => {
      total += e.sets.length;
      done += e.sets.filter((st) => st.done).length;
    });
  });
  return { done, total, pct: total ? Math.round((100 * done) / total) : 0 };
}
