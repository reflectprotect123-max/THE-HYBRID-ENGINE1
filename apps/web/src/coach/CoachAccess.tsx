import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSync } from '../cloud/sync';
import { IS_SCOPED_BUILD } from '../product';
import { coachAllowed } from './guard';
import { CoachNotAuthorized } from './CoachNotAuthorized';
import { CoachSignIn } from './CoachSignIn';

/*
 * THE DOOR TO THE WHOLE BENCH.
 *
 * Extracted from `CoachShell.tsx` on 14 August 2026, when that file was
 * deleted with the `/coach/legacy` route. This gate was never part of the
 * legacy bench — it wraps EVERY coach route in `index.tsx` — and it only
 * lived there because that file was once the bench's entry point. Moving it
 * out is what let the rest go.
 *
 * The body below is unchanged, comments included.
 */

export function CoachAccess({ children }: { children: ReactNode }) {
  const { user, authReady } = useSync();
  /* `user` is null both while the stored session is still being restored and
     when there is genuinely nobody signed in. Deciding on the first render
     would flash the denied state at the one coach who IS allowed, on every
     cold load — so wait for the restore to finish before judging anyone. */
  if (!authReady) return null;
  const allowed = coachAllowed(
    user?.id,
    import.meta.env.VITE_COACH_USER_IDS as string | undefined,
    import.meta.env.DEV,
    import.meta.env.VITE_COACH_DEMO_MODE === 'true',
  );
  if (allowed) return children;
  /* The branded athlete builds never had a reachable coach door — denial
     bounced to `/`, which is Home there. Keep that: the sign-in screen belongs
     to the unscoped dashboard, which is the only build whose `/` is the bench.
     Signed in but not on the allowlist is a different answer from signed out,
     and it needs a way back out — CoachSignIn would just re-render silently. */
  if (IS_SCOPED_BUILD) return <Navigate to="/" replace />;
  return user ? <CoachNotAuthorized /> : <CoachSignIn />;
}
