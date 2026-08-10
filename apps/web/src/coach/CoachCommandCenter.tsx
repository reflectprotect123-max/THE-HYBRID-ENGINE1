import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLedger } from '../autocoach/ledger';
import { useDb } from '../store/db';
import { useNutrition } from '../store/nutrition';
import { AthleteStatus } from './AthleteStatus';
import { buildCoachNutritionReview } from './nutrition-review';
import { useProgressionLedger } from './progression-store';
import { buildWeekReview } from './week-review';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import { CoachSection } from './CoachSection';
import type { ClientSummary } from './contracts';

interface PriorityItem {
  id: string;
  level: 'safety' | 'decision' | 'reconcile' | 'context';
  title: string;
  detail: string;
  next: string;
  to: string;
}

interface ClientSnapshot {
  id: string;
  name: string;
  initials: string;
  block: string;
  week: string;
  strength: string;
  conditioning: string;
  nutrition: string;
  checkIns: string;
  easy: number;
  moderate: number;
  hard: number;
  alert?: string;
  source: ClientSummary['source'];
}

function toSnapshot(client: ClientSummary): ClientSnapshot {
  return {
    id: client.id, name: client.name, initials: client.initials,
    block: client.assignment?.programName ?? 'No active assignment',
    week: client.assignment ? `Week ${client.assignment.currentWeek} of ${client.assignment.totalWeeks}` : 'Unassigned',
    strength: `${client.completion.strength.completed} of ${client.completion.strength.planned}`,
    conditioning: `${client.completion.conditioning.completed} of ${client.completion.conditioning.planned}`,
    nutrition: `${client.completion.nutritionDays} of 7 days`, checkIns: `${client.completion.checkInDays} of 7`,
    easy: client.conditioningMinutes.easy, moderate: client.conditioningMinutes.moderate, hard: client.conditioningMinutes.hard,
    alert: client.attention?.label, source: client.source,
  };
}

const LEVEL_STYLE: Record<PriorityItem['level'], string> = {
  safety: 'border-bad/70',
  decision: 'border-gold-line/70',
  reconcile: 'border-warn/70',
  context: 'border-line2',
};

const LEVEL_LABEL: Record<PriorityItem['level'], string> = {
  safety: 'Safety',
  decision: 'Decision',
  reconcile: 'Reconcile',
  context: 'Context',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

export function CoachCommandCenter() {
  const [showAllClients, setShowAllClients] = useState(false);
  const { clients: clientContracts, selectedClient: selectedContract, selectClient, loading: clientsLoading, error: clientsError } = useCoachWorkspace();
  const clients = useMemo(() => clientContracts.map(toSnapshot), [clientContracts]);
  const selectedClient = selectedContract ? toSnapshot(selectedContract) : null;
  const { db, sessions, weeklyPlan, athleteState } = useDb();
  const interventionLedger = useLedger();
  const progressionLedger = useProgressionLedger();
  const { nutrition } = useNutrition();
  const review = useMemo(
    () => buildWeekReview(weeklyPlan, sessions, interventionLedger),
    [interventionLedger, sessions, weeklyPlan],
  );
  const nutritionReview = useMemo(() => buildCoachNutritionReview(nutrition, today()), [nutrition]);
  const decided = useMemo(
    () => new Set(progressionLedger.decisions.map((decision) => decision.proposalId)),
    [progressionLedger.decisions],
  );
  const pendingProgression = progressionLedger.proposals.filter((proposal) => !decided.has(proposal.id));
  const strengthPending = pendingProgression.filter((proposal) => proposal.domain === 'strength').length;
  const conditioningPending = pendingProgression.filter((proposal) => proposal.domain === 'conditioning').length;
  const strengthWorkouts = db.workouts.filter((workout) => workout.kind !== 'conditioning').length;
  const conditioningWorkouts = db.workouts.filter((workout) => workout.kind === 'conditioning').length;
  const exceptions = review.rows.filter((row) => row.status !== 'completed');

  const priorities: PriorityItem[] = [
    ...athleteState.constraints.filter((constraint) => constraint.hard).map((constraint) => ({
      id: `safety:${constraint.code}`,
      level: 'safety' as const,
      title: constraint.code === 'pain_hold_active' ? 'Pain hold is active' : 'Illness review is active',
      detail: constraint.reason,
      next: 'Inspect the safety state before changing training.',
      to: `/coach/review/${weeklyPlan.weekStart}`,
    })),
    ...(pendingProgression.length ? [{
      id: 'progression',
      level: 'decision' as const,
      title: `${pendingProgression.length} progression ${pendingProgression.length === 1 ? 'proposal needs' : 'proposals need'} a decision`,
      detail: `${strengthPending} Strength · ${conditioningPending} Conditioning. No increase is applied until approval.`,
      next: 'Review before-and-after evidence and record a rationale.',
      to: '/coach/progression',
    }] : []),
    ...review.safetyDrops.slice(0, 2).map((decision) => ({
      id: `drop:${decision.proposalId}`,
      level: 'safety' as const,
      title: 'Coordinator removed a session for safety',
      detail: decision.explanation,
      next: 'Confirm the athlete understands what changed and why.',
      to: `/coach/review/${weeklyPlan.weekStart}`,
    })),
    ...exceptions.slice(0, 3).map((row) => ({
      id: row.id,
      level: 'reconcile' as const,
      title: row.status === 'planned-not-logged' ? `${row.plannedTitle ?? 'Planned session'} has no matching actual` : row.status === 'unplanned' ? `${row.actualTitle ?? 'Recorded work'} was unplanned` : `${row.actualTitle ?? row.plannedTitle ?? 'Session'} is partial`,
      detail: row.decisionReason,
      next: 'Reconcile intent and actual without rewriting either record.',
      to: `/coach/review/${weeklyPlan.weekStart}`,
    })),
    ...nutritionReview.exceptions.filter((item) => item.priority === 'attention').slice(0, 2).map((item) => ({
      id: `nutrition:${item.id}`,
      level: 'context' as const,
      title: item.title,
      detail: item.detail,
      next: item.next,
      to: '/coach/nutrition',
    })),
  ];
  if (clientsLoading || !selectedClient) return <main className="min-h-screen bg-bg p-4 text-sm text-muted" aria-busy="true">Loading coach workspace…</main>;
  if (clientsError) return <main className="min-h-screen bg-bg p-4 text-sm text-bad" role="alert">{clientsError}</main>;

  // The one flag every section below gates on. `weeklyPlan` and `athleteState`
  // (from useDb()) are the SIGNED-IN account's own — real and correct only for
  // this client. Rendering them for any other selection is the exact failure
  // named in the handoff: "renders the coach's own records under a client's
  // name." Every section on this page must ask this before showing either.
  const isLocalClient = selectedClient.source === 'engine-local';
  const displayedPriorities = isLocalClient ? priorities : selectedClient.alert ? [{ id: `client:${selectedClient.id}`, level: 'decision' as const, title: selectedClient.alert, detail: `${selectedClient.name} is in ${selectedClient.week.toLowerCase()} of ${selectedClient.block}.`, next: 'Backend evidence is required before this fixture can be actioned.', to: '/coach' }] : [];

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[.18em] text-gold">ARC command</p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">What needs your judgement?</h1>
            <p className="mt-1 max-w-[58ch] text-xs text-muted">Risk first, then exceptions, then performance decisions.</p>
          </div>
          <div className="ml-auto text-right"><p className="text-[9px] uppercase tracking-wide text-dim">Week of</p><p className="text-sm font-medium">{shortDate(weeklyPlan.weekStart)}</p></div>
        </div>
      </header>

      <section className="border-b border-line2 bg-panel3 px-3 py-2 sm:px-4" aria-label="Select client">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {clients.slice(0, showAllClients ? clients.length : 3).map((client) => <button key={client.id} type="button" aria-pressed={selectedClient.id === client.id} onClick={() => selectClient(client.id)} className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border px-2 text-left transition-colors ${selectedClient.id === client.id ? 'border-gold-line bg-gold-wash text-text' : 'border-line2 bg-panel text-muted hover:text-text'}`}><span className="grid h-6 w-6 place-items-center rounded-full bg-well text-[9px] font-semibold">{client.initials}</span><span><span className="block text-xs font-medium">{client.name}</span><span className="block text-[9px] text-dim">{client.week}</span></span>{client.alert && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-warn" aria-label="Needs attention" />}</button>)}
          <button type="button" aria-expanded={showAllClients} onClick={() => setShowAllClients((current) => !current)} className="min-h-10 shrink-0 rounded-md border border-dashed border-line2 px-2 text-xs text-muted hover:text-text">{showAllClients ? 'Show pinned' : 'All clients'}</button>
        </div>
      </section>

      {/* Identity line — who you're looking at, always visible, never a card.
          Everything below it either matters right now (the queue, elevated
          and always open) or is reference material (everything else, quiet
          by default, one tap away). */}
      <div className="border-b border-line2 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-gold">Selected client</p>
            <h2 className="text-lg font-semibold">{selectedClient.name}</h2>
          </div>
          <div className="sm:ml-3"><p className="text-sm font-medium">{selectedClient.block}</p><p className="text-[11px] text-muted">{selectedClient.week}</p></div>
          <Link to="/coach/library" className="ml-auto pointer-coarse:min-h-11 rounded-md border border-line2 bg-panel px-2 py-1.5 text-xs text-muted hover:text-text">Assign training</Link>
        </div>
      </div>

      <div className="grid gap-4 p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {/* The one elevated, always-open card — everything else in this
              column is a CoachSection, collapsed by default. */}
          <section aria-labelledby="priority-title" className="card raised mb-4 overflow-hidden rounded-lg border border-gold-line bg-gold-wash/[0.03] border-l-0">
            <div className="flex items-end gap-2 border-b border-gold-line/40 bg-gold-wash px-3 py-2">
              <div><p className="text-[9px] uppercase tracking-wider text-gold">Now</p><h2 id="priority-title" className="text-base font-semibold">Coach queue</h2></div>
              <span className="ml-auto text-xs tabular-nums text-muted">{displayedPriorities.length} open</span>
            </div>
            <div className="divide-y divide-line">
              {displayedPriorities.slice(0, 5).map((item) => (
                <Link key={item.id} to={item.to} className={`group flex gap-2 border-l-2 px-2.5 py-2.5 transition-colors hover:bg-panel ${LEVEL_STYLE[item.level]}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-1.5"><h3 className="text-sm font-semibold">{item.title}</h3><span className="text-[9px] uppercase tracking-wide text-dim">{LEVEL_LABEL[item.level]}</span></div>
                    <p className="mt-0.5 text-xs text-muted">{item.detail}</p>
                    <p className="mt-1 text-[11px] text-text"><span className="text-dim">Next</span> · {item.next}</p>
                  </div>
                  <span aria-hidden="true" className="self-center text-dim transition-colors group-hover:text-gold2">→</span>
                </Link>
              ))}
              {displayedPriorities.length === 0 && <div className="px-3 py-5 text-center"><h3 className="text-sm font-semibold">Nothing needs attention now</h3><p className="mt-1 text-xs text-muted">The next programmed sessions remain visible below. No alert does not mean readiness is inferred.</p></div>}
            </div>
          </section>

          <CoachSection eyebrow="Selected client" title="Overview">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4"><OverviewMetric label="Strength" value={selectedClient.strength} detail="sessions complete" /><OverviewMetric label="Conditioning" value={selectedClient.conditioning} detail="sessions complete" /><OverviewMetric label="Nutrition" value={selectedClient.nutrition} detail="logged" /><OverviewMetric label="Check-ins" value={selectedClient.checkIns} detail="submitted" /></dl>
            {selectedClient.source === 'engine-local' ? (
              <nav className="mt-3 flex flex-wrap gap-1 text-xs" aria-label={`${selectedClient.name} details`}>
                <Link to={`/coach/review/${weeklyPlan.weekStart}`} className="pointer-coarse:min-h-11 rounded-md border border-line2 bg-panel px-2 py-1.5 text-muted hover:text-text">Week</Link>
                <Link to="/coach/progression" className="pointer-coarse:min-h-11 rounded-md border border-line2 bg-panel px-2 py-1.5 text-muted hover:text-text">Decisions</Link>
                <Link to="/coach/nutrition" className="pointer-coarse:min-h-11 rounded-md border border-line2 bg-panel px-2 py-1.5 text-muted hover:text-text">Nutrition</Link>
                <Link to="/coach/legacy" className="pointer-coarse:min-h-11 rounded-md border border-line2 bg-panel px-2 py-1.5 text-muted hover:text-text">Inspect details</Link>
              </nav>
            ) : <p className="mt-3 text-xs text-dim">Detailed records await the backend adapter.</p>}
          </CoachSection>

          <CoachSection eyebrow="Specialist inputs" title="Three systems">
            <div className="divide-y divide-line">
              <SystemRow domain="Strength" detail={selectedClient.source === 'engine-local' ? `${strengthWorkouts} authored · ${strengthPending} pending` : `${selectedClient.strength} completed in the current week`} state={selectedClient.source === 'engine-local' ? athleteState.capacity.strength : 'fixture'} to={selectedClient.source === 'engine-local' ? '/coach/author' : '/coach/library'} />
              <SystemRow domain="Conditioning" detail={selectedClient.source === 'engine-local' ? `${conditioningWorkouts} authored · ${conditioningPending} pending` : `${selectedClient.conditioning} completed in the current week`} state={selectedClient.source === 'engine-local' ? athleteState.capacity.conditioning : 'fixture'} to={selectedClient.source === 'engine-local' ? '/coach/author' : '/coach/library'} />
              <SystemRow domain="Nutrition" detail={selectedClient.source === 'engine-local' ? `${nutritionReview.days.filter((day) => day.status !== 'unlogged').length} of 7 days declared · ${nutritionReview.exceptions.length} notes` : `${selectedClient.nutrition} logged`} state={selectedClient.source === 'engine-local' ? nutritionReview.summary.estimate.confidence : 'fixture'} to={selectedClient.source === 'engine-local' ? '/coach/nutrition' : '/coach'} />
            </div>
          </CoachSection>

          <CoachSection eyebrow="Coordinator output" title="Resolved week" count={isLocalClient ? weeklyPlan.entries.length : undefined}>
            {isLocalClient && <Link to={`/coach/review/${weeklyPlan.weekStart}`} className="mb-2 inline-block text-xs text-gold2 hover:text-gold">Open ledger →</Link>}
            {isLocalClient ? (
              <div className="overflow-hidden rounded-lg border border-line2 bg-panel3">
                {weeklyPlan.entries.map((entry) => <article key={entry.id} className="grid items-center gap-1 border-b border-line px-2.5 py-2 last:border-b-0 sm:grid-cols-[72px_1fr_auto]"><span className="text-[10px] uppercase tracking-wide text-gold2">{shortDate(entry.date)}</span><div className="min-w-0"><h3 className="truncate text-sm font-medium">{entry.title}</h3><p className="text-[11px] capitalize text-muted">{entry.effort} · {entry.locked ? 'locked intent' : 'Coordinator placed'}</p></div><span className="text-[9px] uppercase tracking-wide text-dim">{entry.domain}</span></article>)}
                {weeklyPlan.entries.length === 0 && <p className="p-3 text-xs text-muted">No sessions resolved. Inspect safety, schedule and proposal inputs; do not invent a plan.</p>}
              </div>
            ) : (
              <p className="rounded-lg border border-line2 bg-panel3 p-3 text-xs text-muted">
                {selectedClient.name}&rsquo;s resolved week is not readable here yet — only their
                weekly counts above are authorised today.
              </p>
            )}
          </CoachSection>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <CoachSection eyebrow="Conditioning" title="Intensity distribution">
            <div className="space-y-2"><LoadBar label="Easy" value={selectedClient.easy} max={Math.max(selectedClient.easy, selectedClient.moderate, selectedClient.hard)} /><LoadBar label="Moderate" value={selectedClient.moderate} max={Math.max(selectedClient.easy, selectedClient.moderate, selectedClient.hard)} /><LoadBar label="Hard" value={selectedClient.hard} max={Math.max(selectedClient.easy, selectedClient.moderate, selectedClient.hard)} /></div>
            <p className="mt-2 text-[10px] text-dim">Logged minutes by prescribed intensity. Distribution is context, not a readiness score.</p>
          </CoachSection>
          <CoachSection eyebrow="Athlete state" title="Operating context">
            {isLocalClient && <p className="mb-2 text-[9px] uppercase tracking-wide text-muted">{athleteState.dataQuality}</p>}
            {isLocalClient ? (
              <>
                <dl className="grid grid-cols-3 divide-x divide-line2 border-y border-line2 py-2 text-center"><Metric label="Readiness" value={athleteState.readiness.band} /><Metric label="Strength" value={athleteState.capacity.strength} /><Metric label="Conditioning" value={athleteState.capacity.conditioning} /></dl>
                <div className="mt-2"><AthleteStatus /></div>
              </>
            ) : (
              <p className="rounded border border-line2 bg-panel3 p-2 text-[11px] text-muted">
                {/* Not a banner disclosure — this replaces the readiness/capacity
                    figures entirely, so nothing of the signed-in coach's own
                    state is on screen while {selectedClient.name} is selected. */}
                {selectedClient.name}&rsquo;s readiness and capacity are not readable here yet.
                Only the counts and safety flag above are authorised today.
              </p>
            )}
            <details className="mt-3 border-t border-line2 pt-2 text-xs">
              <summary className="cursor-pointer select-none font-medium text-muted hover:text-text">Truth layers and authority</summary>
              <ol className="mt-2 space-y-1.5"><Truth number="01" title="Intent" detail="The authored session and protected goal." /><Truth number="02" title="Resolution" detail="What the Coordinator allowed this week." /><Truth number="03" title="Actual" detail="What the athlete recorded—never imputed." /><Truth number="04" title="Decision" detail="What the coach approved, rejected or held." /></ol>
            </details>
          </CoachSection>
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="px-1"><dt className="text-[9px] uppercase tracking-wide text-dim">{label}</dt><dd className="mt-0.5 text-xs font-semibold capitalize">{value}</dd></div>; }
function OverviewMetric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="px-2 py-2.5"><dt className="text-[9px] uppercase tracking-wide text-dim">{label}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd><span className="text-[10px] text-muted">{detail}</span></div>; }
function LoadBar({ label, value, max }: { label: string; value: number; max: number }) { return <div><div className="flex text-xs"><span>{label}</span><span className="ml-auto tabular-nums text-muted">{value} min</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-well"><div className="h-full rounded-full bg-gold" style={{ width: `${max ? Math.max(4, (value / max) * 100) : 0}%` }} /></div></div>; }
function Truth({ number, title, detail }: { number: string; title: string; detail: string }) { return <li className="flex gap-1.5"><span className="text-[10px] font-semibold text-gold2">{number}</span><div><strong>{title}</strong><p className="text-[11px] text-muted">{detail}</p></div></li>; }
function SystemRow({ domain, detail, state, to }: { domain: string; detail: string; state: string; to: string }) { return <Link to={to} className="group grid min-h-14 items-center gap-1 py-2 transition-colors hover:bg-panel sm:grid-cols-[140px_1fr_auto_18px] sm:px-2"><h3 className="text-sm font-semibold">{domain}</h3><p className="text-xs text-muted">{detail}</p><span className="text-[9px] uppercase tracking-wide text-dim">{state}</span><span aria-hidden="true" className="text-dim group-hover:text-gold2">→</span></Link>; }
