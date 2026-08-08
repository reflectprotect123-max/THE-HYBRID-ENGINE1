import {
  CON_FORMATS,
  conAdapt,
  explainConAdapt,
  liftMoves,
  progressionKey,
  type CondResult,
  type LiftState,
  type ProgressState,
  type Session,
  type Settings,
} from '@hybrid/engine';

export type ProgressionDomain = 'strength' | 'conditioning';
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

export interface StrengthProgressionProposal extends ProposalBase {
  domain: 'strength';
  before: LiftState | null;
  after: LiftState;
  key: string;
}

export interface ConditioningProgressionProposal extends ProposalBase {
  domain: 'conditioning';
  before: ProgressState;
  after: ProgressState;
  key: string;
}

export type ProgressionProposal = StrengthProgressionProposal | ConditioningProgressionProposal;

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

export function strengthProgressionProposals(
  session: Session,
  settings: Settings,
  hardSafetyReasons: string[] = [],
): StrengthProgressionProposal[] {
  const safetyReason = hardSafetyReason(hardSafetyReasons);
  const at = session.completedAt || session.updatedAt || Date.now();
  return liftMoves(session).map((move) => {
    const before = settings.liftProgress?.[move.key] ?? null;
    const after = { kg: safetyReason ? (before?.kg ?? move.from) : move.to, at, reps: move.reps };
    const direction: ProgressionDirection = safetyReason
      ? 'review'
      : move.delta > 0
        ? 'increase'
        : move.delta < 0
          ? 'decrease'
          : 'hold';
    return {
      id: `strength:${session.id}:${move.key}:${at}`,
      domain: 'strength',
      subject: move.name,
      sourceId: session.id,
      sourceAt: at,
      createdAt: Date.now(),
      direction,
      status: 'pending',
      intent: 'Set the next-session working weight without changing the completed session.',
      reason: safetyReason ?? move.verdict,
      evidence: [
        `Last working set: ${move.from} kg × ${move.reps}`,
        `Engine adjustment: ${move.delta > 0 ? '+' : ''}${move.delta} kg`,
      ],
      confidence: safetyReason ? 'low' : 'high',
      dataLimitations: safetyReason ? ['An active pain or illness constraint outranks progression.'] : [],
      ruleVersion: 'progression-proposal-v1',
      authority: 'coach-approval-required',
      before,
      after,
      key: move.key,
    };
  });
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
  if (proposal.domain === 'strength') {
    const current = settings.liftProgress?.[proposal.key] ?? null;
    return JSON.stringify(current) !== JSON.stringify(proposal.before);
  }
  const current = settings.conProgress?.[proposal.key] ?? { level: 0, miss: 0 };
  return JSON.stringify(current) !== JSON.stringify(proposal.before);
}

export function applyApprovedProposal(proposal: ProgressionProposal, settings: Settings): Settings {
  if (proposal.direction === 'review') throw new Error('Safety-review proposals cannot be applied.');
  if (proposalIsStale(proposal, settings)) throw new Error('The prescription changed after this proposal was created.');
  if (proposal.domain === 'strength') {
    return { ...settings, liftProgress: { ...settings.liftProgress, [proposal.key]: proposal.after } };
  }
  return { ...settings, conProgress: { ...settings.conProgress, [proposal.key]: proposal.after } };
}
