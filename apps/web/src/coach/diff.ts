import type { SlimDrop, SlimPlan } from './bench-store';

/**
 * Semantic diff between the coach's last-reviewed plan and the current
 * resolution — the "what changed since you last looked" the research found
 * missing from every adaptive platform. Pure; speaks coach language;
 * compares by proposal identity, never by object internals.
 */

export interface PlanDiffLine {
  kind: 'added' | 'removed' | 'moved' | 'new-drop';
  text: string;
}

export function diffPlans(prev: SlimPlan | null, next: SlimPlan): PlanDiffLine[] {
  if (!prev || prev.weekStart !== next.weekStart) return [];
  const lines: PlanDiffLine[] = [];
  const prevById = new Map(prev.entries.map((e) => [e.proposalId, e]));
  const nextById = new Map(next.entries.map((e) => [e.proposalId, e]));

  for (const e of next.entries) {
    const was = prevById.get(e.proposalId);
    if (!was) lines.push({ kind: 'added', text: `${e.title} added on ${e.date.slice(5)}` });
    else if (was.date !== e.date)
      lines.push({ kind: 'moved', text: `${e.title} moved ${was.date.slice(5)} → ${e.date.slice(5)}` });
  }
  for (const e of prev.entries) {
    if (!nextById.has(e.proposalId))
      lines.push({ kind: 'removed', text: `${e.title} no longer scheduled` });
  }

  const prevDrops = new Set(prev.drops.map(dropKey));
  for (const d of next.drops) {
    if (!prevDrops.has(dropKey(d)))
      lines.push({ kind: 'new-drop', text: `New drop — ${d.explanation}` });
  }
  return lines;
}

const dropKey = (d: SlimDrop): string => `${d.proposalId}:${d.reasonCode}`;
