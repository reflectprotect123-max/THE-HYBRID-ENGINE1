import { useEffect, useState } from 'react';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import type { AthleteTrendSnapshot } from '../data/contracts';

/*
 * The one way a pillar screen reads a ROSTER athlete's trends.
 *
 * Four screens need this and they must not answer the question four
 * different ways — particularly the "we asked and were refused" case, which
 * is the one a coach is most likely to misread as a bug.
 *
 * The states are kept apart deliberately:
 *
 *  - `loading`  — asked, no answer yet.
 *  - `absent`   — asked, and there is genuinely nothing: no snapshot has ever
 *                 been pushed for this athlete and kind.
 *  - `ready`    — a snapshot came back; `points` may still be empty, which is
 *                 a different claim again ("pushed, but nothing in it").
 *
 * Collapsing `loading` into `absent` is the failure worth naming: a slow
 * request then renders as "this athlete has no history", which is a false
 * statement about a person rather than a spinner that has not finished.
 *
 * `?.()` alone short-circuits to `undefined` on a repository that does not
 * implement the method (an older build, or the mock), and chaining `.then`
 * on that throws instead of degrading — hence `?? Promise.resolve(null)`,
 * the same guard every other roster read in this bench uses.
 */

export type RosterTrendState<T> =
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'ready'; points: T[]; generatedAt: string };

export function useRosterTrend<T>(
  clientId: string | null,
  kind: AthleteTrendSnapshot['kind'],
): RosterTrendState<T> {
  const { repository } = useCoachWorkspace();
  const [snapshot, setSnapshot] = useState<AthleteTrendSnapshot | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    if (!clientId) return;
    (repository.getTrendSnapshot?.(clientId, kind) ?? Promise.resolve(null))
      .then((value) => { if (active) setSnapshot(value); })
      .catch(() => { if (active) setSnapshot(null); });
    return () => { active = false; };
  }, [repository, clientId, kind]);

  if (snapshot === undefined) return { status: 'loading' };
  if (snapshot === null) return { status: 'absent' };
  return {
    status: 'ready',
    points: snapshot.points as unknown as T[],
    generatedAt: snapshot.generatedAt,
  };
}

/**
 * Whether this coach may read the athlete's RAW readiness.
 *
 * Separate from the trend read itself because consent and data are separate
 * facts: a grant can exist with no snapshot behind it, and a snapshot can
 * exist that this coach is no longer allowed to see. Readiness is the only
 * pillar that gates on this — `readiness_read_grants` exists for it
 * specifically, and the athlete can revoke it at any time.
 */
export function useReadinessGrant(clientId: string | null): boolean | null {
  const { repository } = useCoachWorkspace();
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    setGranted(null);
    if (!clientId) return;
    (repository.hasReadinessGrant?.(clientId) ?? Promise.resolve(false))
      .then((value) => { if (active) setGranted(value); })
      .catch(() => { if (active) setGranted(false); });
    return () => { active = false; };
  }, [repository, clientId]);

  return granted;
}
