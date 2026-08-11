import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReadinessBand } from '@hybrid/whole-athlete-state';
import { useDb } from '../store/db';
import { useNutrition } from '../store/nutrition';
import { buildCoachNutritionReview } from './nutrition-review';
import { useProgressionLedger } from '../store/progression';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import type { AthleteNutritionSummary, AthleteProgressionProposal, ClientSummary } from './contracts';
import './coach-redesign.css';

/*
 * The mockup's launcher (`<section id="view-command">`), ported to JSX. Every
 * heavy section the old Command Center rendered below the tiles — the
 * decision queue, the collapsed overview, the per-domain rows, `<AthleteStatus
 * />`, the resolved-week list — moves to the four pillar screens under
 * `/coach/{readiness,strength,conditioning,nutrition}` (Tasks 3-6, routed in
 * Task 7). This file's only remaining local-only reads are the readiness band
 * and the nutrition exception count — both still gated behind
 * `isLocalClient`, per the same "never render the coach's own records under a
 * client's name" rule the rest of the coach bench follows.
 */

interface ClientSnapshot {
  id: string;
  name: string;
  block: string;
  week: string;
  source: ClientSummary['source'];
}

function toSnapshot(client: ClientSummary): ClientSnapshot {
  return {
    id: client.id,
    name: client.name,
    block: client.assignment?.programName ?? 'No active assignment',
    week: client.assignment ? `Week ${client.assignment.currentWeek} of ${client.assignment.totalWeeks}` : 'Unassigned',
    source: client.source,
  };
}

/** The mockup's readiness-band → dot-colour mapping. `--ok`/`--warn`/`--bad`/
 *  `--dim` are the mockup's bare names; tokens.css carries the same values
 *  under `--color-*` (see coach-redesign.css's header comment). */
function readinessDotColor(band: ReadinessBand): string {
  switch (band) {
    case 'high':
      return 'var(--color-ok)';
    case 'moderate':
      return 'var(--color-warn)';
    case 'low':
      return 'var(--color-bad)';
    default:
      return 'var(--color-dim)';
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function mondayOf(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy.toISOString().slice(0, 10);
}

export function CoachCommandCenter() {
  const { clients: clientContracts, selectedClient: selectedContract, selectClient, loading: clientsLoading, error: clientsError, repository } = useCoachWorkspace();
  const clients = useMemo(() => clientContracts.map(toSnapshot), [clientContracts]);
  const selectedClient = selectedContract ? toSnapshot(selectedContract) : null;
  const { athleteState } = useDb();
  const progressionLedger = useProgressionLedger();
  const { nutrition } = useNutrition();
  const nutritionReview = useMemo(() => buildCoachNutritionReview(nutrition, today()), [nutrition]);
  const weekStart = useMemo(() => mondayOf(new Date()), []);
  const [rosterProposals, setRosterProposals] = useState<readonly AthleteProgressionProposal[]>([]);
  const [rosterNutritionSummary, setRosterNutritionSummary] = useState<AthleteNutritionSummary | null>(null);
  const rosterClientId = selectedContract && selectedContract.source !== 'engine-local' ? selectedContract.id : null;
  useEffect(() => {
    let active = true;
    setRosterProposals([]);
    setRosterNutritionSummary(null);
    if (!rosterClientId) return;
    /* `?.()` alone short-circuits to `undefined` when unimplemented (an
       older build, or the mock repository) — chaining `.then` on that
       throws rather than degrading. `?? Promise.resolve(...)` substitutes
       the same "not available" fallback every other branch already renders. */
    (repository.listProgressionProposals?.(rosterClientId) ?? Promise.resolve([] as readonly AthleteProgressionProposal[]))
      .then((v) => { if (active) setRosterProposals(v); }).catch(() => { if (active) setRosterProposals([]); });
    (repository.getNutritionSummary?.(rosterClientId, weekStart) ?? Promise.resolve(null))
      .then((v) => { if (active) setRosterNutritionSummary(v); }).catch(() => { if (active) setRosterNutritionSummary(null); });
    return () => { active = false; };
  }, [repository, rosterClientId, weekStart]);
  const rosterStrengthPending = rosterProposals.filter((proposal) => proposal.domain === 'strength').length;
  const rosterConditioningPending = rosterProposals.filter((proposal) => proposal.domain === 'conditioning').length;
  const decided = useMemo(
    () => new Set(progressionLedger.decisions.map((decision) => decision.proposalId)),
    [progressionLedger.decisions],
  );
  const pendingProgression = progressionLedger.proposals.filter((proposal) => !decided.has(proposal.id));
  const strengthPending = pendingProgression.filter((proposal) => proposal.domain === 'strength').length;
  const conditioningPending = pendingProgression.filter((proposal) => proposal.domain === 'conditioning').length;

  if (clientsLoading || !selectedClient) return <main className="rd-content" aria-busy="true">Loading coach workspace…</main>;
  if (clientsError) return <main className="rd-content" role="alert">{clientsError}</main>;

  // The one flag every local-only read below gates on. `athleteState` (from
  // useDb()) and `nutritionReview` (from useNutrition()) are the SIGNED-IN
  // account's own — real and correct only for this client. Rendering them
  // for any other selection is the exact failure named in the handoff:
  // "renders the coach's own records under a client's name."
  const isLocalClient = selectedClient.source === 'engine-local';

  const readinessBand: ReadinessBand = isLocalClient ? athleteState.readiness.band : 'unknown';
  const strengthCount = isLocalClient ? strengthPending : rosterStrengthPending;
  const conditioningCount = isLocalClient ? conditioningPending : rosterConditioningPending;
  const nutritionExceptionCount = isLocalClient ? nutritionReview.exceptions.length : null;
  const nutritionStatus = isLocalClient
    ? `${nutritionExceptionCount} exception${nutritionExceptionCount === 1 ? '' : 's'}`
    : rosterNutritionSummary
      ? `${rosterNutritionSummary.loggedDays}/${rosterNutritionSummary.windowDays} days logged`
      : 'Not available';
  const nutritionWarn = isLocalClient && (nutritionExceptionCount ?? 0) > 0;

  return (
    <div className="rd-content">
      <div className="rd-client-row">
        <select
          className="rd-select"
          aria-label="Select client"
          value={selectedClient.id}
          onChange={(event) => selectClient(event.target.value)}
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
              {client.source === 'engine-local' ? ' (you)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="rd-identity">
        <h1>{selectedClient.name}</h1>
        <span className="week">{selectedClient.block} · {selectedClient.week}</span>
      </div>

      <div className="rd-tiles">
        <Link to="/coach/readiness" className="rd-tile">
          <span className="t-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.8 8.6c0 5.6-8.8 10.6-8.8 10.6S3.2 14.2 3.2 8.6a4.8 4.8 0 0 1 8.8-2.7 4.8 4.8 0 0 1 8.8 2.7z" />
              <path d="M7 12h2.2l1.3-2.6 1.6 4.6 1.2-2h2.7" />
            </svg>
          </span>
          <span className="t-body">
            <p className="t-eyebrow">Athlete state</p>
            <span className="t-row">
              <span className="t-name">Readiness</span>
              <span className="t-band" style={{ color: readinessDotColor(readinessBand), textTransform: 'capitalize' }}>
                <span className="t-dot" />
                {readinessBand}
              </span>
            </span>
          </span>
          <svg className="t-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>

        <Link to="/coach/strength" className="rd-tile">
          <span className="t-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="4.5" cy="12" r="2.5" />
              <circle cx="19.5" cy="12" r="2.5" />
              <line x1="7" y1="12" x2="17" y2="12" />
              <line x1="2" y1="10" x2="2" y2="14" />
              <line x1="22" y1="10" x2="22" y2="14" />
            </svg>
          </span>
          <span className="t-body">
            <p className="t-eyebrow">Specialist input</p>
            <span className="t-row">
              <span className="t-name">Strength</span>
              <span className="t-band" style={{ color: 'var(--color-gold2)' }}>
                <span className="t-dot" />
                {strengthCount} pending
              </span>
            </span>
          </span>
          <svg className="t-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>

        <Link to="/coach/conditioning" className="rd-tile">
          <span className="t-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l3 2" />
              <path d="M9 2h6" />
              <path d="M12 2v3" />
            </svg>
          </span>
          <span className="t-body">
            <p className="t-eyebrow">Specialist input</p>
            <span className="t-row">
              <span className="t-name">Conditioning</span>
              <span className="t-band" style={{ color: 'var(--color-bad)' }}>
                <span className="t-dot" />
                {conditioningCount} pending
              </span>
            </span>
          </span>
          <svg className="t-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>

        <Link to="/coach/nutrition" className="rd-tile">
          <span className="t-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 3c-2.5 0-4.5 2.5-4.5 6 0 2.5 1.2 4 2.2 5.2C16.6 15.4 17 17 17 19c0 1.1.9 2 2 2s2-.9 2-2c0-5-1-8-1-11 0-2.5-1-5-2-5z" />
              <path d="M7 2c-.6 1.5-1 3-1 5 0 2 .8 3.5 2 4.5V22" transform="translate(-1)" />
              <path d="M6 2v6M9 2v6M6 8h3" />
            </svg>
          </span>
          <span className="t-body">
            <p className="t-eyebrow">Context engine</p>
            <span className="t-row">
              <span className="t-name">Nutrition</span>
              <span className={`t-band t-badge${nutritionWarn ? ' warn' : ''}`}>{nutritionStatus}</span>
            </span>
          </span>
          <svg className="t-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
