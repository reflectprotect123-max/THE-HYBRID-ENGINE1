import { useNavigate } from 'react-router-dom';
import { useDb } from '../store/db';
import { useWhoop } from '../cloud/whoop';
import { useConcept2 } from '../cloud/concept2';
import { cx } from '../ui';
import { toggleSkip, useBench } from './bench-store';
import { deriveOnboarding, onboardingProgress, type OnboardingStep } from './onboarding';

export function useOnboarding(): { steps: OnboardingStep[]; done: number; total: number; complete: boolean } {
  const { db, workouts, sessions } = useDb();
  const whoop = useWhoop();
  const c2 = useConcept2();
  const bench = useBench();
  const steps = deriveOnboarding({
    hasCore: !!db.core,
    availableDays: db.core?.schedule.availableDays.length ?? 0,
    hasPrimaryGoal: !!db.core?.goals.primary,
    whoopConnected: whoop.connected,
    c2Connected: c2.connected,
    plannedWorkouts: workouts.length,
    loggedSessions: sessions.length,
    skips: bench.skips,
  });
  return { steps, ...onboardingProgress(steps) };
}

/**
 * Athlete zero: the coach is also the first athlete, in the same account.
 * Every row is derived from real store and integration state — the panel
 * never claims something is done that the data cannot show.
 */
export function OnboardingPanel({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { steps, done, total, complete } = useOnboarding();

  return (
    <div className="fixed inset-0 z-30 grid place-items-center" role="dialog" aria-modal="true" aria-label="Athlete setup">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[80vh] w-[min(460px,calc(100vw-32px))] overflow-y-auto rounded-md border border-line2 bg-panel3 p-2 shadow-2xl">
        <div className="flex items-baseline gap-1">
          <h2 className="text-sm font-semibold">Athlete setup</h2>
          <span className="ml-auto text-xs tabular-nums text-muted">
            {done}/{total}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-dim">
          Coach and first athlete are the same account. Each step reads live state — nothing here
          is a tour, and nothing checks itself off.
        </p>
        <ul className="mt-1 space-y-0.5">
          {steps.map((s) => (
            <li
              key={s.id}
              className={cx(
                'rounded border border-line bg-panel p-1',
                (s.done || s.skipped) && 'opacity-60',
              )}
            >
              <div className="flex items-start gap-1">
                <span
                  aria-hidden
                  className={cx(
                    'mt-[2px] grid h-2 w-2 shrink-0 place-items-center rounded-full text-[9px]',
                    s.done ? 'bg-gold text-[#1b1509]' : 'outline outline-1 outline-line2 text-dim',
                  )}
                >
                  {s.done ? '✓' : ''}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {s.label}
                    {s.skipped && (
                      <span className="ml-1 text-[9px] uppercase tracking-wide text-dim">skipped</span>
                    )}
                  </p>
                  <p className="text-[11px] leading-snug text-muted">{s.detail}</p>
                </div>
                <span className="flex shrink-0 gap-0.5">
                  {!s.done && (
                    <button
                      className="rounded bg-gold-wash px-1 py-[1px] text-[11px] text-gold2 outline outline-1 outline-gold-line"
                      onClick={() => {
                        if (s.href) nav(s.href);
                        else onClose();
                      }}
                    >
                      {s.href ? 'Go' : 'Plan'}
                    </button>
                  )}
                  {s.skippable && !s.done && (
                    <button
                      className="rounded px-1 py-[1px] text-[11px] text-dim outline outline-1 outline-line hover:text-text"
                      onClick={() => toggleSkip(s.id)}
                    >
                      {s.skipped ? 'Unskip' : 'Skip'}
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
        {complete && (
          <p className="mt-1 text-[11px] text-ok">
            Setup complete — the loop is live: plan here, train in the athlete app, review the
            resolution as it lands.
          </p>
        )}
        <div className="mt-1 flex justify-end">
          <button
            className="rounded px-1 py-0.5 text-xs text-muted outline outline-1 outline-line2 hover:text-text"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
