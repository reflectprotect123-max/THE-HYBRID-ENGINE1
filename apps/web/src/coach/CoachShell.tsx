import { Link, Navigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import './coach.css';
import { useDb } from '../store/db';
import { useSync } from '../cloud/sync';
import { coachAllowed } from './guard';
import { DecisionTrace } from './DecisionTrace';
import { NutritionPanel } from './NutritionPanel';
import { OnboardingPanel, useOnboarding } from './OnboardingPanel';
import { PolicyInspector } from './PolicyInspector';
import { ProgramGrid } from './ProgramGrid';
import { ResolutionPreview } from './ResolutionPreview';
import { Simulate } from './Simulate';

/*
 * The bench is one screen on purpose: the grid is the workspace and the
 * resolution preview is a panel within it, not a separate page. Local context
 * beats navigation — nothing in here routes away from the week.
 */
export function CoachShell() {
  const { dataRecovered, weeklyPlan } = useDb();
  const [horizon, setHorizon] = useState<4 | 8 | 12>(8);
  const [showPreview, setShowPreview] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPolicyInspector, setShowPolicyInspector] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showNutrition, setShowNutrition] = useState(false);
  const onboarding = useOnboarding();

  return (
    <div className="coach-root min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line2 bg-panel3/95 px-2 py-1 backdrop-blur">
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
        <button
          onClick={() => setShowPolicyInspector(true)}
          className="rounded-full bg-gold-wash px-1 py-0.5 text-[11px] tabular-nums text-gold2 outline outline-1 outline-gold-line"
        >
          Auto-Coached policy
        </button>
        <button
          onClick={() => setShowSimulate(true)}
          className="rounded-full bg-gold-wash px-1 py-0.5 text-[11px] tabular-nums text-gold2 outline outline-1 outline-gold-line"
        >
          Simulate
        </button>
        <button
          onClick={() => setShowTrace(true)}
          className="rounded-full bg-gold-wash px-1 py-0.5 text-[11px] tabular-nums text-gold2 outline outline-1 outline-gold-line"
          title="Why today's session resolved the way it did"
        >
          Why today
        </button>
        <button
          onClick={() => setShowNutrition(true)}
          className="rounded-full bg-gold-wash px-1 py-0.5 text-[11px] tabular-nums text-gold2 outline outline-1 outline-gold-line"
          title="The athlete's food log, adherence and expenditure — read-only"
        >
          Nutrition
        </button>
        <Link
          to={`/coach/review/${weeklyPlan.weekStart}`}
          className="rounded-full bg-gold px-1 py-0.5 text-[11px] font-medium text-bg outline outline-1 outline-gold-line"
        >
          Review week
        </Link>
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
            <ResolutionPreview />
          </aside>
        )}
      </div>
      {showOnboarding && <OnboardingPanel onClose={() => setShowOnboarding(false)} />}
      {showPolicyInspector && <PolicyInspector onClose={() => setShowPolicyInspector(false)} />}
      {showSimulate && <Simulate onClose={() => setShowSimulate(false)} />}
      {showTrace && <DecisionTrace onClose={() => setShowTrace(false)} />}
      {showNutrition && <NutritionPanel onClose={() => setShowNutrition(false)} />}
    </div>
  );
}

/** UI visibility gate for every route in the lazy coach chunk. */
export function CoachAccess({ children }: { children: ReactNode }) {
  const { user } = useSync();
  const allowed = coachAllowed(
    user?.id,
    import.meta.env.VITE_COACH_USER_IDS as string | undefined,
    import.meta.env.DEV,
    import.meta.env.VITE_COACH_DEMO_MODE === 'true',
  );
  return allowed ? children : <Navigate to="/" replace />;
}
