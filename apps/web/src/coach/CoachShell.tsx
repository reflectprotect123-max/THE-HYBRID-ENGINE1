import { Link, Navigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import './coach.css';
import { useDb } from '../store/db';
import { useSync } from '../cloud/sync';
import { IS_SCOPED_BUILD } from '../product';
import { coachAllowed } from './guard';
import { CoachNotAuthorized } from './CoachNotAuthorized';
import { CoachSignIn } from './CoachSignIn';
import { NutritionPanel } from './NutritionPanel';
import { OnboardingPanel, useOnboarding } from './OnboardingPanel';
import { ProgramGrid } from './ProgramGrid';
import { AthleteSignals } from './AthleteSignals';

/*
 * The bench is one screen on purpose: the grid is the workspace and the
 * resolution preview is a panel within it, not a separate page. Local context
 * beats navigation — nothing in here routes away from the week.
 */
export function CoachShell() {
  const { dataRecovered } = useDb();
  const [horizon, setHorizon] = useState<4 | 8 | 12>(8);
  const [showPreview, setShowPreview] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showNutrition, setShowNutrition] = useState(false);
  const onboarding = useOnboarding();

  return (
    <div className="coach-root min-h-screen bg-bg text-text">
      {/* `flex-wrap`, added by stage 4's phone pass (13 August 2026). This
          row carries a title and ten controls, and without wrapping it laid
          them out in one line 775px wide inside a 420px viewport — the whole
          PAGE scrolled sideways, which is the one thing `checks/screens.mjs`
          treats as a real failure. The week grid below was never the problem:
          `ProgramGrid` has had its own `overflow-x-auto` all along, so it
          scrolls inside itself the way wide content is supposed to. */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-line2 bg-panel3/95 px-2 py-1 backdrop-blur">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-gold">Coach</div>
          <h1 className="text-base font-semibold leading-tight">Program bench</h1>
        </div>
        {!onboarding.complete && (
          <button
            onClick={() => setShowOnboarding(true)}
            className="rounded-full bg-gold-wash px-1 py-0.5 text-[11px] tabular-nums text-gold2 outline outline-1 outline-gold-line"
          >
            Athlete setup {onboarding.done}/{onboarding.total}
          </button>
        )}
        {/* "Auto-Coached policy", "Simulate" and "Why today" stood here until
            14 August 2026. All three opened overlays over `@hybrid/auto-coach`
            — the autonomy policy, a what-if run of the resolver, and the trace
            explaining how today's session resolved — and all three went with
            it. Nothing replaced them: they answered questions about a layer
            that no longer decides anything. This header is three controls
            lighter and that is the whole change to it. */}
        <button
          onClick={() => setShowNutrition(true)}
          className="rounded-full bg-gold-wash px-1 py-0.5 text-[11px] tabular-nums text-gold2 outline outline-1 outline-gold-line"
          title="The athlete's food log, adherence and expenditure — read-only"
        >
          Nutrition
        </button>
        {/* "Review week" linked to /coach/review/:weekStart, keyed on the
            Coordinator's own weekStart. Both the route and the screen were
            deleted with the Coordinator on 14 August 2026. */}
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Weeks shown">
          {([4, 8, 12] as const).map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={
                'rounded px-1 py-0.5 text-xs tabular-nums transition-colors ' +
                (horizon === h
                  ? 'bg-gold-wash text-gold2 outline outline-1 outline-gold-line'
                  : 'text-muted hover:text-text')
              }
              aria-pressed={horizon === h}
            >
              {h}w
            </button>
          ))}
          <button
            onClick={() => setShowPreview((v) => !v)}
            className={
              'ml-1 rounded px-1 py-0.5 text-xs transition-colors ' +
              (showPreview
                ? 'bg-gold-wash text-gold2 outline outline-1 outline-gold-line'
                : 'text-muted hover:text-text')
            }
            aria-pressed={showPreview}
          >
            Resolution
          </button>
        </div>
      </header>

      {dataRecovered && (
        <p className="border-b border-line bg-panel px-2 py-0.5 text-xs text-muted">
          Stored data was unreadable at boot — this bench is showing a fresh, empty database.
        </p>
      )}

      <div className="flex items-start">
        <main className="min-w-0 flex-1">
          <ProgramGrid horizon={horizon} />
        </main>
        {showPreview && (
          <aside className="sticky top-[41px] hidden w-[340px] shrink-0 border-l border-line lg:block">
            <AthleteSignals />
          </aside>
        )}
      </div>
      {showOnboarding && <OnboardingPanel onClose={() => setShowOnboarding(false)} />}
      {showNutrition && <NutritionPanel onClose={() => setShowNutrition(false)} />}
    </div>
  );
}

/** UI visibility gate for every route in the lazy coach chunk. */
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
