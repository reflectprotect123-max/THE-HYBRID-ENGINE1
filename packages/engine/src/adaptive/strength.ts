import { AUTOREG } from '../constants';
import { roundToIncrement, saneKg } from '../num';
import { isWarmup, repFloorOf, repTopOf, rpeCenterOf, verdictForRpe } from '../autoreg';
import { liftMoves } from '../lift';
import { blockExercises, isLiftMode, isWarmupBlock } from '../session';
import type { LoggedSet, Session } from '../types';
import type { TrainingDecisionExplanation } from './types';

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
type ExposureClass = 'successful' | 'successful_but_uncertain' | 'missed';

interface StrengthExposure {
  reps: number;
  /** null for a bodyweight exercise — same convention `exLogFor` already uses. */
  kg: number | null;
  missed: boolean;
  onTarget: boolean;
  /** Whether `felt` was a real number — see `ExposureClass`'s doc. */
  rated: boolean;
  exposureClass: ExposureClass;
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
        const rated = Number.isFinite(felt);
        const verdict = rated ? verdictForRpe(felt, center) : null;
        const onTarget = !missed && (verdict === 'right on target' || verdict === 'a touch under target');
        const exposureClass: ExposureClass = missed ? 'missed' : rated ? 'successful' : 'successful_but_uncertain';
        out.push({ reps, kg, missed, onTarget, rated, exposureClass, source: s });
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
 * The most recent load the athlete actually SUCCEEDED at — the anchor a deload
 * is measured from.
 *
 * The review the owner commissioned on 16 August 2026 is explicit that a
 * reduction must not compound with the within-session correction: a session
 * that opened at 100 kg and was walked down to 94 kg by a missed set is still
 * anchored at 100. Taking the percentage off 94 charges the athlete twice for
 * one miss.
 *
 * Null when no on-target exposure is on record, which is a real state and not
 * a zero: the caller holds rather than falling back to the missed weight,
 * because that fallback IS the compound this exists to avoid.
 */
function anchorKgFor(exposures: StrengthExposure[]): number | null {
  for (let i = exposures.length - 1; i >= 0; i--) {
    const e = exposures[i];
    if (e.onTarget && e.kg != null && e.kg > 0) return e.kg;
  }
  return null;
}

/**
 * STAGE 4 OF THE RPE PROGRESSION DESIGN, NAMED RATHER THAN NEWLY BUILT.
 *
 * The review asks for three load numbers kept separate so a bad session can
 * never silently compound: `session_opening_load`, `effective_load`, and
 * `last_successful_anchor_load`. All three already exist as three different
 * reads over the same exposure list, and Example C below is the proof they
 * do not collapse into one:
 *
 *   openingLoad         — `exposure.kg`, what the set was actually loaded at.
 *   effectiveLoad        — `earnedKgFrom(name, exposure)`, what `lift.ts`'s
 *                          within-session fold walked the movement down (or
 *                          up) to by the end of that same session.
 *   lastSuccessfulAnchor — `anchorKgFor(exposures)`, the most recent exposure
 *                          that was actually on target — which is why a
 *                          deload is cut from 100, not from the 94 a missed
 *                          set already walked down to.
 *
 * No storage migration was needed: each is a fresh read over `sessions` on
 * every call (`decideStrengthProgression` is stateless — see the tests by
 * that name), so a bad session's 94 can never quietly become tomorrow's 100.
 * That was true before this stage; this comment is the stage.
 */

/**
 * The smallest load step this movement can actually take, in kg.
 *
 * `Exercise.inc` where the exercise declares one — a dumbbell rack moves in 2,
 * a stack in whatever the stack says — and the global plate pair otherwise.
 * Read off the exposure's own session so the rounding matches the equipment
 * the athlete was really using, rather than assuming a barbell.
 */
function incrementFor(name: string, exposure: StrengthExposure): number {
  const key = String(name || '').trim().toLowerCase();
  let inc = 0;
  exposure.source.blocks.forEach((b) => {
    blockExercises(b).forEach((e) => {
      if (inc) return;
      if (String(e.name || '').trim().toLowerCase() !== key) return;
      if (Number.isFinite(e.inc) && (e.inc as number) > 0) inc = e.inc as number;
    });
  });
  return inc;
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
    /*
     * THE COACH'S SYNTAX IS READ AS INTENT. A single written number —
     * `repTopOf(t) === String(repFloorOf(t))` — is an INSTRUCTION: the coach
     * asked for exactly that many reps, and this engine prices load only. A
     * range ("8-12") is an INVITATION to climb inside it before adding load.
     * The check below does not need to run that comparison explicitly: an
     * instruction's `shownReps` already equals the floor, so `last.reps` can
     * never be less than it once a set is `onTarget` (missed floor ⇒ not
     * onTarget) — the rep route falls through to the load route by
     * construction. A WAVE — 10, then 8, then 6 — is a sequence of
     * instructions, and this is why the engine never proposes an eleventh rep
     * on the 10.
     */
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
    /*
     * A PERCENTAGE OF WHAT WAS LIFTED, ROUNDED TO WHAT THE GYM CAN EXPRESS.
     *
     * `kg + AUTOREG.stepKg` until 16 August 2026 — a flat 2.5 kg, which is 10%
     * at 25 kg and 1.4% at 180 kg. The review the owner commissioned is blunt
     * about that: a global fixed step "silently assigns an aggressive
     * progression to light exercises and a conservative progression to heavy
     * ones". See `AUTOREG.progressPct`.
     *
     * `increment` is the exercise's own plate/stack granularity where it has
     * one (`Exercise.inc`) and the global plate pair otherwise, so the target
     * is rounded to a weight that exists on the rack rather than to a number.
     */
    const increment = incrementFor(name, last) || AUTOREG.plateIncrement;
    const target = kg * (1 + AUTOREG.progressPct);
    /*
     * CEIL, NOT ROUND — "the smallest available jump that REACHES the desired
     * target without exceeding the exercise cap". Rounding to nearest sends a
     * 25 kg lift's 25.625 kg target back to 25 kg, which is not a progression
     * at all: it silently proposes the weight the athlete already lifted and
     * the cap below never gets a chance to speak.
     */
    const load = Math.ceil((target - 1e-9) / increment) * increment;
    /*
     * OVER THE CAP, HOLD THE LOAD AND PROGRESS REPS. The review's own worked
     * example: 25 kg, target 0.625 kg, smallest available jump 2.5 kg, which
     * is 10% — "the correct result is not 27.5 kg disguised as a 2.5%
     * progression. The engine holds 25 kg, advances the repetition or
     * RPE-quality target within the planned range, and records that equipment
     * resolution prevented the target load change."
     */
    if (load > shownKg && (load - kg) / kg > AUTOREG.maxJumpPct) {
      const reps = last.reps + 1;
      return {
        action: 'progress_reps',
        confidence: 'medium',
        reasonCodes: ['consistently_on_target', 'equipment_resolution_limits_load'],
        note: `On target the last 2 sessions, but the smallest jump here is ${Math.round(((load - kg) / kg) * 1000) / 10}% — too big a step. Hold ${kg}kg and try ${reps} reps instead.`,
        safetyState: 'approved',
        dataLimitations: ['equipment_resolution_limits_load'],
        prescription: { reps },
      };
    }
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
    // would simply fail it again.
    //
    // AND IT IS CUT FROM THE LAST SUCCESSFUL ANCHOR, NOT FROM THE MISS.
    // This took its percentage off `last.kg` — the weight logged on the
    // FAILED session, which the within-session fold has already walked down —
    // so the athlete paid twice for one miss. The review the owner
    // commissioned names the case exactly:
    //
    //   "The session opens at 100 kg. The athlete misses, and the
    //   within-session rule corrects the effective load to 94 kg. If repeated
    //   comparable misses later trigger a 5% reactive reduction, the next
    //   opening load is calculated from the last successful anchor, 100 kg,
    //   producing 95 kg before equipment rounding. It is not calculated from
    //   94 kg unless the product explicitly chooses a compounded policy and
    //   displays it."
    //
    // We do not want the compound, so the anchor is the most recent exposure
    // that was actually ON TARGET. With no such exposure on record there is no
    // anchor to cut from, and falling back to the missed weight would
    // reintroduce the compound — so the engine holds and says why.
    const shownKg = earnedKgFrom(name, last) ?? kg;
    const anchor = anchorKgFor(exposures);
    if (anchor == null) {
      return {
        action: 'hold',
        confidence: 'low',
        reasonCodes: ['consistently_missed', 'no_successful_anchor'],
        note: `Missed the last 2 sessions, and there is no on-target session on record to measure a cut from. Hold at ${shownKg}kg and get one clean session before changing the number.`,
        safetyState: 'approved',
        dataLimitations: ['no_successful_anchor'],
      };
    }
    const cut = anchor * (1 - AUTOREG.deloadPct);
    const load = roundToIncrement(
      // The floor is one plate, so a deload can never propose zero or a
      // negative weight — the same floor `nextWorkingWeight`'s recovery ease
      // already uses.
      //
      // NO `Math.min(cut, shownKg)` HERE ANY MORE. That clamp existed to stop
      // an "increase" while the cut was measured off the missed weight, and it
      // defeats the anchor rule outright: 5% off a 100 kg anchor is 95 kg, and
      // clamping it to the 94 kg the fold walked down to gives back exactly
      // the compound this change removes. The next session OPENING above the
      // weight a within-session correction reached is correct — the walk-down
      // was a correction inside one session, not a new baseline.
      Math.max(AUTOREG.stepKg, cut),
      incrementFor(name, last) || AUTOREG.plateIncrement,
    );
    if (load !== shownKg) {
      return {
        action: 'deload',
        confidence: 'high',
        reasonCodes: ['consistently_missed'],
        note: `Missed the last 2 sessions — ${Math.round(AUTOREG.deloadPct * 100)}% off your last good ${anchor}kg, so try ${load}kg next time.`,
        safetyState: 'approved',
        dataLimitations: [],
        prescription: { load },
      };
    }
    return {
      action: 'hold',
      confidence: 'high',
      reasonCodes: ['already_at_earned_load'],
      note: `Missed the last 2 sessions — ${Math.round(AUTOREG.deloadPct * 100)}% off your last good ${anchor}kg lands exactly where the weight already is, so hold at ${shownKg}kg.`,
      safetyState: 'approved',
      dataLimitations: [],
    };
  }

  // Stage 3: an unrated exposure is not "mixed" — it is evidence the athlete
  // never finished giving. It still COUNTS (this is why `exposureClass` runs
  // over every exposure and not just the two-in-a-row gate above), but it
  // lowers confidence rather than being silently absorbed into the generic
  // hold every other undecided case falls into.
  if (!last.rated || !prev.rated) {
    return {
      action: 'hold',
      confidence: 'low',
      reasonCodes: ['exposure_not_rated'],
      note: 'One of the last 2 sessions has no RPE rating logged for this movement — rate your sets so this can move again.',
      safetyState: 'approved',
      dataLimitations: ['exposure_not_rated'],
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
