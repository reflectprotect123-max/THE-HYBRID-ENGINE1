import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CoachSection } from './CoachSection';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import type { AthleteAutocoachReceipt, AthleteProgressionProposal } from './contracts';
import { RosterProgressionActions } from './progression-actions';

const ROSTER_DIRECTION_STYLE: Record<AthleteProgressionProposal['direction'], string> = {
  increase: 'border-gold-line bg-gold-wash text-gold2',
  hold: 'border-line2 bg-panel2 text-muted',
  decrease: 'border-warn bg-panel2 text-warn',
  review: 'border-bad bg-panel2 text-bad',
};

/* No exercise name, no free-text before/after — see AthleteAutocoachReceipt's
   doc comment. A label per ActionType is all there is to show. */
const OPERATION_LABEL: Record<string, string> = {
  keep_as_planned: 'Kept as planned',
  cap_intensity: 'Capped intensity',
  trim_conditioning_minutes: 'Trimmed conditioning minutes',
  hold_progression: 'Held progression',
  rest_or_pause: 'Rest or pause',
  ask_for_clarification: 'Asked for clarification',
};

function rosterPrescription(value: Record<string, unknown> | null): string {
  if (!value) return 'No accepted baseline';
  if (typeof value.kg === 'number') return `${value.kg} kg${typeof value.reps === 'number' ? ` × ${value.reps}` : ''}`;
  if (typeof value.level === 'number') return `Level ${value.level}${typeof value.miss === 'number' ? ` · ${value.miss} miss` : ''}`;
  return 'Unknown shape';
}

/**
 * The REAL roster view. Deliberately much thinner than the self-coach panel
 * below: this tier of the backend carries no free-text `reason`, `evidence`
 * or `intent` — those are stripped at the source (see
 * docs/ARC_LAYER3_DESIGN.md §4 finding 5) — and "Approve" here never
 * touches a prescription directly. It writes a decision the athlete's OWN
 * device reads on its next sync and applies itself, through the unmodified
 * engine path. There is no local mutation to roll back if it's wrong.
 */
function RosterProgressionView({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { repository } = useCoachWorkspace();
  const [proposals, setProposals] = useState<readonly AthleteProgressionProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<readonly AthleteAutocoachReceipt[] | null>(null);

  useEffect(() => {
    let active = true;
    setProposals(null);
    setError(null);
    /* `?.()` alone short-circuits to `undefined` when the repository doesn't
       implement this — chaining `.then` on that throws, not degrades. An
       older build or the mock repository must show "not available", not
       crash the screen. */
    if (!repository.listProgressionProposals) { setProposals([]); return; }
    repository.listProgressionProposals(clientId)
      .then((rows) => { if (active) setProposals(rows); })
      .catch(() => { if (active) setError('Proposals could not be loaded.'); });
    return () => { active = false; };
  }, [repository, clientId]);

  useEffect(() => {
    let active = true;
    setReceipts(null);
    (repository.listAutocoachReceipts?.(clientId) ?? Promise.resolve([]))
      .then((rows) => { if (active) setReceipts(rows); })
      .catch(() => { if (active) setReceipts([]); });
    return () => { active = false; };
  }, [repository, clientId]);

  function onDecided(proposalId: string) {
    setProposals((current) => (current ?? []).filter((p) => p.id !== proposalId));
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-[1240px]">
          <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · decisions</p>
          <h1 className="mt-0.5 text-xl font-semibold">{clientName}&rsquo;s pending proposals</h1>
          <p className="mt-0.5 text-xs text-muted">
            A coach decision here never edits {clientName}&rsquo;s prescription directly. It writes a
            receipt their own device reads and applies on its next sync.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] space-y-1.5 p-2">
        {error && <p className="rounded border border-bad/50 bg-panel3 p-2 text-xs text-bad">{error}</p>}
        {proposals === null && !error && <p className="p-2 text-xs text-muted">Loading…</p>}
        {proposals?.map((proposal) => (
          <article key={proposal.id} className="rounded-md border border-line2 bg-panel3">
            <div className="flex flex-wrap items-start gap-1 border-b border-line px-2 py-1.5">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-dim">
                  {proposal.domain} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(proposal.createdAt))}
                </p>
                <h3 className="text-sm font-semibold">{proposal.subject}</h3>
              </div>
              <span className={`ml-auto rounded-full border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ROSTER_DIRECTION_STYLE[proposal.direction]}`}>
                {proposal.direction === 'increase' ? 'approval required' : proposal.direction}
              </span>
            </div>
            <div className="p-2 text-xs">
              {proposal.hard && (
                <p className="mb-1 rounded border border-bad/50 bg-panel p-1 text-[11px] text-bad">
                  A pain or illness hold was active when this was computed. Route {clientName} for direct review before approving.
                </p>
              )}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 rounded border border-line bg-panel p-1">
                <span>{rosterPrescription(proposal.before)}</span>
                <span aria-hidden="true" className="text-gold">→</span>
                <strong>{rosterPrescription(proposal.after)}</strong>
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-dim">Confidence</p>
              <p className="text-muted">{proposal.confidence}</p>
              <RosterProgressionActions clientId={clientId} clientName={clientName} proposal={proposal} onDecided={onDecided} />
            </div>
          </article>
        ))}
        {proposals?.length === 0 && (
          <div className="rounded-md border border-dashed border-line2 bg-panel3 p-3 text-center">
            <h3 className="text-sm font-semibold">No pending proposals for {clientName}</h3>
          </div>
        )}

        {receipts && receipts.length > 0 && (
          <CoachSection eyebrow="Autonomy · read-only" title={`What the system adjusted for ${clientName}`} count={receipts.length}>
            <p className="text-[11px] text-muted">
              Auto-Coach changed a session automatically, before {clientName} started it, using
              whole-athlete-state's constraints as its input. Nothing here is editable — it is a record of
              what already happened locally on their device.
            </p>
            <div className="mt-1 space-y-1">
              {receipts.map((receipt) => (
                <article key={receipt.clientEntryId} className="rounded border border-line bg-panel p-1.5 text-xs">
                  <div className="flex flex-wrap items-baseline gap-1">
                    <span className="font-medium">
                      {receipt.action === 'undone' ? 'Undone' : receipt.wasForked ? 'Forked a copy' : 'Adjusted in place'}
                    </span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-dim">
                      {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(receipt.occurredAt))}
                    </span>
                  </div>
                  {receipt.operations.map((op, i) => (
                    <p key={i} className="mt-0.5 text-[11px] text-muted">
                      {OPERATION_LABEL[op.type] ?? op.type} at {op.targetPath || 'session level'}
                      {' '}<span className="text-dim">({op.materiality} · {op.reasonCode.replaceAll('_', ' ')})</span>
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </CoachSection>
        )}
      </div>
    </main>
  );
}

/**
 * Stage-1 coach redesign (11 August 2026, Task 7): narrowed to the ONE job
 * the pillar screens cannot do. The self-coach ledger view this used to
 * render (`SelfCoachProgressionView`, approving via `ProgressionActions`) is
 * gone from this file, not merely hidden — it is what the Strength and
 * Conditioning pillar queues now render, reading the same
 * `useProgressionLedger()` and mounting the same `ProgressionActions` from
 * `progression-actions.tsx`. That is a move, not a duplication: this screen
 * and the pillars must never both own a live copy of the self-coach decision
 * path.
 *
 * A signed-in coach (`isLocalClient`) hitting `/coach/progression` directly —
 * an old bookmark, a stale link — is redirected to the pillar that now owns
 * their view. A roster client stays here: `RosterProgressionView` is the
 * only place in the app RosterProgressionActions is mounted, because the
 * pillars are gated WITHOUT `layer3Ready` and refuse a roster client by
 * design (they read the signed-in athlete's own local stores). See the
 * amendment in the Task 7 brief for why this route survives instead of
 * retiring.
 */
export function CoachProgression() {
  const { selectedClient, loading } = useCoachWorkspace();
  /*
   * `clients` is empty on the first paint, so `selectedClient` is null and
   * `isLocalClient` below is TRUE for everyone — including a roster coach.
   * That never showed while the rail linked here (the click happened after
   * the fetch), but the owner removed that link on 11 August 2026, so the
   * only way in is now the address bar, and by address this redirected a
   * roster coach to /coach/strength before their own client had loaded.
   * Roster approve/decline — the only one in the app — was unreachable in
   * practice, not merely unlinked. Wait for the load rather than deciding
   * from a state that is not yet an answer.
   */
  if (loading) return <p className="p-4 text-xs text-dim" role="status">Loading…</p>;
  const isLocalClient = !selectedClient || selectedClient.source === 'engine-local';
  if (isLocalClient) return <Navigate to="/coach/strength" replace />;
  return <RosterProgressionView clientId={selectedClient.id} clientName={selectedClient.name} />;
}
