import type { SessionProposal } from '@hybrid/coordinator-adapter';

export interface ProposalInput {
  enabled: boolean;
  priority: SessionProposal['priority'];
  effort: SessionProposal['effort'];
  durationMinutes: number;
  preferredWeekdays: number[];
}

export type ProposalInputMap = Record<string, ProposalInput>;

export function defaultProposalInput(proposal: SessionProposal): ProposalInput {
  return {
    enabled: true,
    priority: proposal.priority,
    effort: proposal.effort,
    durationMinutes: proposal.durationMinutes,
    preferredWeekdays: [...(proposal.preferredWeekdays ?? [])],
  };
}

/** Apply coach-owned inputs while leaving tags, load and source provenance engine-owned. */
export function applyProposalInputs(
  proposals: SessionProposal[],
  inputs: ProposalInputMap,
): SessionProposal[] {
  return proposals.flatMap((proposal) => {
    const input = inputs[proposal.id];
    if (input?.enabled === false) return [];
    if (!input) return [proposal];
    return [{
      ...proposal,
      priority: input.priority,
      effort: input.effort,
      durationMinutes: Math.max(5, Math.min(240, Math.round(input.durationMinutes))),
      preferredWeekdays: [...new Set(input.preferredWeekdays)]
        .filter((day) => day >= 1 && day <= 7)
        .sort((a, b) => a - b),
    }];
  });
}
