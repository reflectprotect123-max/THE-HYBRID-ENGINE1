import { isCond, isText } from './session';
import type { Session } from './types';

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

/*
 * `exFinished`/`ssGroups` were deleted whole on 17 August 2026 — both existed
 * only for exercise/superset chains, and `Block` has nothing with exercises
 * any more.
 */

/** The marker shown for each block. Conditioning gets a heart; a text block
 *  (a metcon) gets nothing — there is no per-exercise letter to assign it. */
export function sessionLetters(s: Session): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  s.blocks.forEach((b, bi) => {
    out[bi] = isCond(b) ? ['♥'] : [];
  });
  return out;
}

/** Completed work across a whole session, for the top-of-stage progress bar. */
export function sessionProgress(s: Session): { done: number; total: number; pct: number } {
  let done = 0;
  let total = 0;
  s.blocks.forEach((b) => {
    // The strength skip (a prescription-only block contributes nothing to
    // this meter) MOVED to reflectprotect123-max/strengthside on 21 August
    // 2026 with the rest of strength — `Block` has no strength member here.
    if (isCond(b)) {
      total += 1;
      if (b.condResult) done += 1;
      return;
    }
    if (isText(b)) {
      // A ticked metcon is training that happened — hasLoggedWork already
      // counts it (session.ts). Without this the meter sat at 0% with the
      // metcon done, and the finish button never turned brass.
      total += 1;
      if (b.done) done += 1;
    }
  });
  return { done, total, pct: total ? Math.round((100 * done) / total) : 0 };
}
