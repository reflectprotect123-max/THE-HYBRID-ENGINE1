import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { nutritionSummary } from '@hybrid/nutrition-adapter';
import { useLedger } from '../autocoach/ledger';
import { useDb } from '../store/db';
import { useNutrition } from '../store/nutrition';
import { CoachSection } from './CoachSection';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import type { AthleteWeekSummary } from './contracts';
import { buildWeekReview, type ReviewStatus } from './week-review';

const STATUS_LABEL: Record<ReviewStatus, string> = {
  completed: 'Completed',
  partial: 'Partial or still open',
  'planned-not-logged': 'No matching actual',
  unplanned: 'Unplanned work',
};

const STATUS_CLASS: Record<ReviewStatus, string> = {
  completed: 'text-good',
  partial: 'text-warn',
  'planned-not-logged': 'text-muted',
  unplanned: 'text-gold2',
};

function niceDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

/**
 * The REAL roster view. Deliberately NOT a "reconciled ledger" the way
 * `buildWeekReview` produces for the self-coach screen — that reconciliation
 * needs a stable `workoutId` match between plan entries and sessions, and
 * this backend tier doesn't return one (docs/ARC_LAYER3_DESIGN.md §4,
 * finding 3, closed by minting a server-side id rather than trusting a
 * client string; the id never round-trips into this summary). Showing
 * "planned" and "recorded" as two honest, separate lists is truthful about
 * what the server actually knows; a false reconciliation would not be.
 */
function RosterWeekReview({ clientId, clientName, weekStart }: { clientId: string; clientName: string; weekStart: string }) {
  const { repository } = useCoachWorkspace();
  const [summary, setSummary] = useState<AthleteWeekSummary | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setSummary(undefined);
    /* `?? Promise.resolve(null)` — `?.()` alone short-circuits to
       `undefined` when unimplemented, and chaining `.then` on that throws
       rather than degrading to "not readable". */
    (repository.getAthleteWeekSummary?.(clientId, weekStart) ?? Promise.resolve(null))
      .then((v) => { if (active) setSummary(v); })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [repository, clientId, weekStart]);

  const dropped = summary?.decisions.filter((d) => d.action === 'dropped') ?? [];

  return (
    <main className="mx-auto max-w-[900px] p-3 text-text">
      <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · week</p>
      <h1 className="mt-0.5 text-xl font-semibold">{clientName}&rsquo;s week of {niceDate(weekStart)}</h1>

      {summary === undefined && <p className="mt-2 text-sm text-muted">Loading…</p>}
      {summary === null && <p className="mt-2 text-sm text-muted">Not readable for this week.</p>}

      {summary && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <section className="rounded-md border border-line2 bg-panel3 p-2">
            <h2 className="text-sm font-semibold">Planned</h2>
            <div className="mt-1 space-y-1">
              {summary.entries.map((entry) => (
                <article key={entry.proposalId} className="rounded border border-line bg-panel p-1 text-xs">
                  <div className="flex items-baseline gap-1"><span className="font-medium">{entry.title}</span><span className="ml-auto tabular-nums text-muted">{niceDate(entry.date)}</span></div>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-dim">{entry.domain} · {entry.status}</p>
                </article>
              ))}
              {summary.entries.length === 0 && <p className="text-xs text-muted">Nothing was placed this week.</p>}
            </div>
          </section>

          <section className="rounded-md border border-line2 bg-panel3 p-2">
            <h2 className="text-sm font-semibold">Recorded</h2>
            <div className="mt-1 space-y-1">
              {summary.sessions.map((session) => (
                <article key={session.id} className="rounded border border-line bg-panel p-1 text-xs">
                  <div className="flex items-baseline gap-1"><span className="font-medium">{session.name ?? (session.kind === 'strength' ? 'Strength session' : 'Conditioning session')}</span><span className="ml-auto tabular-nums text-muted">{niceDate(session.date)}</span></div>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-dim">{session.kind} · {session.status}</p>
                </article>
              ))}
              {summary.sessions.length === 0 && <p className="text-xs text-muted">Nothing recorded this week.</p>}
            </div>
          </section>

          <section className="rounded-md border border-line2 bg-panel3 p-2 md:col-span-2">
            <h2 className="text-sm font-semibold">What competed and lost</h2>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {dropped.map((decision) => (
                <article key={`${decision.proposalId}:${decision.reasonCode}`} className="rounded border border-line bg-panel p-1.5 text-xs">
                  <p className="text-[10px] uppercase tracking-wide text-gold2">{decision.reasonCode.replaceAll('_', ' ')}</p>
                  <p className="mt-0.5 text-muted">{decision.explanation}</p>
                </article>
              ))}
              {dropped.length === 0 && <p className="text-xs text-muted">Nothing was dropped in this projection.</p>}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export function WeekReview() {
  const { selectedClient } = useCoachWorkspace();
  const params = useParams();
  if (selectedClient && selectedClient.source === 'roster-summary') {
    return (
      <RosterWeekReview
        clientId={selectedClient.id}
        clientName={selectedClient.name}
        weekStart={params.weekStart ?? new Date().toISOString().slice(0, 10)}
      />
    );
  }
  return <SelfCoachWeekReview />;
}

function SelfCoachWeekReview() {
  const { weekStart } = useParams();
  const { weeklyPlan, sessions } = useDb();
  const interventions = useLedger();
  const { nutrition } = useNutrition();
  const reconciled = useMemo(
    () => buildWeekReview(weeklyPlan, sessions, interventions),
    [weeklyPlan, sessions, interventions],
  );
  const nutritionContext = useMemo(
    () => nutritionSummary(nutrition, weeklyPlan.weekStart),
    [nutrition, weeklyPlan.weekStart],
  );

  if (weekStart && weekStart !== weeklyPlan.weekStart) {
    return (
      <main className="mx-auto max-w-[720px] p-3 text-text">
        <p className="text-[11px] uppercase tracking-[0.18em] text-gold">Week review</p>
        <h1 className="mt-0.5 text-xl font-semibold">Historical plan unavailable on this device</h1>
        <p className="mt-1 max-w-[62ch] text-sm text-muted">
          This app currently retains only the live Coordinator projection here. Rebuilding an old week from today’s
          workouts would rewrite history, so the review abstains instead.
        </p>
        <Link className="mt-2 inline-flex rounded border border-gold-line bg-gold-wash px-1.5 py-1 text-sm text-gold2" to={`/coach/review/${weeklyPlan.weekStart}`}>
          Open current week
        </Link>
      </main>
    );
  }

  return (
    <main className="coach-review min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-[1180px]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · week</p>
            <h1 className="mt-0.5 text-xl font-semibold">What was intended, what happened, and why</h1>
            <p className="mt-0.5 text-xs text-muted">{niceDate(reconciled.weekStart)} – {niceDate(reconciled.weekEnd)}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1180px] gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-2">
          {reconciled.safetyDrops.length > 0 && (
            <section className="rounded-md border border-bad/50 bg-panel3 p-2" aria-labelledby="safety-title">
              <p className="text-[10px] uppercase tracking-wider text-bad">Safety first</p>
              <h2 id="safety-title" className="mt-0.5 text-sm font-semibold">{reconciled.safetyDrops.length} session {reconciled.safetyDrops.length === 1 ? 'was' : 'were'} held</h2>
              {reconciled.safetyDrops.map((decision) => (
                <div key={`${decision.proposalId}:${decision.reasonCode}`} className="mt-1 border-t border-line pt-1 text-xs">
                  <p className="font-medium">{decision.reasonCode.replaceAll('_', ' ')}</p>
                  <p className="mt-0.5 text-muted">{decision.explanation}</p>
                  <p className="mt-0.5 text-dim">Next: review the athlete’s direct report. No readiness or nutrition signal overrides this hold.</p>
                </div>
              ))}
            </section>
          )}

          <section className="overflow-hidden rounded-md border border-line2 bg-panel3" aria-labelledby="ledger-title">
            <div className="border-b border-line px-2 py-1.5">
              <h2 id="ledger-title" className="text-sm font-semibold">Planned versus actual ledger</h2>
              <p className="mt-0.5 text-[11px] text-muted">No compliance score. Substitutions and unmatched work stay visible.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead className="bg-panel2 text-[10px] uppercase tracking-wider text-dim">
                  <tr><th className="px-2 py-1">Day</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Intent</th><th className="px-2 py-1">Actual</th><th className="px-2 py-1">Reason</th></tr>
                </thead>
                <tbody>
                  {reconciled.rows.map((row) => (
                    <tr key={row.id} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{niceDate(row.date)}</td>
                      <td className={`px-2 py-1.5 font-medium ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</td>
                      <td className="px-2 py-1.5">{row.plannedTitle ?? <span className="text-dim">None</span>}<span className="mt-0.5 block text-[10px] uppercase tracking-wide text-dim">{row.domain}</span></td>
                      <td className="px-2 py-1.5">{row.actualTitle ?? <span className="text-dim">Not recorded</span>}</td>
                      <td className="max-w-[34ch] px-2 py-1.5 text-muted">{row.decisionReason}</td>
                    </tr>
                  ))}
                  {reconciled.rows.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-muted">No resolved or recorded training in this week.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <CoachSection eyebrow="Live projection" title="Review state">
            <p className="text-xs text-muted">
              This is the Coordinator&rsquo;s current deterministic projection paired with local actuals. It is not a
              stored historical plan snapshot; ambiguous matches remain explicit.
            </p>
          </CoachSection>

          <CoachSection eyebrow="Coordinator arbitration" title="What competed and lost" count={reconciled.dropped.length}>
            <p className="text-[11px] text-muted">Dropped proposals are part of the week, not hidden failures.</p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {reconciled.dropped.map((decision) => (
                <article key={`${decision.proposalId}:${decision.reasonCode}`} className="rounded border border-line bg-panel p-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-gold2">{decision.reasonCode.replaceAll('_', ' ')}</p>
                  <p className="mt-0.5 text-xs text-muted">{decision.explanation}</p>
                </article>
              ))}
              {reconciled.dropped.length === 0 && <p className="text-xs text-muted">No proposals were dropped in this projection.</p>}
            </div>
          </CoachSection>
        </div>

        <aside className="space-y-2">
          <CoachSection eyebrow="Automation" title="Automation receipts" count={reconciled.interventions.length}>
            <p className="text-[11px] text-warn">Device-local evidence. It is not yet synced or authoritative off this device.</p>
            <div className="mt-1 space-y-1">
              {reconciled.interventions.map((entry) => (
                <article key={entry.id} className="rounded border border-line bg-panel p-1">
                  <div className="flex gap-1 text-[10px] uppercase tracking-wide"><span>{entry.action}</span><span className="ml-auto text-dim">{niceDate(entry.date)}</span></div>
                  <p className="mt-0.5 text-xs text-muted">{entry.reasonCodes.join(', ') || 'No reason code recorded'}</p>
                </article>
              ))}
              {reconciled.interventions.length === 0 && <p className="text-xs text-muted">No local automation receipt for this week.</p>}
            </div>
          </CoachSection>

          <CoachSection eyebrow="Context" title="Nutrition context">
            <Link to="/coach/nutrition" className="text-[10px] uppercase tracking-wide text-gold2">Open review</Link>
            <dl className="mt-1 space-y-0.5 text-xs">
              <div className="flex"><dt className="text-muted">Days logged</dt><dd className="ml-auto tabular-nums">{nutritionContext.adherence.loggedDays} of {nutritionContext.adherence.windowDays}</dd></div>
              <div className="flex"><dt className="text-muted">Today logged</dt><dd className="ml-auto tabular-nums">{Math.round(nutritionContext.today.totals.calories)} kcal</dd></div>
            </dl>
            <p className="mt-1 text-[11px] text-dim">Shown beside training as context only. It did not schedule, drop, or alter a session.</p>
          </CoachSection>

          <section className="rounded-md border border-gold-line bg-gold-wash p-2" aria-labelledby="next-title">
            <p className="text-[10px] uppercase tracking-wider text-gold2">Next</p>
            <h2 id="next-title" className="mt-0.5 text-sm font-semibold">Steer inputs, not the resolved week</h2>
            <p className="mt-0.5 text-xs text-muted">Future coach actions should change goals, availability, or constraints and let the Coordinator resolve again.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
