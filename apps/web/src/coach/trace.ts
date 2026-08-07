import type { AutoCoachResolution, AutonomyPolicy, ResolutionOperation } from '@hybrid/auto-coach';
import type { AthleteStateSnapshot, StateConstraint } from '@hybrid/whole-athlete-state';

/**
 * Why today resolved the way it did — the deterministic trace behind one
 * `resolveSession` call, in the resolver's own terms.
 *
 * ResolutionPreview already shows the active constraints, and TodayAutoCoach
 * already shows the operations. What neither can answer is the question a
 * coach actually asks when the two disagree: *this constraint is active, so
 * why did nothing happen?* The resolver has four separate reasons for that,
 * and all four are currently invisible — a constraint can be filtered out by
 * session domain, suppressed by an athlete-owned permission, short-circuited
 * by a hard safety stop, or simply find nothing in the session to change.
 *
 * Pure, and derived rather than asserted: outcomes are read back off the
 * resolution the resolver already returned, never by re-running its logic.
 * The one thing this file must keep in step with `resolve.ts` is
 * ACTING_PERMISSIONS below.
 */

export type ConstraintOutcome =
  /** produced at least one operation */
  | 'applied'
  /** not this session's domain, so the resolver never considered it */
  | 'out_of_domain'
  /** every permission that could act on it is switched off */
  | 'permission_off'
  /** a hard safety flag returned before soft constraints were evaluated */
  | 'superseded_by_safety'
  /** the policy is paused or revoked — nothing was evaluated at all */
  | 'not_evaluated'
  /** v1 resolver has no action for this constraint */
  | 'no_action_defined'
  /** considered, allowed, but nothing in this session matched */
  | 'no_change';

/**
 * Which policy permissions can act on each soft constraint code. Mirrors the
 * branch conditions in `packages/auto-coach/src/resolve.ts`; a constraint
 * with no entry here is one the v1 resolver never acts on.
 */
const ACTING_PERMISSIONS: Record<string, Array<keyof AutonomyPolicy['permissions']>> = {
  low_readiness: ['cap_intensity', 'hold_progression'],
  time_limited: ['trim_conditioning_minutes'],
  recovery_debt_high: ['hold_progression'],
};

export interface ConstraintTraceLine {
  constraint: StateConstraint;
  outcome: ConstraintOutcome;
  /** the operations this constraint caused, matched by reason code */
  operations: ResolutionOperation[];
}

export interface DecisionTrace {
  /** the domain the resolver filtered constraints against */
  sessionDomain: 'strength' | 'conditioning';
  lines: ConstraintTraceLine[];
  /** operations whose reason code is not an active constraint code */
  unattributedOperations: ResolutionOperation[];
}

export const OUTCOME_LABEL: Record<ConstraintOutcome, string> = {
  applied: 'applied',
  out_of_domain: 'other domain',
  permission_off: 'permission off',
  superseded_by_safety: 'not reached',
  not_evaluated: 'not evaluated',
  no_action_defined: 'no action in v1',
  no_change: 'nothing to change',
};

export const OUTCOME_EXPLANATION: Record<ConstraintOutcome, string> = {
  applied: 'Caused the operations listed under it.',
  out_of_domain:
    'Scoped to the other training domain, so this session was never a candidate for it.',
  permission_off:
    'Every action that could answer this constraint is switched off in the athlete-owned policy.',
  superseded_by_safety:
    'A hard safety flag resolved the session before soft constraints were evaluated.',
  not_evaluated: 'Auto-Coached is paused or revoked, so nothing was evaluated.',
  no_action_defined:
    'The v1 resolver has no operation for this constraint — it abstains rather than invent one.',
  no_change: 'Considered and allowed, but nothing in this session matched it.',
};

function appliesToDomain(c: StateConstraint, domain: 'strength' | 'conditioning'): boolean {
  return c.domain === 'both' || c.domain === domain;
}

export function buildDecisionTrace(
  state: AthleteStateSnapshot,
  resolution: AutoCoachResolution,
  policy: AutonomyPolicy,
  sessionDomain: 'strength' | 'conditioning',
): DecisionTrace {
  const paused = policy.status !== 'active';
  const safetyStopped = resolution.state === 'safety_stop';

  const lines = state.constraints.map((constraint): ConstraintTraceLine => {
    const operations = resolution.operations.filter(
      (o) => o.reasonCode === constraint.code && o.type !== 'keep_as_planned',
    );

    return { constraint, operations, outcome: outcomeFor() };

    function outcomeFor(): ConstraintOutcome {
      if (operations.length > 0) return 'applied';
      if (paused) return 'not_evaluated';
      if (!appliesToDomain(constraint, sessionDomain)) return 'out_of_domain';
      // A hard constraint that produced nothing only makes sense when some
      // OTHER hard constraint stopped the session first; either way the
      // honest word for it is "not reached".
      if (safetyStopped) return 'superseded_by_safety';

      const acting = ACTING_PERMISSIONS[constraint.code];
      if (!acting) return 'no_action_defined';
      if (acting.every((p) => policy.permissions[p] === 'off')) return 'permission_off';
      return 'no_change';
    }
  });

  const constraintCodes = new Set<string>(state.constraints.map((c) => c.code));
  const unattributedOperations = resolution.operations.filter(
    (o) => o.type !== 'keep_as_planned' && !constraintCodes.has(o.reasonCode),
  );

  return { sessionDomain, lines, unattributedOperations };
}
