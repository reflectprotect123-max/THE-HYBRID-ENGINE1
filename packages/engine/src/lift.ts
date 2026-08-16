import { AUTOREG, RECOVERY_BANDS } from './constants';
import { isWarmup, loadKgOf, loadPctOf, rpeCenterOf } from './autoreg';
import { anchorForOpener, foldFromExercise, foldNextOpener, incrementFor, plannedKg, targetRepsOf } from './fold';
import type { PlanTarget } from './fold';
import { recoveryBand, todayRecovery } from './hr';
import { roundToIncrement, saneKg } from './num';
import { blockExercises, exBest, exLogFor, isLiftMode, isWarmupBlock } from './session';
import { calibrationStateFor } from './adaptive/exposures';
import type { AnySet, Block, Exercise, LiftState, LoggedSet, Session, Settings, WhoopSample } from './types';

/*
 * Strength progression ACROSS sessions.
 *
 * The logger has always autoregulated within a session: rate a set, and the
 * next set's weight moves. On the LAST set of a movement it printed the same
 * sentence — "+2.5 kg for next session (102.5 kg)" — and then dropped the
 * number, because the only place it wrote to was `sets[si + 1]`, which does not
 * exist there. Next week the prefill read back what was actually lifted and
 * offered it again. The app said it was progressing you and did not.
 *
 * This module is that sentence, kept. It computes NOTHING new:
 * `foldNextOpener` is the whole model — the same plan-anchored walk that
 * prices sets in-session (golden-tested through `foldExercise`), applied to
 * the opener the athlete chose. What is added is persistence, and a daily
 * recovery gate on the way back out.
 *
 * It deliberately mirrors `conditioning.ts`, which has run this shape for
 * months: `conAdapt` banks an earned level from performance alone, and
 * `conPrescription` applies the recovery gate at the point of prescribing.
 * Keeping the same split here means a red morning eases what you are offered
 * today WITHOUT costing you the weight you earned — see `nextWorkingWeight`.
 */

/** The last completed working set of a movement — what the next weight is judged on. */
function lastWorkingSet(ex: { sets: LoggedSet[] }): LoggedSet | null {
  for (let i = ex.sets.length - 1; i >= 0; i--) {
    const st = ex.sets[i];
    // A warm-up at RPE 4 would say "add weight" and a heavy single warm-up
    // would say "take it off". Neither reads working effort — the same guard
    // the in-session adjustment already applies.
    if (st && st.done && !isWarmup(st) && saneKg(st.aVal) > 0) return st;
  }
  return null;
}

/**
 * The set `foldNextOpener` anchors on: the FIRST working set of the movement.
 *
 * `readExercise` inside the fold drops warm-ups and then walks the remaining
 * sets in order, stopping at the first one that is not a completed, rated,
 * repped set — so `logs[0]`, the opener the fold prices next session off, is
 * always this set. Reading it the same way here is what keeps `from` and `to`
 * two answers to the same question.
 */
function openingWorkingSet(ex: { sets: LoggedSet[] }): LoggedSet | null {
  for (const st of ex.sets) if (st && !isWarmup(st)) return st;
  return null;
}

export interface LiftMove {
  /** the movement's name as written, for display */
  name: string;
  /** lowercased, the `liftProgress` key */
  key: string;
  /**
   * the weight this session OPENED the movement at — the set `to` is priced
   * off, so the two are comparable and `delta` means something
   */
  from: number;
  /** what it becomes next session */
  to: number;
  /** `to − from`; 0 means hold */
  delta: number;
  /** the same plain-language verdict the logger prints after the set */
  verdict: string;
  /** the reps of that same opening set */
  reps: number;
  /**
   * the e1RM this opener implies, so `liftAdapt` can bank it alongside the
   * kilo. Null when there is nothing to price against — a bodyweight move.
   */
  e1rm: number | null;
}

/**
 * What each lifted movement in a finished session earned for next time.
 *
 * Exported because the recap lists these, and if the recap derived them
 * separately the two could disagree — the number shown would stop being the
 * number stored. One traversal, one answer.
 *
 * A movement with no completed working set produces NOTHING: skipping a lift,
 * or logging only warm-ups, means nothing was earned.
 */
export function liftMoves(s: Session | null | undefined): LiftMove[] {
  if (!s) return [];
  const out: LiftMove[] = [];

  const seen = new Set<string>();
  s.blocks.forEach((b) => {
    // THE important guard. Without it, warming bench up with an empty bar at
    // RPE 3 teaches the progression that your working weight is 20kg, and the
    // next session offers it back to you.
    if (isWarmupBlock(b)) return;
    blockExercises<LoggedSet>(b).forEach((ex) => {
      if (!isLiftMode(ex.mode)) return;
      const name = String(ex.name || '').trim();
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return; // one move per movement — the FIRST
      // (working) occurrence wins; a back-off/burnout block written after the
      // main lift must not overwrite the working weight it earned.

      const st = lastWorkingSet(ex);
      if (!st) return;

      const lastReps = parseInt(String(st.aVal2), 10) || 0;
      // Reps are what make it a set — exLogFor/sessionVolume/epley all require
      // reps > 0. Progression used not to, so a 0-rep AMRAP (aVal2 unwritten)
      // read reps 0 and moved the working weight UP.
      if (!(lastReps > 0)) return;
      seen.add(key);
      // `felt` is what the athlete RATED the set at; `rpe` is what was asked
      // for. Judging a set against its own target would score everything as
      // perfect and the weight would never move.
      const felt = parseFloat(String(st.felt));
      if (!Number.isFinite(felt)) return;

      const next = foldNextOpener(ex, incrementFor(ex));
      if (!next) return;

      // WHICH set these numbers describe, and why it is not the one guarded
      // above. The guards decide WHETHER anything was earned, and they read the
      // last working set for that — a movement is only finished when its last
      // set is a real, rated, repped set. What is REPORTED is a different
      // question: `to` answers "what should this movement open at next time",
      // priced by `foldNextOpener` off THIS session's opener. So `from` must be
      // that same opener, and `reps` its reps.
      //
      // On a flat exercise the two sets coincide. On a ramp they do not, and
      // reading `from` off the last set produced 120 → 100 labelled "hold —
      // open here again": a −20kg delta between two numbers that were never
      // answers to the same question.
      const open = openingWorkingSet(ex);
      if (!open) return;
      const from = saneKg(open.aVal);
      const reps = parseInt(String(open.aVal2), 10) || 0;
      const e1rm = anchorForOpener(ex);
      out.push({ name, key, from, to: next.kg, delta: Math.round((next.kg - from) * 100) / 100, verdict: next.message, reps, e1rm });
    });
  });

  return out;
}

/**
 * Bank each lifted movement's next working weight from a finished session.
 *
 * Returns a WHOLE replacement map rather than mutating, so callers write it in
 * one assignment inside their existing `update()` — exactly how `conAdapt`
 * returns `conProgress`.
 */
export function liftAdapt(
  s: Session | null | undefined,
  settings: Settings = {},
): { liftProgress: Record<string, LiftState> } {
  const out: Record<string, LiftState> = Object.assign({}, settings.liftProgress);
  if (!s) return { liftProgress: out };

  const at = s.completedAt || Date.now();

  liftMoves(s).forEach((m) => {
    // A session finished out of order — an old one closed late, or restored
    // from a backup — must not overwrite something more recent. The stored
    // `at` is the authority here and in `mergeSettings`.
    const prev = out[m.key];
    if (prev && prev.at > at) return;
    out[m.key] = { kg: m.to, at, reps: m.reps, ...(m.e1rm != null && { e1rm: m.e1rm }) };
  });

  return { liftProgress: out };
}

/**
 * A load target authored as a percentage of e1RM, resolved into kilos.
 *
 * THE PRECEDENCE RULE, which is the whole reason this exists. There are two
 * ways a load can be decided — a percentage somebody wrote for this set, and
 * the absolute weight the athlete earned in `liftProgress` — and two sources of
 * truth for one number is exactly how the logger's hint and its box came to
 * disagree. So:
 *
 *   1. What happened TODAY wins. `openingLoadFor` asks the fold first, and the
 *      fold reads this session's own logged sets: a percentage is a plan, a set
 *      you already did is a fact. Autoregulation keeps working inside a
 *      %-authored exercise exactly as it does anywhere else.
 *   2. Failing that, an authored percentage beats the earned weight. Somebody
 *      wrote it for THIS set; `liftProgress` is what the app inferred. It is
 *      the same precedence the rep target in `t` already has — what you did
 *      last time never overrides the reps you were asked for, and load is not
 *      a special case.
 *   3. Failing that — no percentage, or nothing to resolve one against — the
 *      earned weight, which is today's behaviour unchanged.
 *
 * Resolved through `exBest`, the same e1RM the Progress chart and the PR
 * detector read, so a percentage cannot mean one thing here and another three
 * screens away. Returns 0 when there is no e1RM yet: a first session has
 * nothing to take a percentage OF, and guessing would put a number under a
 * barbell on no evidence at all.
 */
export function prescribedKg(name: string, t: string | undefined, sessions: Session[] = []): number {
  const pct = loadPctOf(t);
  if (pct == null) return 0;
  const best = exBest(name, sessions);
  if (!best || !(best.e1 > 0)) return 0;
  return roundToIncrement((best.e1 * pct) / 100, AUTOREG.plateIncrement);
}

export interface WorkingWeight {
  /** what to put in the box, after any daily easing */
  kg: number;
  /** the weight actually earned, before the gate — 0 easing means these match */
  earned: number;
  /** kilos removed for today's recovery; 0 when the gate did not fire */
  dailyAdj: number;
  /** plain-language reason, or '' when nothing was applied */
  note: string;
}

/**
 * What to offer for a movement today: the earned weight, eased on a red day.
 *
 * The gate lives HERE rather than in `liftAdapt` on purpose. `conAdapt` gates
 * on the recovery captured WITH the session, because it is deciding whether an
 * effort counted. This is deciding what to put on the bar right now, so it is
 * today's recovery that matters — and applying it at read time means a bad
 * night eases one session instead of permanently costing you the weight.
 *
 * It eases by one step and says why. It is not a block: the field stays
 * typeable, because the athlete standing under the bar knows things WHOOP does
 * not.
 */
export function nextWorkingWeight(
  name: string,
  settings: Settings = {},
  whoop?: WhoopSample | null,
  /**
   * Today's set-1 rep target, so a banked e1RM can be re-priced against
   * whatever the plan asks for today rather than re-offering the flat kilo a
   * DIFFERENT rep scheme earned. Optional and additive — every existing
   * caller that omits it gets exactly today's behaviour, and a record with
   * no banked `e1rm` takes the existing path regardless. See the RPE
   * progression design, stage 1.
   */
  target?: PlanTarget,
  /**
   * The athlete's session history, so a movement that has gone quiet for
   * `AUTOREG.calibrationGapDays` is not offered its full earned weight on
   * return. Optional and additive, exactly like `target` above: an omitted
   * history behaves exactly as before, and `calibrationStateFor` itself
   * returns `{ calibrating: false }` on an empty list. See the RPE
   * progression design, stage 5.
   */
  sessions?: Session[],
  /**
   * The exercise's own plate/stack granularity — `Exercise.inc` where it has
   * one, `AUTOREG.plateIncrement` otherwise, same convention as every other
   * increment parameter in this file. Only the e1RM re-pricing branch below
   * needs it: `st.kg` already arrived pre-rounded from `foldNextOpener`
   * (which always rounds), but `plannedKg` is a bare division and was
   * offering raw values like 102.43902439… kg — a number no rack has — until
   * this parameter existed. Omitted, it defaults to the global increment
   * rather than skipping rounding, so a caller that forgets it still gets a
   * real number, just not necessarily the exercise's own step.
   */
  increment?: number,
): WorkingWeight | null {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;

  const st = settings.liftProgress && settings.liftProgress[key];
  if (!st) return null;
  let earned = saneKg(st.kg);
  if (st.e1rm && st.e1rm > 0 && target && target.reps !== 'max' && target.reps > 0) {
    const priced = roundToIncrement(plannedKg(st.e1rm, target), increment || AUTOREG.plateIncrement);
    if (priced > 0) earned = priced;
  }
  if (!earned) return null;

  /*
   * CALIBRATION TAKES PRIORITY AND RETURNS EARLY, rather than layering with
   * the recovery ease below. Stacking "back after a break" with "eased for
   * low recovery" is a real combination that could happen, but the design
   * asks for one honest reduction with one honest reason, not a compounded
   * cut the athlete has to unpick two sentences to understand. If a
   * calibration session also lands on a red-recovery day, the calibration cut
   * alone already asks for meaningfully less than the earned number.
   */
  if (sessions && calibrationStateFor(name, sessions).calibrating) {
    const reduced = roundToIncrement(
      Math.max(AUTOREG.stepKg, earned * (1 - AUTOREG.calibrationReductionPct)),
      AUTOREG.plateIncrement,
    );
    return {
      kg: reduced,
      earned,
      dailyAdj: Math.round((reduced - earned) * 100) / 100,
      note: 'back after a break — offering less so today can find where you actually are',
    };
  }

  const rec = todayRecovery(whoop);
  if (rec == null || recoveryBand(rec) !== 'low') {
    return { kg: earned, earned, dailyAdj: 0, note: '' };
  }

  const eased = roundToIncrement(Math.max(AUTOREG.stepKg, earned - AUTOREG.stepKg), AUTOREG.plateIncrement);
  const dailyAdj = Math.round((eased - earned) * 100) / 100;
  return {
    kg: eased,
    earned,
    dailyAdj,
    // The threshold is named, not spelled, so this can never drift from the
    // band the rings on Home are drawn with.
    note: dailyAdj < 0 ? `eased for ${rec}% recovery` : '',
  };
}


/**
 * What a library session would open at, movement by movement.
 *
 * Goes through `nextWorkingWeight` rather than reading `liftProgress` directly,
 * so the figure the Library shows and the figure the logger prefills cannot
 * disagree — including on a red morning, when both are eased by the same step.
 *
 * Movements that have earned nothing yet are omitted, not shown as blanks: a
 * session you have never trained should say nothing rather than list its
 * exercises against empty numbers.
 */
export function sessionOpeners(
  w: { blocks: Block<AnySet>[] } | null | undefined,
  settings: Settings = {},
  whoop?: WhoopSample | null,
  /** See `nextWorkingWeight`'s own doc — passed straight through so a
   *  calibrating movement reads the same reduced number here as it does in
   *  the Logger's own prefill, per this function's own header. */
  sessions?: Session[],
): { name: string; kg: number; eased: boolean }[] {
  if (!w) return [];
  const out: { name: string; kg: number; eased: boolean }[] = [];
  const seen = new Set<string>();

  (w.blocks || []).forEach((b) =>
    blockExercises(b).forEach((ex) => {
      if (!isLiftMode(ex.mode)) return;
      const name = String(ex.name || '').trim();
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);

      const nw = nextWorkingWeight(name, settings, whoop, undefined, sessions, incrementFor(ex as Exercise<LoggedSet>));
      if (nw) out.push({ name, kg: nw.kg, eased: nw.dailyAdj < 0 });
    }),
  );

  return out;
}

/**
 * Everything a load decision needs from outside the exercise itself.
 *
 * All three are optional and each absence has a defined meaning rather than
 * being an error: no `sessions` means no history to take a percentage of, no
 * `settings` means nothing has been earned yet, no `whoop` means no recovery
 * reading to ease against. A caller that passes nothing gets the fold alone,
 * which is exactly the behaviour that existed before this function.
 */
export interface LoadContext {
  sessions?: Session[];
  settings?: Settings;
  whoop?: WhoopSample | null;
}

/**
 * WHAT TO PUT IN THE WEIGHT FIELD, for one set, in one place.
 *
 * This is the precedence rule `prescribedKg` documents, finally applied. It
 * existed as `logger.ts`'s `prefillPrimary` until 15 August 2026, when the web
 * logger it belonged to was deleted — which left `prescribedKg` and
 * `nextWorkingWeight` with no caller that put their answer in front of anybody.
 * The phone's `openDraft` asked the fold and nothing else, so every exercise
 * opened at zero and the entire banked progression was invisible to the one
 * screen an athlete actually uses. `liftAdapt` had been writing to a drawer
 * nobody opened.
 *
 * The ladder, in order, each step outranking the next for a reason:
 *
 *   1. THE FOLD, when it has something to say. It prices from this session's
 *      own logged sets, so it is the only step that knows what just happened.
 *      A set you have already done is a fact; everything below is a plan.
 *   2. AN AUTHORED PERCENTAGE. Somebody wrote it for THIS set; the earned
 *      weight is what the app inferred from the last one. Same precedence the
 *      rep target already has — what you did last time never overrides the
 *      reps you were asked for, and load is not a special case.
 *   3. THE EARNED WEIGHT, eased for today's recovery. What last session
 *      decided you should be on.
 *   4. ZERO, which is the honest answer for a movement with no history and no
 *      prescription. A guess under a barbell is worse than a blank field.
 *
 * WHY STEP 1 TESTS `kg > 0` RATHER THAN NULLNESS. `foldExercise` answers for
 * the first set of an untouched exercise too, and its answer there is
 * `{ kg: 0, message: 'bodyweight' }` — the opener is read off set 1's recorded
 * weight, which has not been entered yet. Treating any non-null fold as an
 * answer is precisely the bug this fixes: it made the fold win with a zero and
 * hid every step below it. A genuinely bodyweight movement falls through the
 * remaining steps and lands on 0 anyway, because `liftAdapt` never banks one
 * (`foldNextOpener` returns null when the opener is not positive), so nothing
 * is lost by letting it fall.
 *
 * WARM-UPS ARE THIS FUNCTION'S BUSINESS AFTER ALL. The first version of this
 * comment said they were the caller's, and that "a warm-up must never be
 * opened at the working weight — see `openDraft`, which asks only for working
 * sets". `openDraft` does no such thing: it asks about whatever `nextUp`
 * returns, and a `W`-marked set inside an ordinary lift block is in that
 * queue. The claim was written without being checked and was false for the
 * few hours it stood — a warm-up opened at the full earned weight.
 *
 * That is the contamination every other layer already guards: `liftMoves`
 * skips warm-up blocks so an empty bar at RPE 3 cannot teach the progression
 * that bench is 20kg, `readExercise` drops warm-up sets before folding, and
 * the deleted `prefillPrimary` carried a `same(x) => isWarmup(x) === warm`
 * guard for exactly this. It is enforced here now:
 *
 *   - AN AUTHORED ABSOLUTE stands. "W5 @40kg" is a coach writing forty kilos
 *     for the warm-up, derived from nothing, and honouring it is the whole
 *     point of letting them write it.
 *   - AN AUTHORED PERCENTAGE does not. It resolves against the working e1RM,
 *     so it IS a working-weight-derived number wearing a warm-up's clothes.
 *     The old prefill refused this too, in a test named for it.
 *   - THE EARNED WEIGHT does not. That is the working weight by definition.
 *
 * So a warm-up with nothing authored opens BLANK, and the athlete puts on
 * whatever they warm up with. A blank field is the honest answer; a number
 * that is three times too heavy is not.
 */
export interface OpeningLoad {
  kg: number;
  /**
   * The one line shown beside the number, and part of the contract rather than
   * decoration — the parity gate asserts on it, because a weight with no
   * reason attached is what athletes override.
   *
   * IT MUST AGREE WITH `kg`. Before this function existed the screen took its
   * number from one place and its line from another: an untouched exercise
   * showed "bodyweight", which was at least consistent with the 0 in the field,
   * and the moment the field started opening at the banked weight the two
   * would have contradicted each other on the same card. Both come from here
   * now, decided together, so they cannot drift.
   */
  message: string;
  /** Which rung answered. Exposed so a surface can style the fold's own word
   *  differently from a fallback without re-deriving which one it got. */
  source: 'fold' | 'prescribed' | 'earned' | 'none';
}

export function openingLoadFor(
  ex: { name?: string; mode?: string; inc?: number; sets: LoggedSet[] },
  si: number,
  ctx: LoadContext = {},
): OpeningLoad {
  const st = ex.sets[si];
  if (!st) return { kg: 0, message: '', source: 'none' };

  /*
   * A WARM-UP SET IS ANSWERED FIRST AND SEPARATELY, before any rung that could
   * hand it a working number. The fold answers for the next WORKING set rather
   * than for this index, so it cannot be trusted here either.
   */
  if (isWarmup(st)) {
    const authored = loadKgOf(st.t);
    return authored != null
      ? { kg: authored, message: 'your coach’s warm-up weight', source: 'prescribed' }
      : { kg: 0, message: 'warm-up — load it as you like', source: 'none' };
  }

  const folded = foldFromExercise(ex as Exercise<LoggedSet>, incrementFor(ex as Exercise<LoggedSet>));
  if (folded && folded.kg > 0) return { kg: folded.kg, message: folded.message, source: 'fold' };

  if (!isLiftMode(ex.mode)) {
    // No load axis at all. The fold's own word still stands if it had one —
    // a timed piece that somehow logged a weight is not overridden here.
    return { kg: 0, message: folded ? folded.message : '', source: folded ? 'fold' : 'none' };
  }

  const name = ex.name ?? '';

  /*
   * AN ABSOLUTE LOAD THE COACH WROTE, which outranks everything below it and
   * needs no history to resolve. `prescribedKg` cannot answer for a movement
   * with no e1RM yet — a percentage of nothing is nothing — but "100kg" means
   * a hundred kilos on the athlete's first ever session with a new coach.
   */
  const written = loadKgOf(st.t);
  if (written != null) {
    return { kg: written, message: 'as your coach wrote it', source: 'prescribed' };
  }

  const asked = prescribedKg(name, st.t, ctx.sessions ?? []);
  if (asked > 0) {
    const pct = loadPctOf(st.t);
    return { kg: asked, message: `${pct}% of your best — as written`, source: 'prescribed' };
  }

  // Today's own set-1 target, so a banked e1RM re-prices against what THIS
  // plan asks for rather than the scheme that earned it. `st` is `ex.sets[si]`
  // — this rung's reading of WHICH set that is leans on an invariant it does
  // not itself enforce, so it is spelled out here rather than assumed:
  //
  // `folded` above answers for `logs.length` (how many working sets this
  // exercise has already completed), not for `si`. This rung is only reached
  // when `folded` had nothing usable — which, given `st` already passed the
  // `isWarmup` guard, only happens when `logs.length === 0`: no working set
  // in the whole exercise is done yet. Both real callers
  // (`session-authoring`'s `nextUp`, in view.ts and draft.ts) drive `si` from
  // `firstNotDone` — the earliest incomplete set, in order — so with nothing
  // done, `si` cannot be anything but the first working set. A caller that
  // asked about a LATER set while an earlier one sat unentered would break
  // this; nothing in the codebase does.
  const earned = nextWorkingWeight(
    name,
    ctx.settings,
    ctx.whoop,
    { reps: targetRepsOf(st.t), rpe: rpeCenterOf(st) },
    ctx.sessions,
    incrementFor(ex as Exercise<LoggedSet>),
  );
  if (earned) {
    return {
      kg: earned.kg,
      // `nextWorkingWeight` composes the eased reason itself, and it is the
      // only layer that knows the recovery figure. Passed through verbatim.
      message: earned.note || 'what you earned last time',
      source: 'earned',
    };
  }

  /*
   * NOTHING TO OFFER — and two different reasons for it, which the athlete
   * needs told apart.
   *
   * Passing the fold's word through here was wrong and was live for one edit:
   * it says 'bodyweight' for any exercise whose opener is not positive, which
   * on an untouched barbell lift means "nobody has typed a weight yet", not
   * "this movement has no load". Printing that over an empty field on the
   * first ever squat is a claim the app cannot support.
   *
   * History is what separates them. A movement logged before, with reps and no
   * load, really is being trained at bodyweight — chin-ups, press-ups — and
   * should keep saying so every session. A movement never logged at all is
   * simply new.
   */
  const trained = exLogFor(name, ctx.sessions ?? []).length > 0;
  return {
    kg: 0,
    message: trained ? 'bodyweight' : 'first time on this — put something on the bar',
    source: 'none',
  };
}
