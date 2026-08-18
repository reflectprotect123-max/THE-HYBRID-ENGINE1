import type { Exercise } from './exercise';
import type { PrescribedSet } from './prescription';
import { resolveTarget, type ResolveCtx } from './resolve';

export interface BlockItemInput {
  exercise: Exercise;
  sets: PrescribedSet[];
}

export interface UnresolvedTarget {
  exerciseName: string;
  metricKey: string;
  reason: string;
}

export type SessionSnapshot = Record<string, Array<{ setId: string; targets: Record<string, { value: number; exact: number } | { lo: number; hi: number }> }>>;

export type PublishResult =
  | { snapshot: SessionSnapshot }
  | { blocked: UnresolvedTarget[] };

export function resolveSessionForPublish(items: BlockItemInput[], ctx: ResolveCtx): PublishResult {
  const blocked: UnresolvedTarget[] = [];
  const snapshot: SessionSnapshot = {};

  for (const { exercise, sets } of items) {
    const setEntries: any[] = [];
    for (const set of sets) {
      const targetEntries: Record<string, any> = {};
      for (const target of set.targets) {
        const resolved = resolveTarget(target, exercise, ctx);
        if (resolved.kind === 'unresolved') {
          blocked.push({ exerciseName: exercise.name, metricKey: target.metricKey, reason: resolved.reason });
          continue;
        }
        if (resolved.kind === 'scalar') {
          // resolveTarget computes both the rounded value and the unrounded
          // exact value behind it (for the long-press "exact value" UI) in
          // one pass — no second call into ctx needed here.
          targetEntries[target.metricKey] = { value: resolved.value, exact: resolved.exact };
        } else if (resolved.kind === 'range') {
          targetEntries[target.metricKey] = { lo: resolved.lo, hi: resolved.hi };
        }
        // 'deferred_to_athlete' targets are intentionally absent from the snapshot.
      }
      setEntries.push({ setId: set.id, targets: targetEntries });
    }
    snapshot[exercise.id] = setEntries;
  }

  if (blocked.length) return { blocked };
  return { snapshot };
}
