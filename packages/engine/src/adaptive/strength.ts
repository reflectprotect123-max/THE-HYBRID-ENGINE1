import { AUTOREG } from '../constants';
import { roundToIncrement, saneKg } from '../num';
import { isWarmup, repFloorOf, repTopOf, rpeCenterOf, verdictForRpe } from '../autoreg';
import { liftMoves } from '../lift';
import { blockExercises, isLiftMode, isWarmupBlock } from '../session';
import type { LoggedSet, Session } from '../types';
import type { TrainingDecisionExplanation } from './types';

interface StrengthExposure {
  reps: number;
  /** null for a bodyweight exercise — same convention `exLogFor` already uses. */
  kg: number | null;
  missed: boolean;
  onTarget: boolean;
  /**
   * The session this exposure was logged in. Kept so the decision can re-derive
   * what `lift.ts` ALREADY earned from it (see `earnedKgFrom`) rather than
   * guessing at what the Logger's weight field is showing.
   */
  source: Session;
}

const MIN_EXPOSURES = 3;

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
function strengthExposuresFor(name: string, sessions: Session[]): StrengthExposure[] {
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
        const verdict = Number.isFinite(felt) ? verdictForRpe(felt, center) : null;
        const onTarget = !missed && (verdict === 'right on target' || verdict === 'a touch under target');
        out.push({ reps, kg, missed, onTarget, source: s });
      }
    });

  return out;
}

/**
 * The weight the Logger's field is ALREADY showing for this movement: whatever
 * `liftMoves` earned from that session — the exact number `liftAdapt` banks
 * into `settings.liftProgress` and `prefillPrimary` reads back through
 * `nextWorkingWeight`.
 *
 * Read from `lift.ts`, never recomputed with a second formula: a suggestion
 * that disagrees with the prefill is not a suggestion, it is two numbers
 * contradicting each other on the same card. Null when that session earned
 * nothing for the movement (an unrated set, say) — the caller then falls back
 * to what was actually lifted.
 */
function earnedKgFrom(name: string, exposure: StrengthExposure): number | null {
  const key = String(name || '').trim().toLowerCase();
  const m = liftMoves(exposure.source).find((x) => x.key === key);
  return m ? m.to : null;
}

/**
 * A new, per-exercise, cross-session decision layered atop `nextWorkingWeight`
 * — never replacing it, never writing to settings. Pure: recomputes from
 * `sessions` on every call, no persisted streak counter. See
 * docs/superpowers/specs/2026-08-02-adaptive-phase2-strength-progression-design.md.
 *
 * THE RULE THAT MAKES IT A SUGGESTION: a prescription is only ever returned
 * when it actually moves the number the athlete is already looking at. The
 * fields are not blank — `prefillSecondary` has already put `repTopOf(t)` in
 * Reps and `prefillPrimary` the earned weight in kg — so a "progression" that
 * lands at or below those is a downgrade dressed as advice. Every branch below
 * compares against what the field shows and falls through to a hold when there
 * is nothing to add.
 */
export function decideStrengthProgression(
  name: string,
  sessions: Session[],
  currentTarget: { t: string; rpe: string },
): TrainingDecisionExplanation {
  const exposures = strengthExposuresFor(name, sessions);
  if (exposures.length < MIN_EXPOSURES) {
    return {
      action: 'pause_insufficient_data',
      confidence: 'low',
      reasonCodes: ['insufficient_exposure_history'],
      note: 'Not enough logged sessions yet to suggest a change — keep training this movement as planned.',
      safetyState: 'approved',
      dataLimitations: ['insufficient_exposure_history'],
    };
  }

  const [prev, last] = exposures.slice(-2);

  if (last.onTarget && prev.onTarget) {
    const repTop = parseInt(repTopOf(currentTarget.t), 10);
    // What the Reps field ALREADY shows, via `prefillSecondary`. Null for a
    // target with no number at all ("max", ""), where the field opens empty and
    // any rep count is new information.
    const shownReps = Number.isFinite(repTop) ? repTop : null;
    // Double progression: climb the rep range before adding load. A bodyweight
    // movement has no load axis at all, so it always takes the rep route.
    const repsRoute = last.kg == null || (shownReps != null && last.reps < shownReps);

    if (repsRoute) {
      const reps = last.reps + 1;
      if (shownReps == null || reps > shownReps) {
        return {
          action: 'progress_reps',
          confidence: 'high',
          reasonCodes: ['consistently_on_target'],
          note: `On target the last 2 sessions — try ${reps} reps next time.`,
          safetyState: 'approved',
          dataLimitations: [],
          prescription: { reps },
        };
      }
      // One more rep than last time is still FEWER than the plan already asks
      // for — the field is showing the top of the range. Saying "try 9" over a
      // field reading 10 would talk the athlete down.
      return {
        action: 'hold',
        confidence: 'high',
        reasonCodes: ['already_at_rep_target'],
        note: `On target the last 2 sessions — the plan already asks for ${shownReps} reps, so go and take those before anything else moves.`,
        safetyState: 'approved',
        dataLimitations: [],
      };
    }

    const kg = last.kg as number;
    const shownKg = earnedKgFrom(name, last) ?? kg;
    const load = roundToIncrement(kg + AUTOREG.stepKg, AUTOREG.plateIncrement);
    if (load > shownKg) {
      return {
        action: 'progress_load',
        confidence: 'high',
        reasonCodes: ['consistently_on_target'],
        note: `On target the last 2 sessions — try ${load}kg next time.`,
        safetyState: 'approved',
        dataLimitations: [],
        prescription: { load },
      };
    }
    // The in-session autoregulation already banked this step or more, and the
    // weight field is showing it. Repeating the number adds nothing.
    return {
      action: 'hold',
      confidence: 'high',
      reasonCodes: ['already_at_earned_load'],
      note: `On target the last 2 sessions — the ${shownKg}kg already earned for today is the step up; take it and see.`,
      safetyState: 'approved',
      dataLimitations: [],
    };
  }

  if (last.missed && prev.missed) {
    if (last.kg == null) {
      return {
        action: 'hold',
        confidence: 'high',
        reasonCodes: ['consistently_missed'],
        note: 'Missed the last 2 sessions — this is worth a form or readiness check, not a number to change.',
        safetyState: 'approved',
        dataLimitations: ['no_load_to_deload'],
      };
    }
    const kg = last.kg;
    // A missed set has already cost weight through `foldExercise`'s walk: it
    // is scored at effective RPE 10.5 whatever the athlete rated it, the
    // back-off applies in full, and the exercise LOCKS — no later easy set
    // raises the load again. That walked-down number is what the field is
    // prefilled with, so the deload has to be measured against the EARNED
    // number and never past it: `Math.min` is what makes this a cut rather
    // than an accidental increase.
    //
    // A PROPORTION OF THE LOAD, NOT A PLATE. This subtracted a flat
    // `AUTOREG.stepKg` until 15 August 2026 — 2.5 kg off a failed 140 kg
    // squat, or 1.8%, which is close enough to nothing that the athlete
    // would simply fail it again. `deloadPct` documents where 10% comes from
    // and how well evidenced it is.
    const shownKg = earnedKgFrom(name, last) ?? kg;
    const cut = kg * (1 - AUTOREG.deloadPct);
    const load = roundToIncrement(
      // The floor is one plate, so a deload can never propose zero or a
      // negative weight — the same floor `nextWorkingWeight`'s recovery ease
      // already uses.
      Math.max(AUTOREG.stepKg, Math.min(cut, shownKg)),
      AUTOREG.plateIncrement,
    );
    if (load < shownKg) {
      return {
        action: 'deload',
        confidence: 'high',
        reasonCodes: ['consistently_missed'],
        note: `Missed the last 2 sessions — take 10% off and try ${load}kg next time.`,
        safetyState: 'approved',
        dataLimitations: [],
        prescription: { load },
      };
    }
    return {
      action: 'hold',
      confidence: 'high',
      reasonCodes: ['already_at_earned_load'],
      note: `Missed the last 2 sessions — the weight has already come down to ${shownKg}kg; hold there rather than cutting twice for the same miss.`,
      safetyState: 'approved',
      dataLimitations: [],
    };
  }

  return {
    action: 'hold',
    confidence: 'high',
    reasonCodes: ['mixed_recent_results'],
    note: 'Recent results are mixed — hold at the current target.',
    safetyState: 'approved',
    dataLimitations: [],
  };
}
