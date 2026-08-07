import { sanitizeSharedCore, type IllnessStatus, type WhoopDailyRecord } from '@hybrid/shared-core';
import type {
  AthleteStateInput,
  AthleteStateSnapshot,
  CapacityBand,
  ReadinessBand,
  NutritionContext,
  ReadinessSignal,
  RecentTrainingSummary,
  RecoveryDebtEstimate,
  StateConstraint,
  TrainingFact,
} from './types';
import { WHOLE_ATHLETE_STATE_SCHEMA_VERSION } from './types';

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

const band = (score: number | null): ReadinessBand =>
  score == null ? 'unknown' : score >= 70 ? 'high' : score >= 45 ? 'moderate' : 'low';

const capacity = (score: number | null): CapacityBand => {
  if (score == null) return 'unknown';
  return score >= 70 ? 'high' : score >= 45 ? 'moderate' : 'low';
};

const quality = (n: number): 'good' | 'partial' | 'limited' | 'missing' =>
  n >= 4 ? 'good' : n >= 2 ? 'partial' : n === 1 ? 'limited' : 'missing';

const latest = <T extends { date: string; recordedAt?: number }>(values: T[], today: string): T | undefined =>
  values
    .filter((x) => x.date === today)
    .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))[0];

const latestWhoop = (values: WhoopDailyRecord[], today: string) =>
  values.filter((x) => x.date === today).sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')))[0];

/** Convert completed-session facts from an app store into the small summary
 * consumed by the state model. The state package intentionally does not know
 * the engine's Session shape. */
export function summarizeTrainingFacts(facts: TrainingFact[], now = Date.now()): RecentTrainingSummary {
  const sevenDays = facts.filter((x) => now - x.completedAt >= 0 && now - x.completedAt <= 7 * 86_400_000);
  const seventyTwoHours = facts.filter((x) => now - x.completedAt >= 0 && now - x.completedAt <= 72 * 3_600_000);
  return {
    sessionsLast7d: sevenDays.length,
    hardSessionsLast7d: sevenDays.filter((x) => x.hard).length,
    strengthSessionsLast7d: sevenDays.filter((x) => x.domain === 'strength').length,
    conditioningSessionsLast7d: sevenDays.filter((x) => x.domain === 'conditioning').length,
    lowerBodyHardSessionsLast72h: seventyTwoHours.filter((x) => x.lowerBodyHard).length,
  };
}

function readinessSignals(input: AthleteStateInput): { signals: ReadinessSignal[]; rationale: string[] } {
  const core = sanitizeSharedCore(input.core);
  const manual = latest(core.recovery, input.today);
  const life = core.lifeLoad.filter((x) => x.date === input.today).sort((a, b) => a.id.localeCompare(b.id)).at(-1);
  const whoop = latestWhoop(core.whoopDaily, input.today);
  const signals: ReadinessSignal[] = [];
  const rationale: string[] = [];

  // WHOOP recovery and sleep are useful wellness observations, but are not
  // treated as diagnoses and do not participate in pain/injury gating.
  if (whoop?.recoveryScore != null) signals.push({ name: 'recovery score', source: 'whoop', value: clamp(whoop.recoveryScore) });
  if (whoop?.sleepPerformance != null) signals.push({ name: 'sleep performance', source: 'whoop', value: clamp(whoop.sleepPerformance) });
  if (manual?.sleepHours != null) signals.push({ name: 'sleep duration', source: 'manual', value: clamp(50 + (manual.sleepHours - 7) * 12) });
  if (manual?.sleepQuality != null) signals.push({ name: 'sleep quality', source: 'manual', value: clamp(manual.sleepQuality * 10) });
  if (manual?.energy != null) signals.push({ name: 'energy', source: 'manual', value: clamp(manual.energy * 10) });
  if (manual?.soreness != null) signals.push({ name: 'soreness', source: 'manual', value: clamp(100 - manual.soreness * 10) });
  if (manual?.stress != null) signals.push({ name: 'reported stress', source: 'manual', value: clamp(100 - manual.stress * 10) });
  if (life?.stress != null) signals.push({ name: 'life stress', source: 'life_load', value: clamp(100 - life.stress * 10) });
  if (life?.physicalLoad != null) signals.push({ name: 'physical work load', source: 'life_load', value: clamp(100 - life.physicalLoad * 10) });

  const training = input.recentTraining;
  if (training && training.hardSessionsLast7d > 3) {
    signals.push({ name: 'recent hard-session density', source: 'training', value: clamp(100 - (training.hardSessionsLast7d - 3) * 15) });
    rationale.push('Recent hard-session density is high.');
  }
  if (manual?.sleepHours != null && manual.sleepHours < 6) rationale.push('Sleep duration is below the model baseline.');
  if (manual?.soreness != null && manual.soreness >= 7) rationale.push('Reported soreness is high.');
  if (life?.physicalLoad != null && life.physicalLoad >= 7) rationale.push('Physical work/activity is high today.');
  return { signals, rationale };
}

function debtEstimate(input: AthleteStateInput): RecoveryDebtEstimate {
  const core = sanitizeSharedCore(input.core);
  const observations = core.recovery.filter((x) => x.date <= input.today).slice(-7);
  const life = core.lifeLoad.filter((x) => x.date <= input.today).slice(-7);
  const deficits = observations.map((x) => {
    const sleep = x.sleepHours == null ? 0 : Math.max(0, 7 - x.sleepHours) * 8;
    const soreness = x.soreness == null ? 0 : x.soreness * 2;
    const stress = x.stress == null ? 0 : x.stress * 1.5;
    return sleep + soreness + stress;
  });
  const physical = life.reduce((sum, x) => sum + (x.physicalLoad == null ? 0 : x.physicalLoad * 1.5), 0);
  const training = input.recentTraining;
  const hard = training ? Math.max(0, training.hardSessionsLast7d - 2) * 8 : 0;
  const score = clamp((deficits.reduce((a, b) => a + b, 0) / Math.max(1, deficits.length)) + physical / Math.max(1, life.length) + hard);
  return {
    score: Math.round(score),
    band: score >= 60 ? 'high' : score >= 30 ? 'moderate' : 'low',
    daysObserved: observations.length,
    rationale: [
      ...(deficits.length ? ['Estimated from recent sleep, soreness and stress observations.'] : ['No recent manual recovery observations.']),
      ...(physical > 0 ? ['Physical activity is included as context, not as a medical measure.'] : []),
      ...(hard > 0 ? ['Recent hard-session density increases the estimate.'] : []),
    ],
  };
}

function illnessState(input: AthleteStateInput): { status: IllnessStatus; source: 'manual' | 'observation' | 'none' } {
  const core = sanitizeSharedCore(input.core);
  const manual = core.safety.illness;
  if (manual && manual.status !== 'clear') return { status: manual.status, source: 'manual' };
  const observation = latest(core.recovery, input.today)?.illnessStatus;
  if (observation && observation !== 'clear') return { status: observation, source: 'observation' };
  return { status: 'clear', source: 'none' };
}

function constraints(
  input: AthleteStateInput,
  score: number | null,
  debt: RecoveryDebtEstimate,
  illness: { status: IllnessStatus },
): StateConstraint[] {
  const core = sanitizeSharedCore(input.core);
  const out: StateConstraint[] = [];
  if (core.safety.painHold?.active) {
    out.push({
      code: 'pain_hold_active',
      domain: 'both',
      hard: true,
      reason: core.safety.painHold.areas.length ? `Pain hold: ${core.safety.painHold.areas.join(', ')}.` : 'Pain hold is active.',
      adjustment: 'Do not push through the flagged pain; modify or stop and reassess.',
    });
  }
  if (illness.status === 'active' || illness.status === 'suspected') {
    out.push({
      code: 'illness_flag_active',
      domain: 'both',
      hard: true,
      reason: 'A manual or observed illness flag is active.',
      adjustment: 'Avoid high-intensity training and follow the return-to-training process; this is not a diagnosis.',
    });
  }
  if (score != null && score < 45) {
    out.push({
      code: 'low_readiness',
      domain: 'both',
      hard: false,
      reason: 'The available recovery signals are in the low band.',
      adjustment: 'Cap the session around RPE 7 and reduce optional volume.',
    });
  }
  if (debt.band === 'high') {
    out.push({
      code: 'recovery_debt_high',
      domain: 'both',
      hard: false,
      reason: 'The model-estimated recovery debt is high.',
      adjustment: 'Avoid stacking another hard session; protect recovery time.',
    });
  }
  const life = core.lifeLoad.find((x) => x.date === input.today);
  if (life?.physicalLoad != null && life.physicalLoad >= 7) {
    out.push({
      code: 'physical_load_high',
      domain: 'both',
      hard: false,
      reason: 'Today includes high physical work or activity.',
      adjustment: 'Count that load before adding more total work.',
    });
  }
  const availableMinutes = input.availableMinutes ?? core.lifeLoad.find((x) => x.date === input.today)?.availableMinutes;
  if (availableMinutes != null && availableMinutes < 30) {
    out.push({
      code: 'time_limited',
      domain: 'both',
      hard: false,
      reason: 'Available training time is limited.',
      adjustment: 'Use a minimum viable session instead of treating the day as failed.',
    });
  }
  const fuelling = energyAvailabilityConstraint(input.nutrition);
  // LAST, and never first. Pain and illness are pushed at the top of this
  // function and are the only `hard: true` entries; a nutrition fact appended
  // here cannot displace, weaken or reorder them.
  if (fuelling) out.push(fuelling);
  return out;
}

/**
 * The adherence gate: below this share of the window logged, the intake number
 * is not a measurement of what the athlete ate, it is a measurement of how
 * often they opened the app. Half is deliberately generous — the nutrition
 * engine's own coverage gate wants 6 days in 7 before it will move a target —
 * because this constraint changes nothing about the athlete's food, only how
 * much is read into a training day.
 */
const MIN_LOGGING_ADHERENCE = 0.5;

/**
 * How far under estimated expenditure mean intake has to sit before it is
 * treated as context at all. A quarter is well outside the noise of a
 * self-reported log and of the engine's own estimate; smaller gaps are exactly
 * the intentional deficit of an athlete who is dieting on purpose, and firing
 * on those would put a constraint on every cut.
 */
const ENERGY_DEFICIT_FRACTION = 0.25;

/**
 * Nutrition facts read as CONTEXT, per CLAUDE.md's amended nutrition rule.
 *
 * Three properties this function is built to keep, each of them load-bearing:
 *
 *  - `hard: false`, always. A hard constraint is a safety stop, and pain and
 *    illness are the only things allowed to raise one. Underfuelling is a
 *    reason to expect less of a session, not a reason to overrule the two
 *    flags that outrank everything.
 *  - It reads no target. See `NutritionContext` — there is no target on it.
 *  - Its `adjustment` is about TRAINING, not about food. Telling the athlete
 *    what to eat here would be nutrition prescription outside
 *    `@hybrid/nutrition-engine`, which is the same wall in the other
 *    direction.
 *
 * Nothing here touches the readiness score. Feeding intake into the score
 * would make nutrition emit `low_readiness`, which auto-coach and the weekly
 * planner DO act on — nutrition would be editing training through a side door
 * while every direct path stayed closed.
 */
function energyAvailabilityConstraint(nutrition: NutritionContext | undefined): StateConstraint | null {
  if (!nutrition) return null;
  const { windowDays, loggedDays, meanIntakeKcal, estimatedExpenditureKcal } = nutrition;
  if (!(windowDays > 0)) return null;
  if (loggedDays / windowDays < MIN_LOGGING_ADHERENCE) return null;
  if (meanIntakeKcal == null || estimatedExpenditureKcal == null) return null;
  if (!(estimatedExpenditureKcal > 0)) return null;
  const deficit = estimatedExpenditureKcal - meanIntakeKcal;
  if (deficit < estimatedExpenditureKcal * ENERGY_DEFICIT_FRACTION) return null;
  return {
    code: 'low_energy_availability',
    domain: 'both',
    hard: false,
    reason:
      `Logged intake over the last ${windowDays} days averages about ${Math.round(deficit)} kcal/day ` +
      'below the estimated expenditure.',
    adjustment:
      'Expect less at the top end and treat a flat session as fuelling, not as lost fitness. ' +
      'This is context from the food log, not a nutrition instruction.',
  };
}

export function deriveAthleteState(input: AthleteStateInput): AthleteStateSnapshot {
  const core = sanitizeSharedCore(input.core);
  const { signals, rationale } = readinessSignals({ ...input, core });
  const score = signals.length ? Math.round(signals.reduce((sum, x) => sum + x.value, 0) / signals.length) : null;
  const debt = debtEstimate({ ...input, core });
  const illness = illnessState({ ...input, core });
  const constraintsOut = constraints({ ...input, core }, score, debt, illness);
  const dataQuality = quality(signals.length);
  const whoop = core.whoopDaily.find((x) => x.date === input.today);
  const physicalPenalty = core.lifeLoad.find((x) => x.date === input.today)?.physicalLoad ?? 0;
  const strengthScore = score == null ? null : clamp(score - physicalPenalty * 2);
  const conditioningScore = score == null ? null : clamp(score - physicalPenalty);
  return {
    schemaVersion: WHOLE_ATHLETE_STATE_SCHEMA_VERSION,
    asOf: input.today,
    readiness: {
      score,
      band: band(score),
      confidence: dataQuality,
      signals,
      rationale: rationale.length ? rationale : ['No dominant negative recovery signal was recorded.'],
    },
    recoveryDebt: debt,
    capacity: {
      overall: capacity(score),
      strength: capacity(strengthScore),
      conditioning: capacity(conditioningScore),
    },
    illness,
    constraints: constraintsOut,
    dataQuality,
    advisory: {
      hrvMs: whoop?.hrvMs ?? null,
      note: 'HRV is displayed as an advisory trend signal only; it never gates pain, injury or illness decisions.',
    },
  };
}

export type { RecentTrainingSummary };
