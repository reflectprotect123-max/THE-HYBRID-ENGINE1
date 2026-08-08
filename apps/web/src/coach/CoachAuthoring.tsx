import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { uid, type Workout } from '@hybrid/engine';
import {
  buildWeeklyPlanFromProposals,
  proposalsFromDB,
  type SessionProposal,
} from '@hybrid/coordinator-adapter';
import { useDb } from '../store/db';
import { applyProposalInputs, defaultProposalInput, type ProposalInput } from './authoring';
import { setProposalInput, useAuthoringInputs } from './authoring-store';

const DAYS = [
  { value: 1, short: 'M', label: 'Monday' },
  { value: 2, short: 'T', label: 'Tuesday' },
  { value: 3, short: 'W', label: 'Wednesday' },
  { value: 4, short: 'T', label: 'Thursday' },
  { value: 5, short: 'F', label: 'Friday' },
  { value: 6, short: 'S', label: 'Saturday' },
  { value: 7, short: 'S', label: 'Sunday' },
];

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function readableDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

function proposalInput(proposal: SessionProposal, inputs: ReturnType<typeof useAuthoringInputs>): ProposalInput {
  return inputs[proposal.id] ?? defaultProposalInput(proposal);
}

export function CoachAuthoring() {
  const { db, update, athleteState } = useDb();
  const inputs = useAuthoringInputs();
  const navigate = useNavigate();
  const today = isoToday();
  const baseProposals = useMemo(() => proposalsFromDB(db), [db]);
  const proposals = useMemo(() => applyProposalInputs(baseProposals, inputs), [baseProposals, inputs]);
  const plan = useMemo(
    () => buildWeeklyPlanFromProposals(db, athleteState, today, proposals),
    [athleteState, db, proposals, today],
  );
  const titleById = useMemo(
    () => new Map(baseProposals.map((proposal) => [proposal.id, proposal.title])),
    [baseProposals],
  );

  function createWorkout(kind: 'strength' | 'conditioning') {
    const workout: Workout = {
      id: uid(),
      kind,
      name: kind === 'strength' ? 'New strength session' : 'New conditioning session',
      blocks: [],
      updatedAt: Date.now(),
    };
    update((draft) => {
      draft.workouts.push(workout);
    });
    navigate(`/coach/build/${workout.id}?returnTo=${encodeURIComponent('/coach/author')}`);
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-[1240px]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · plan</p>
            <h1 className="mt-0.5 text-xl font-semibold">Build the inputs. Let the Coordinator build the week.</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1240px] gap-2 p-2 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-2">
          <details className="border-y border-line2 py-2 text-xs text-muted">
            <summary className="cursor-pointer select-none font-medium text-text">How plan authority works</summary>
            <p className="mt-1 max-w-[80ch]">
              Strength and Conditioning author their own sessions. These controls steer proposal inputs only—there is
              no resolved-date editor. Pain and illness still outrank every preference below.
            </p>
          </details>

          {(['strength', 'conditioning'] as const).map((domain) => {
            const domainProposals = baseProposals.filter((proposal) => proposal.domain === domain);
            return (
              <section key={domain} className="rounded-md border border-line2 bg-panel3" aria-labelledby={`${domain}-title`}>
                <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-dim">Specialist engine</p>
                    <h2 id={`${domain}-title`} className="text-sm font-semibold capitalize">{domain}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => createWorkout(domain)}
                    className="ml-auto rounded border border-gold-line bg-gold-wash px-1.5 py-0.5 text-xs font-medium text-gold2"
                  >
                    Build {domain} session
                  </button>
                </div>
                <div className="grid gap-1.5 p-1.5 lg:grid-cols-2">
                  {domainProposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      input={proposalInput(proposal, inputs)}
                      onChange={(next) => setProposalInput(proposal.id, next)}
                      onEdit={() => navigate(`/coach/planner/${proposal.id}?returnTo=${encodeURIComponent('/coach/author')}`)}
                    />
                  ))}
                  {domainProposals.length === 0 && (
                    <div className="rounded border border-dashed border-line2 p-3 text-center text-xs text-muted lg:col-span-2">
                      No {domain} workout exists yet. Build one inside the ARC coach authoring flow.
                    </div>
                  )}
                </div>
              </section>
            );
          })}

          <section className="rounded-md border border-line2 bg-panel3" aria-labelledby="nutrition-system-title">
            <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-dim">Context engine · separate authority</p>
                <h2 id="nutrition-system-title" className="text-sm font-semibold">Nutrition</h2>
              </div>
              <Link className="ml-auto rounded border border-line2 bg-panel px-1.5 py-0.5 text-xs text-muted hover:text-text" to="/coach/nutrition">
                Review nutrition
              </Link>
            </div>
            <div className="p-2">
              <p className="max-w-[78ch] text-xs text-muted">
                Nutrition has its own prescription engine, records and sync partition. It can contribute read-only
                context to review, but it never becomes a session proposal and never schedules, drops or edits the
                resolved training week.
              </p>
            </div>
          </section>
        </div>

        <aside className="space-y-2 xl:sticky xl:top-[58px] xl:self-start">
          <section className="overflow-hidden rounded-md border border-line2 bg-panel3" aria-labelledby="resolution-title">
            <div className="border-b border-line px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-gold">Coordinator output</p>
              <h2 id="resolution-title" className="text-sm font-semibold">Week of {readableDate(plan.weekStart)}</h2>
              <p className="mt-0.5 text-[11px] text-muted">{plan.entries.length} scheduled · {plan.decisions.filter((decision) => decision.action === 'dropped').length} held back</p>
            </div>
            <div className="p-1.5">
              <h3 className="text-[10px] uppercase tracking-wider text-dim">Resolved sessions</h3>
              <div className="mt-0.5 space-y-1">
                {plan.entries.map((entry) => (
                  <article key={entry.id} className="rounded border border-line bg-panel p-1">
                    <div className="flex items-baseline gap-1"><span className="text-xs font-medium">{entry.title}</span><span className="ml-auto text-[10px] tabular-nums text-muted">{readableDate(entry.date)}</span></div>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-dim">{entry.domain} · {entry.effort}</p>
                  </article>
                ))}
                {plan.entries.length === 0 && <p className="py-2 text-xs text-muted">No session was placed. Review safety, availability and proposal inputs.</p>}
              </div>
              <h3 className="mt-1.5 text-[10px] uppercase tracking-wider text-dim">Held proposals</h3>
              <div className="mt-0.5 space-y-1">
                {plan.decisions.filter((decision) => decision.action === 'dropped').map((decision) => (
                  <article key={`${decision.proposalId}:${decision.reasonCode}`} className="rounded border border-line bg-panel p-1">
                    <div className="flex items-baseline gap-1"><span className="text-xs font-medium">{titleById.get(decision.proposalId) ?? 'Proposal'}</span><span className="ml-auto text-[10px] uppercase tracking-wide text-warn">{decision.reasonCode.replaceAll('_', ' ')}</span></div>
                    <p className="mt-0.5 text-[11px] text-muted">{decision.explanation}</p>
                  </article>
                ))}
                {!plan.decisions.some((decision) => decision.action === 'dropped') && <p className="py-1 text-xs text-muted">Nothing was held back in this resolution.</p>}
              </div>
            </div>
          </section>

          <section className="rounded-md border border-line2 bg-panel3 p-2">
            <p className="text-[10px] uppercase tracking-wider text-warn">Persistence status</p>
            <p className="mt-0.5 text-xs text-muted">Workout structure uses the real synced EngineDB path. Coach proposal inputs are local-only in this phase and are not a published server plan.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function ProposalCard({
  proposal,
  input,
  onChange,
  onEdit,
}: {
  proposal: SessionProposal;
  input: ProposalInput;
  onChange: (next: ProposalInput) => void;
  onEdit: () => void;
}) {
  const patch = (change: Partial<ProposalInput>) => onChange({ ...input, ...change });
  return (
    <article className={`rounded-md border bg-panel p-1.5 ${input.enabled ? 'border-line2' : 'border-line opacity-70'}`}>
      <div className="flex items-start gap-1">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{proposal.title}</h3>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-dim">{proposal.tags.join(' · ')} · engine {proposal.sourceEngineVersion}</p>
        </div>
        <label className="ml-auto flex items-center gap-0.5 text-[11px] text-muted">
          <input type="checkbox" checked={input.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
          Propose
        </label>
      </div>

      <div className="mt-1 grid grid-cols-3 gap-1">
        <label className="text-[10px] uppercase tracking-wide text-dim">Priority
          <select className="mt-0.5 w-full rounded border border-line2 bg-panel3 px-0.5 py-0.5 text-xs normal-case tracking-normal text-text" value={input.priority} onChange={(event) => patch({ priority: event.target.value as ProposalInput['priority'] })}>
            <option value="must">Must</option><option value="preferred">Preferred</option><option value="optional">Optional</option>
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wide text-dim">Effort
          <select className="mt-0.5 w-full rounded border border-line2 bg-panel3 px-0.5 py-0.5 text-xs normal-case tracking-normal text-text" value={input.effort} onChange={(event) => patch({ effort: event.target.value as ProposalInput['effort'] })}>
            <option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option>
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wide text-dim">Minutes
          <input className="mt-0.5 w-full rounded border border-line2 bg-panel3 px-0.5 py-0.5 text-xs normal-case tracking-normal text-text" type="number" min={5} max={240} step={5} value={input.durationMinutes} onChange={(event) => patch({ durationMinutes: Number(event.target.value) || 5 })} />
        </label>
      </div>

      <fieldset className="mt-1">
        <legend className="text-[10px] uppercase tracking-wide text-dim">Preferred days · input, not placement</legend>
        <div className="mt-0.5 grid grid-cols-7 gap-0.5">
          {DAYS.map((day) => {
            const selected = input.preferredWeekdays.includes(day.value);
            return (
              <label key={day.value} title={day.label} className={`grid min-h-6 place-items-center rounded border text-[11px] ${selected ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 text-muted'}`}>
                <input
                  className="sr-only"
                  type="checkbox"
                  aria-label={day.label}
                  checked={selected}
                  onChange={() => patch({ preferredWeekdays: selected ? input.preferredWeekdays.filter((value) => value !== day.value) : [...input.preferredWeekdays, day.value] })}
                />
                {day.short}
              </label>
            );
          })}
        </div>
      </fieldset>

      <button type="button" onClick={onEdit} className="mt-1 w-full rounded border border-line2 bg-panel3 px-1 py-0.5 text-xs text-muted hover:text-text">
        Edit workout structure
      </button>
    </article>
  );
}
