import { CON_EFFORTS, type Block, type CondBlock } from '@hybrid/engine';
import type { StateConstraint } from '@hybrid/whole-athlete-state';
import type {
  AutoCoachResolution,
  ResolutionOperation,
  ResolveInput,
  SignalLine,
} from './types';

/**
 * The Auto-Coached session resolver: applies the athlete-state's OWN
 * constraint advice to one session, inside the athlete's policy. Pure and
 * deterministic — same versioned inputs, same output.
 *
 * Stage order (each stage only narrows what later stages may do):
 *   signals → hard-safety gate → constraint eligibility → policy bounds → resolve
 *
 * Structural guarantees, tested rather than asserted:
 *  - a hard constraint (pain hold, illness) always produces safety_stop,
 *    regardless of readiness score or any wearable value — wearables enter
 *    readiness only upstream, so they CANNOT outrank a safety flag here;
 *  - missing data lowers confidence and never widens autonomy;
 *  - the coach-authored workout object is never mutated;
 *  - the resolver abstains (with a reason) rather than inventing semantics
 *    the schema does not carry.
 */

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

const isCond = (b: Block): b is CondBlock => b.kind === 'conditioning';

function signalLines(input: ResolveInput): SignalLine[] {
  const { readiness, dataQuality, illness } = input.state;
  const lines: SignalLine[] = [];
  lines.push({
    text:
      readiness.band === 'unknown'
        ? 'Readiness unknown — no usable signals today'
        : `Readiness ${readiness.band}${readiness.score != null ? ` (${readiness.score})` : ''}`,
    quality: readiness.band === 'unknown' ? 'unknown' : 'known',
  });
  lines.push({
    text: `Data quality ${dataQuality}`,
    quality: dataQuality === 'missing' ? 'unknown' : 'known',
  });
  if (illness.status !== 'clear')
    lines.push({ text: `Illness flag: ${illness.status} (${illness.source})`, quality: 'known' });
  for (const r of readiness.rationale.slice(0, 3)) lines.push({ text: r, quality: 'known' });
  return lines;
}

export function resolveSession(input: ResolveInput): AutoCoachResolution {
  const { workout, policy, state } = input;
  const signals = signalLines(input);
  const resolved = clone(workout);
  const base = {
    schemaVersion: 1 as const,
    originalWorkoutId: workout.id,
    resolvedWorkout: resolved,
    signals,
  };

  if (policy.status !== 'active') {
    return {
      ...base,
      state: 'normal',
      operations: [],
      inferences: ['Auto-Coached is paused — nothing is evaluated or applied.'],
      reasonCodes: ['policy_paused'],
      confidence: 'high',
      requiresConfirmation: false,
      autoApplyAllowed: false,
      athleteMessage: 'Auto-Coached is paused. Today runs exactly as planned.',
      abstentionReason: 'policy_not_active',
    };
  }

  /* -- stage: hard safety, before anything readiness-shaped --------------- */
  const domainOf = workout.kind ?? 'strength';
  const applies = (c: StateConstraint): boolean => c.domain === 'both' || c.domain === domainOf;
  const hard = state.constraints.filter((c) => c.hard && applies(c));
  if (hard.length > 0) {
    return {
      ...base,
      state: 'safety_stop',
      operations: hard.map((c) => ({
        type: 'rest_or_pause' as const,
        targetPath: '',
        before: 'planned session',
        after: 'stop or limit the affected work',
        reasonCode: c.code,
        materiality: 'high' as const,
        reversible: true as const,
      })),
      inferences: hard.map((c) => `${c.reason} → ${c.adjustment}`),
      reasonCodes: hard.map((c) => c.code),
      confidence: 'high',
      requiresConfirmation: true,
      autoApplyAllowed: false,
      athleteMessage:
        'A safety flag is active. This cannot be resolved as a readiness question — the session is ' +
        'not being adapted as normal training. Review the flag with your coach, and if a symptom is ' +
        'severe, new, or worsening, contact an appropriate qualified professional.',
    };
  }

  /* -- stage: constraint eligibility, inside policy ------------------------ */
  const soft = state.constraints.filter((c) => !c.hard && applies(c));
  const has = (code: string) => soft.some((c) => c.code === code);
  const constraintText = (code: string) => {
    const c = soft.find((x) => x.code === code);
    return c ? `${c.reason} → ${c.adjustment}` : '';
  };

  const operations: ResolutionOperation[] = [];
  const inferences: string[] = [];
  const reasonCodes: string[] = [];

  if (has('low_readiness') && policy.permissions.cap_intensity !== 'off') {
    resolved.blocks.forEach((b, bi) => {
      if (isCond(b)) {
        if (b.effort === 'hard') {
          operations.push({
            type: 'cap_intensity',
            targetPath: `blocks[${bi}]`,
            before: 'effort hard',
            after: 'effort medium',
            reasonCode: 'low_readiness',
            materiality: 'low',
            reversible: true,
          });
          b.effort = 'medium';
          b.targetZone = CON_EFFORTS.medium.zone;
        }
      } else if (b.exercises && !b.warmup) {
        b.exercises.forEach((ex, xi) => {
          let capped = false;
          ex.sets.forEach((s) => {
            const rpe = parseFloat(String(s.rpe));
            if (Number.isFinite(rpe) && rpe > policy.rpeCap) {
              s.rpe = String(policy.rpeCap);
              capped = true;
            }
          });
          if (capped)
            operations.push({
              type: 'cap_intensity',
              targetPath: `blocks[${bi}].exercises[${xi}]`,
              before: `${ex.name} above @${policy.rpeCap}`,
              after: `${ex.name} capped @${policy.rpeCap}`,
              reasonCode: 'low_readiness',
              materiality: 'low',
              reversible: true,
            });
        });
      }
    });
    if (operations.length) {
      inferences.push(constraintText('low_readiness'));
      reasonCodes.push('low_readiness');
    }
  }

  if (has('time_limited') && policy.permissions.trim_conditioning_minutes !== 'off') {
    resolved.blocks.forEach((b, bi) => {
      if (!isCond(b)) return;
      const mins = parseFloat(String(b.minutes));
      if (!Number.isFinite(mins) || mins <= 0) return;
      const next = Math.max(Math.round(mins * policy.minConditioningFraction), 10);
      if (next < mins) {
        operations.push({
          type: 'trim_conditioning_minutes',
          targetPath: `blocks[${bi}]`,
          before: `${mins} min`,
          after: `${next} min`,
          reasonCode: 'time_limited',
          materiality: 'low',
          reversible: true,
        });
        b.minutes = next;
      }
    });
    if (operations.some((o) => o.type === 'trim_conditioning_minutes')) {
      inferences.push(constraintText('time_limited'));
      reasonCodes.push('time_limited');
    }
  }

  if (
    (has('low_readiness') || has('recovery_debt_high')) &&
    policy.permissions.hold_progression !== 'off'
  ) {
    operations.push({
      type: 'hold_progression',
      targetPath: '',
      before: 'progression eligible',
      after: 'progression held today',
      reasonCode: has('recovery_debt_high') ? 'recovery_debt_high' : 'low_readiness',
      materiality: 'trivial',
      reversible: true,
    });
    if (has('recovery_debt_high') && !reasonCodes.includes('recovery_debt_high')) {
      inferences.push(constraintText('recovery_debt_high'));
      reasonCodes.push('recovery_debt_high');
    }
  }

  const confidence =
    state.dataQuality === 'missing'
      ? 'insufficient'
      : state.dataQuality === 'limited'
        ? 'limited'
        : 'high';

  /* -- stage: outcome ------------------------------------------------------ */
  if (operations.length === 0) {
    return {
      ...base,
      state: 'normal',
      operations: [
        {
          type: 'keep_as_planned',
          targetPath: '',
          before: 'planned session',
          after: 'unchanged',
          reasonCode: 'no_material_conflict',
          materiality: 'trivial',
          reversible: true,
        },
      ],
      inferences:
        state.dataQuality === 'missing'
          ? ['No usable signals — the plan stands, with limited confidence. Unknown is not good.']
          : ['No active constraint argues for a change.'],
      reasonCodes: ['no_material_conflict'],
      confidence,
      requiresConfirmation: false,
      autoApplyAllowed: false,
      athleteMessage:
        state.dataQuality === 'missing'
          ? 'No check-in or signals today — the session runs as planned, but the system knows less than usual.'
          : 'Today runs as planned — nothing in your signals argues for a change.',
      abstentionReason: state.dataQuality === 'missing' ? 'no_signals' : undefined,
    };
  }

  /* Missing data never widens autonomy: material ops with insufficient
     confidence always require confirmation. */
  const needsAsk =
    policy.mode !== 'auto_daily' ||
    confidence !== 'high' ||
    operations.some(
      (o) =>
        (o.type === 'cap_intensity' && policy.permissions.cap_intensity !== 'auto') ||
        (o.type === 'trim_conditioning_minutes' &&
          policy.permissions.trim_conditioning_minutes !== 'auto'),
    );

  const caps = operations.filter((o) => o.type === 'cap_intensity').length;
  const trims = operations.filter((o) => o.type === 'trim_conditioning_minutes').length;
  const parts: string[] = [];
  if (caps) parts.push(`intensity capped on ${caps} item${caps === 1 ? '' : 's'}`);
  if (trims) parts.push('conditioning trimmed to fit your time');
  if (operations.some((o) => o.type === 'hold_progression')) parts.push('progression held');

  return {
    ...base,
    state: 'advisory',
    operations,
    inferences,
    reasonCodes,
    confidence,
    requiresConfirmation: needsAsk,
    autoApplyAllowed: !needsAsk,
    athleteMessage:
      `Today's session keeps its purpose with ${parts.join(', ')}. ` +
      'This affects today only — future sessions are unchanged.',
  };
}
