import {
  CON_FORMATS,
  conAdapt,
  isProgressedFmt,
  progressionKey,
  type AdaptResult,
  type CondResult,
  type ProgressState,
  type Settings,
} from '@hybrid/engine';

/*
 * Strength progression (`strengthProgressionProposals`, `LiftState`,
 * `liftMoves`) was deleted with the strength engine — see CLAUDE.md. Only
 * conditioning progression survives here now.
 */

interface ExplainedAdapt {
  confidence: 'low' | 'medium' | 'high';
  note: string;
  dataLimitations: string[];
}

/**
 * Ported from the deleted `@hybrid/engine`'s `explainConAdapt`
 * (`packages/engine/src/adaptive/explain.ts`, removed wholesale with the
 * rest of `adaptive/` in the strength engine deletion — CLAUDE.md). This
 * function itself was always conditioning-only and pure — no `LiftState`, no
 * `Exercise` — it was collateral of the directory it lived in, not of what it
 * explained. Behavior is unchanged: same branches, same reason text, same
 * confidence and `dataLimitations` per case, just inlined here since it has
 * exactly one caller left in the whole repository.
 */
function explainConAdapt(rec: CondResult | null | undefined, result: AdaptResult): ExplainedAdapt {
  if (result.delta > 0) {
    return {
      confidence: 'high',
      note: 'Conditioning level progressed after an on-target session.',
      dataLimitations: [],
    };
  }
  if (result.delta < 0) {
    return {
      confidence: 'high',
      note: 'Conditioning level eased back after repeated missed sessions.',
      dataLimitations: [],
    };
  }
  if (!rec || rec.sim) {
    return {
      confidence: 'low',
      note: 'This session does not count toward conditioning progression.',
      dataLimitations: ['simulated_or_missing_session'],
    };
  }
  if (!rec.fmt || !isProgressedFmt(rec.fmt)) {
    return {
      confidence: 'high',
      note: 'This format does not carry earned progression.',
      dataLimitations: [],
    };
  }
  const z = rec.zsec || { low: 0, mod: 0, high: 0 };
  const zoned = (z.low || 0) + (z.mod || 0) + (z.high || 0);
  if (zoned <= 0) {
    return {
      confidence: 'low',
      note: 'No heart-rate zone data was captured, so this session neither earns nor costs progression.',
      dataLimitations: ['no_device_data'],
    };
  }
  return {
    confidence: 'medium',
    note: 'Conditioning level held at its current stage.',
    dataLimitations: [],
  };
}
export type ProgressionDomain = 'conditioning';
export type ProgressionDirection = 'increase' | 'hold' | 'decrease' | 'review';
export type ProgressionDecision = 'approved' | 'rejected' | 'held';

interface ProposalBase {
  id: string;
  domain: ProgressionDomain;
  subject: string;
  sourceId: string;
  sourceAt: number;
  createdAt: number;
  direction: ProgressionDirection;
  status: 'pending';
  intent: string;
  reason: string;
  evidence: string[];
  confidence: 'low' | 'medium' | 'high';
  dataLimitations: string[];
  ruleVersion: 'progression-proposal-v1';
  authority: 'coach-approval-required';
}

export interface ConditioningProgressionProposal extends ProposalBase {
  domain: 'conditioning';
  before: ProgressState;
  after: ProgressState;
  key: string;
}

export type ProgressionProposal = ConditioningProgressionProposal;

export interface ProgressionDecisionEvent {
  id: string;
  proposalId: string;
  decision: ProgressionDecision;
  rationale: string;
  decidedAt: number;
  actor: 'local-demo-coach';
  applied: boolean;
  note?: string;
}

function hardSafetyReason(reasons: string[]): string | null {
  return reasons.length ? `Safety review required: ${reasons.join(' ')}` : null;
}

export function conditioningProgressionProposal(
  result: CondResult,
  settings: Settings,
  hardSafetyReasons: string[] = [],
): ConditioningProgressionProposal | null {
  if (!result.fmt) return null;
  const key = progressionKey(result.fmt, result.modality);
  const before = settings.conProgress?.[key] ?? { level: 0, miss: 0 };
  const adapted = conAdapt(result, settings);
  const computedAfter = adapted.conProgress[key] ?? before;
  const painStop = result.mechanicalCompletion === 'pain_stop';
  const safetyReason = painStop
    ? 'The athlete stopped for reported pain. Progression is blocked and human review is required.'
    : hardSafetyReason(hardSafetyReasons);
  const explanation = explainConAdapt(result, adapted);
  const after = safetyReason ? before : computedAfter;
  const direction: ProgressionDirection = safetyReason
    ? 'review'
    : adapted.delta > 0
      ? 'increase'
      : adapted.delta < 0
        ? 'decrease'
        : 'hold';
  const at = result.startedAt || Date.now();
  return {
    id: `conditioning:${result.id || at}:${key}`,
    domain: 'conditioning',
    subject: `${CON_FORMATS[result.fmt]?.name ?? result.fmt}${result.modality ? ` · ${result.modality.replaceAll('_', ' ')}` : ''}`,
    sourceId: result.id || String(at),
    sourceAt: at,
    createdAt: Date.now(),
    direction,
    status: 'pending',
    intent: 'Set the next prescription level for this exact format and modality.',
    reason: safetyReason ?? explanation.note,
    evidence: [
      `Completion: ${result.mechanicalCompletion?.replaceAll('_', ' ') ?? 'unknown'}`,
      `Cardio target: ${result.cardioCompletion?.replaceAll('_', ' ') ?? 'unknown'}`,
      `Recorded effort: ${result.felt ?? 'unknown'}`,
    ],
    confidence: safetyReason ? 'low' : explanation.confidence,
    dataLimitations: safetyReason ? ['Safety input prevents an automatic training increase.'] : explanation.dataLimitations,
    ruleVersion: 'progression-proposal-v1',
    authority: 'coach-approval-required',
    before,
    after,
    key,
  };
}

export function proposalIsStale(proposal: ProgressionProposal, settings: Settings): boolean {
  const current = settings.conProgress?.[proposal.key] ?? { level: 0, miss: 0 };
  return JSON.stringify(current) !== JSON.stringify(proposal.before);
}

export function applyApprovedProposal(proposal: ProgressionProposal, settings: Settings): Settings {
  if (proposal.direction === 'review') throw new Error('Safety-review proposals cannot be applied.');
  if (proposalIsStale(proposal, settings)) throw new Error('The prescription changed after this proposal was created.');
  return { ...settings, conProgress: { ...settings.conProgress, [proposal.key]: proposal.after } };
}
