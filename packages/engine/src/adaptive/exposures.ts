import { AUTOREG } from '../constants';
import { saneKg } from '../num';
import { isWarmup, repFloorOf, rpeCenterOf, verdictForRpe } from '../autoreg';
import { blockExercises, isLiftMode, isWarmupBlock } from '../session';
import type { LoggedSet, Session } from '../types';

/**
 * A movement's cross-session evidence — `strengthExposuresFor` and
 * `calibrationStateFor` — lives in its own module, separate from
 * `decideStrengthProgression` in `./strength.ts`, for one reason: `lift.ts`
 * needs `calibrationStateFor` too (Stage 5 gates the athlete's actual weight
 * prefill, not just the coach-bench suggestion), and `strength.ts` imports
 * `liftMoves` FROM `lift.ts`. A file that imports from `lift.ts` cannot also
 * be imported BY `lift.ts` without a cycle. This module imports nothing from
 * `lift.ts`, so both `lift.ts` and `strength.ts` can depend on it.
 */

/**
 * Stage 3 of the RPE progression design classifies an exposure from data the
 * logger ALREADY stored — no new capture on the athlete's side.
 *
 *   successful               — met the rep floor and carries a rating
 *   successful_but_uncertain — met the rep floor with no rating logged
 *   missed                   — below the rep floor
 *
 * Two of the design's five classes are deliberately absent. `incomplete`
 * needs no code: a session with no completed working set never produces a
 * `StrengthExposure` at all (see the `if (found)` guard below), so it is
 * already "ignored entirely" by construction. `pain_blocked` is a declared
 * gap, not an oversight — nothing in `LoggedSet` records a pain flag per set
 * for a strength exercise (conditioning's `mechanicalCompletion: 'pain_stop'`
 * has no strength counterpart), so there is no stored fact to classify
 * against. Reading `whole-athlete-state`'s `pain_hold_active` would answer a
 * different question — TODAY's flag, not what a past exposure was — and
 * `@hybrid/engine` does not depend on that package. See CLAUDE.md's "Who owns
 * the week": nothing consumes `pain_hold_active` yet, so this is not a
 * regression, only an undone stage.
 */
export type ExposureClass = 'successful' | 'successful_but_uncertain' | 'missed';

export interface StrengthExposure {
  reps: number;
  /** null for a bodyweight exercise — same convention `exLogFor` already uses. */
  kg: number | null;
  missed: boolean;
  onTarget: boolean;
  /** Whether `felt` was a real number — see `ExposureClass`'s doc. */
  rated: boolean;
  exposureClass: ExposureClass;
  /**
   * The session this exposure was logged in. Kept so a caller can re-derive
   * what `lift.ts` ALREADY earned from it (see `strength.ts`'s
   * `earnedKgFrom`) rather than guessing at what the Logger's weight field is
   * showing.
   */
  source: Session;
}

/**
 * The one set inside a single exercise entry that IS the exposure — the same
 * set `lift.ts` would judge the movement on, so a suggestion can never be built
 * from a different set than the prefill was.
 *
 * `lastWorkingSet` picks the LAST completed, non-warmup set that logged a real
 * weight (`saneKg > 0`), and `liftMoves` then throws the movement away if that
 * set has no reps. Selecting on reps alone — what this used to do — diverges the
 * moment one set carries the weight and another carries the reps: 100kg × 0 reps
 * followed by blank × 8 reps earned NOTHING in `liftMoves` (a 0-rep set moves no
 * weight) while this manufactured a confident 8-rep exposure from the second
 * set, and the card then argued with its own weight field.
 *
 * The weight-less fallback is the bodyweight case, and only that: an exercise
 * where NO set logged a load has no load axis for `liftMoves` to earn on either,
 * so taking its last repped set contradicts nothing — it is what feeds the
 * double-progression rep route (`kg == null`).
 */
function exposureSetOf(sets: LoggedSet[]): LoggedSet | null {
  const working = (st: LoggedSet) => !!st && !!st.done && !isWarmup(st);
  let picked: LoggedSet | null = null;
  for (let i = sets.length - 1; i >= 0; i--) {
    const st = sets[i];
    if (working(st) && saneKg(st.aVal) > 0) {
      picked = st;
      break;
    }
  }
  if (!picked) {
    // Bodyweight: no load logged anywhere in this entry.
    for (let i = sets.length - 1; i >= 0; i--) {
      const st = sets[i];
      if (working(st) && Number(st.aVal2) > 0) {
        picked = st;
        break;
      }
    }
  }
  // `liftMoves`' guard, kept whole: reps are what make it a set. A picked set
  // with none earns nothing, so it claims no exposure — and, exactly as
  // `liftMoves` declines to add the key to `seen`, leaves the slot open for a
  // later occurrence of the movement in the same session.
  return picked && Number(picked.aVal2) > 0 ? picked : null;
}

/**
 * The exercise's last completed, non-warmup working set per session, oldest
 * first, keeping each set's own recorded target (`t`/`rpe`) alongside its
 * logged values — which `exLogFor`'s `ExerciseHistoryEntry` shape discards. A
 * separate, local scan; does not reuse or modify `exLogFor`.
 *
 * It is NOT a copy of `exLogFor`'s filtering, and deliberately diverges twice:
 *
 * 1. `completedAt != null` rather than `exLogFor`'s truthy `s.completedAt`. A
 *    session stamped at epoch 0 is a real, finished session, and dropping it
 *    would silently shorten an exposure streak.
 * 2. One exposure per session, from the FIRST occurrence of the movement that
 *    has a completed working set — `lift.ts`'s rule (`liftMoves`, the `seen`
 *    set), not `exLogFor`'s, which has no such rule because it is building a
 *    full history list rather than picking the one set that decides a
 *    progression. A back-off/burnout block written after the main lift must not
 *    overwrite what the working set earned: taking the last occurrence recorded
 *    Bench at the back-off's 70kg and corrupted the progression history.
 *
 * Which SET inside that occurrence counts is `lastWorkingSet`'s rule, not a
 * second one — see `exposureSetOf`.
 */
export function strengthExposuresFor(name: string, sessions: Session[]): StrengthExposure[] {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return [];
  const out: StrengthExposure[] = [];

  sessions
    .filter((s) => s.status !== 'active' && s.completedAt != null)
    .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0))
    .forEach((s) => {
      let found: LoggedSet | null = null;
      s.blocks.forEach((b) => {
        if (isWarmupBlock(b)) return;
        blockExercises(b).forEach((e) => {
          // First occurrence wins — but only one that actually logged a working
          // set claims the slot, exactly as `liftMoves` only adds to `seen`
          // once it has a set with reps.
          if (found) return;
          if (!isLiftMode(e.mode) || String(e.name || '').trim().toLowerCase() !== key) return;
          const st = exposureSetOf(e.sets);
          if (st) found = st;
        });
      });
      if (found) {
        const finalSet = found as LoggedSet;
        const reps = Number(finalSet.aVal2);
        const kgVal = parseFloat(String(finalSet.aVal ?? ''));
        const kg = Number.isFinite(kgVal) && kgVal > 0 ? kgVal : null;
        const floor = repFloorOf(finalSet.t);
        const missed = floor > 0 && reps < floor;
        const center = rpeCenterOf(finalSet);
        const felt = parseFloat(String(finalSet.felt ?? ''));
        const rated = Number.isFinite(felt);
        const verdict = rated ? verdictForRpe(felt, center) : null;
        const onTarget = !missed && (verdict === 'right on target' || verdict === 'a touch under target');
        const exposureClass: ExposureClass = missed ? 'missed' : rated ? 'successful' : 'successful_but_uncertain';
        out.push({ reps, kg, missed, onTarget, rated, exposureClass, source: s });
      }
    });

  return out;
}

export interface CalibrationState {
  calibrating: boolean;
  /** Present only while `calibrating` — always `'layoff_gap'` today; a
   *  distinct union member so a future second cause does not silently share
   *  this one's copy. */
  reasonCode?: 'layoff_gap';
}

/**
 * Stage 5 of the RPE progression design: a movement that has gone quiet for
 * `AUTOREG.calibrationGapDays` or more is not offered its full anchor-priced
 * weight on return — the session's purpose is to observe, not to progress.
 *
 * TWO DIFFERENT GAPS, because a layoff is not one event:
 *
 * 1. THE COMEBACK ITSELF — nothing has been logged since the gap, and the
 *    caller is asking what to offer for a session about to happen. `now`
 *    (injectable so this stays as pure as everything around it) minus the
 *    last exposure's timestamp exceeds the threshold.
 * 2. THE TWO SESSIONS AFTER IT — the design is explicit that calibration
 *    "leaves on two stable comparable exposures, not on a date". The FIRST
 *    comeback session banks a fresh `at`, so a naive "is the gap still open"
 *    check would exit calibration after just one session purely because the
 *    clock reset — exactly the date-based exit the design forbids. So this
 *    walks every exposure looking for the most recent gap that crossed the
 *    threshold, then counts on-target exposures AFTER it. Below two, still
 *    calibrating.
 *
 * A calibration exposure can never silently become the new anchor: nothing
 * here writes anywhere, and `anchorKgFor`/`earnedKgFrom` (in `./strength.ts`)
 * are untouched — this only gates what `nextWorkingWeight` OFFERS and what
 * `decideStrengthProgression` is willing to conclude from what came back.
 */
export function calibrationStateFor(
  name: string,
  sessions: Session[],
  now: number = Date.now(),
): CalibrationState {
  const exposures = strengthExposuresFor(name, sessions);
  if (!exposures.length) return { calibrating: false };

  const gapMs = AUTOREG.calibrationGapDays * 24 * 60 * 60 * 1000;
  const stamps = exposures.map((e) => e.source.completedAt || 0);

  const last = stamps[stamps.length - 1];
  if (now - last > gapMs) {
    // Nothing logged since the layoff yet — the NEXT session is the return.
    return { calibrating: true, reasonCode: 'layoff_gap' };
  }

  let gapStartsAt = -1;
  for (let i = 1; i < stamps.length; i++) {
    if (stamps[i] - stamps[i - 1] > gapMs) gapStartsAt = i;
  }
  if (gapStartsAt === -1) return { calibrating: false };

  const stableSince = exposures.slice(gapStartsAt).filter((e) => e.onTarget).length;
  return stableSince < 2 ? { calibrating: true, reasonCode: 'layoff_gap' } : { calibrating: false };
}
