import { AUTOREG } from '../constants';
import { roundToIncrement } from '../num';
import { isWarmup, repFloorOf, repTopOf, rpeCenterOf, verdictForRpe } from '../autoreg';
import { blockExercises, isLiftMode, isWarmupBlock } from '../session';
import type { LoggedSet, Session } from '../types';
import type { TrainingDecisionExplanation } from './types';

interface StrengthExposure {
  sid: string;
  completedAt: number;
  reps: number;
  /** null for a bodyweight exercise — same convention `exLogFor` already uses. */
  kg: number | null;
  missed: boolean;
  onTarget: boolean;
}

const MIN_EXPOSURES = 3;

/**
 * The exercise's last completed, non-warmup working set per session, oldest
 * first — mirrors `session.ts`'s `exLogFor` filtering exactly, but keeps each
 * set's own recorded target (`t`/`rpe`) alongside its logged values, which
 * `exLogFor`'s `ExerciseHistoryEntry` shape discards. A separate, local scan;
 * does not reuse or modify `exLogFor`.
 */
function strengthExposuresFor(name: string, sessions: Session[]): StrengthExposure[] {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return [];
  const out: StrengthExposure[] = [];

  sessions
    .filter((s) => s.status !== 'active' && s.completedAt != null)
    .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0))
    .forEach((s) => {
      let last: LoggedSet | null = null;
      s.blocks.forEach((b) => {
        if (isWarmupBlock(b)) return;
        blockExercises(b).forEach((e) => {
          if (!isLiftMode(e.mode) || String(e.name || '').trim().toLowerCase() !== key) return;
          e.sets.forEach((st) => {
            if (isWarmup(st)) return;
            if (!st.done) return;
            const reps = Number(st.aVal2);
            if (!(reps > 0)) return;
            last = st;
          });
        });
      });
      if (last) {
        const finalSet = last as LoggedSet;
        const reps = Number(finalSet.aVal2);
        const kgVal = parseFloat(String(finalSet.aVal ?? ''));
        const kg = Number.isFinite(kgVal) && kgVal > 0 ? kgVal : null;
        const floor = repFloorOf(finalSet.t);
        const missed = floor > 0 && reps < floor;
        const center = rpeCenterOf(finalSet);
        const felt = parseFloat(String(finalSet.felt ?? ''));
        const verdict = Number.isFinite(felt) ? verdictForRpe(felt, center) : null;
        const onTarget = !missed && (verdict === 'right on target' || verdict === 'a touch under target');
        out.push({ sid: s.id, completedAt: s.completedAt as number, reps, kg, missed, onTarget });
      }
    });

  return out;
}

/**
 * A new, per-exercise, cross-session decision layered atop `nextWorkingWeight`
 * — never replacing it, never writing to settings. Pure: recomputes from
 * `sessions` on every call, no persisted streak counter. See
 * docs/superpowers/specs/2026-08-02-adaptive-phase2-strength-progression-design.md.
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
    const canProgressReps = last.kg == null || (Number.isFinite(repTop) && last.reps < repTop);
    if (canProgressReps) {
      return {
        action: 'progress_reps',
        confidence: 'high',
        reasonCodes: ['consistently_on_target'],
        note: `On target the last 2 sessions — try ${last.reps + 1} reps next time.`,
        safetyState: 'approved',
        dataLimitations: [],
        prescription: { reps: last.reps + 1 },
      };
    }
    const load = roundToIncrement((last.kg as number) + AUTOREG.stepKg, AUTOREG.plateIncrement);
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
    const load = roundToIncrement(Math.max(AUTOREG.stepKg, last.kg - AUTOREG.stepKg), AUTOREG.plateIncrement);
    return {
      action: 'deload',
      confidence: 'high',
      reasonCodes: ['consistently_missed'],
      note: `Missed the last 2 sessions — try ${load}kg next time.`,
      safetyState: 'approved',
      dataLimitations: [],
      prescription: { load },
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
