import { AUTOREG, RECOVERY_BANDS } from './constants';
import { isWarmup, loadPctOf } from './autoreg';
import { foldNextOpener } from './fold';
import { recoveryBand, todayRecovery } from './hr';
import { roundToIncrement, saneKg } from './num';
import { blockExercises, exBest, isLiftMode, isWarmupBlock } from './session';
import type { AnySet, Block, LiftState, LoggedSet, Session, Settings, WhoopSample } from './types';

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

      const next = foldNextOpener(ex, AUTOREG.plateIncrement);
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
      out.push({ name, key, from, to: next.kg, delta: Math.round((next.kg - from) * 100) / 100, verdict: next.message, reps });
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
    out[m.key] = { kg: m.to, at, reps: m.reps };
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
 *   1. What happened TODAY wins. `prefillPrimary` scans back to an earlier set
 *      of the same exercise first, and that scan is untouched: a percentage is
 *      a plan, a set you already did is a fact. Autoregulation keeps working
 *      inside a %-authored exercise exactly as it does anywhere else.
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
): WorkingWeight | null {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;

  const st = settings.liftProgress && settings.liftProgress[key];
  const earned = st ? saneKg(st.kg) : 0;
  if (!earned) return null;

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

/** Below this, the day is red. Re-exported so surfaces can explain the gate. */
export const LIFT_EASE_BELOW = RECOVERY_BANDS.watch;

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

      const nw = nextWorkingWeight(name, settings, whoop);
      if (nw) out.push({ name, kg: nw.kg, eased: nw.dailyAdj < 0 });
    }),
  );

  return out;
}
