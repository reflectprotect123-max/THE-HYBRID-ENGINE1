import { useEffect, useMemo, useState } from 'react';
import { CoachSection } from './CoachSection';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import { useDb } from '../store/db';
import type { AthleteAutocoachReceipt, AthleteProgressionProposal } from './contracts';
import {
  applyApprovedProposal,
  proposalIsStale,
  type ProgressionDecision,
  type ProgressionProposal,
} from './progression';
import { appendProgressionDecision, useProgressionLedger } from './progression-store';

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
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

  async function decide(proposal: AthleteProgressionProposal, decision: 'approved' | 'declined') {
    if (!repository.decideProgressionProposal) return;
    setBusyId(proposal.id);
    try {
      await repository.decideProgressionProposal(clientId, proposal.id, decision);
      setProposals((current) => (current ?? []).filter((p) => p.id !== proposal.id));
      setMessage(`${proposal.subject}: ${decision}. ${clientName}'s device will apply this on its next sync.`);
    } catch {
      setMessage('The decision could not be recorded. Nothing has changed — try again.');
    } finally {
      setBusyId(null);
    }
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
              <div className="mt-1.5 flex flex-wrap gap-1">
                <button
                  type="button"
                  /* `hard` and `direction` are independent fields on
                     AthleteProgressionProposal -- the backend pairs
                     hard:true with direction:'review' today, but nothing
                     HERE enforces that invariant, so `hard` gates Approve
                     directly too, defence-in-depth. Pain/illness flags
                     outrank every other signal (CLAUDE.md); Approve must
                     never be one dropped invariant away from clickable on
                     a pain/illness-blocked proposal. */
                  disabled={proposal.direction === 'review' || proposal.hard || busyId === proposal.id}
                  onClick={() => decide(proposal, 'approved')}
                  className="rounded border border-gold-line bg-gold-wash px-1.5 py-0.5 text-xs font-semibold text-gold2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === proposal.id}
                  onClick={() => decide(proposal, 'declined')}
                  className="rounded border border-line2 bg-panel2 px-1.5 py-0.5 text-xs text-muted"
                >
                  Decline
                </button>
              </div>
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
      <div className="sr-only" aria-live="polite">{message}</div>
    </main>
  );
}

const DIRECTION_STYLE: Record<ProgressionProposal['direction'], string> = {
  increase: 'border-gold-line bg-gold-wash text-gold2',
  hold: 'border-line2 bg-panel2 text-muted',
  decrease: 'border-warn bg-panel2 text-warn',
  review: 'border-bad bg-panel2 text-bad',
};

function dateTime(at: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
}

function prescription(proposal: ProgressionProposal, side: 'before' | 'after'): string {
  if (proposal.domain === 'strength') {
    const value = proposal[side];
    if (!value || !('kg' in value)) return side === 'before' ? 'No accepted working weight' : 'Unknown';
    return `${value.kg} kg${value.reps ? ` × ${value.reps}` : ''}`;
  }
  const value = proposal[side];
  return `Level ${value.level} · ${value.miss} ${value.miss === 1 ? 'miss' : 'misses'} carried`;
}

export function CoachProgression() {
  const { selectedClient } = useCoachWorkspace();
  return selectedClient && selectedClient.source === 'roster-summary'
    ? <RosterProgressionView clientId={selectedClient.id} clientName={selectedClient.name} />
    : <SelfCoachProgressionView />;
}

function SelfCoachProgressionView() {
  const { settings, update, athleteState } = useDb();
  const ledger = useProgressionLedger();
  const [domain, setDomain] = useState<'all' | ProgressionProposal['domain']>('all');
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const decided = useMemo(() => new Set(ledger.decisions.map((event) => event.proposalId)), [ledger.decisions]);
  const pending = ledger.proposals.filter((proposal) => !decided.has(proposal.id));
  const visible = pending.filter((proposal) => domain === 'all' || proposal.domain === domain);
  const hardSafety = athleteState.constraints.filter((constraint) => constraint.hard);

  function decide(proposal: ProgressionProposal, decision: ProgressionDecision) {
    const rationale = rationales[proposal.id]?.trim() ?? '';
    if (!rationale) {
      setMessage(`Add a rationale before ${decision === 'approved' ? 'approving' : 'closing'} this proposal.`);
      return;
    }
    if (decision === 'approved') {
      if (proposal.direction === 'review') {
        setMessage('A safety-review proposal cannot be applied. Hold it and route the athlete for human review.');
        return;
      }
      try {
        update((draft) => {
          draft.settings = applyApprovedProposal(proposal, draft.settings);
          draft.settings.updatedAt = Date.now();
        });
        appendProgressionDecision(proposal.id, decision, rationale, true);
        setMessage(`${proposal.subject}: accepted prescription updated.`);
      } catch (error) {
        appendProgressionDecision(proposal.id, 'held', rationale, false, error instanceof Error ? error.message : 'Stale proposal');
        setMessage('The prescription changed after this proposal was created. It was held for a fresh review.');
      }
    } else {
      appendProgressionDecision(proposal.id, decision, rationale, false);
      setMessage(`${proposal.subject}: ${decision}. The accepted prescription was not changed.`);
    }
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-[1240px]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · decisions</p>
            <h1 className="mt-0.5 text-xl font-semibold">Strength and Conditioning decisions</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1240px] gap-2 p-2 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-2">
          <details className="border-y border-line2 py-2 text-xs text-muted">
            <summary className="cursor-pointer select-none font-medium text-text">Performance can propose. Only the coach can approve.</summary>
            <p className="mt-1 max-w-[82ch]">Completed work is never rewritten. Every increase, decrease or hold below is a separate local demonstration record with its own evidence, decision and rationale.</p>
          </details>

          {hardSafety.length > 0 && (
            <section className="rounded-md border border-bad bg-panel3 p-2" role="alert">
              <p className="text-[10px] uppercase tracking-wider text-bad">Safety takes priority</p>
              <h2 className="mt-0.5 text-sm font-semibold">Progression approval is not appropriate while a hard constraint is active.</h2>
              <ul className="mt-1 list-disc space-y-0.5 pl-2 text-xs text-muted">{hardSafety.map((constraint) => <li key={constraint.code}>{constraint.reason}</li>)}</ul>
            </section>
          )}

          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter progression proposals">
            {(['all', 'strength', 'conditioning'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={domain === value} onClick={() => setDomain(value)} className={`rounded border px-1.5 py-0.5 text-xs capitalize ${domain === value ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 bg-panel text-muted'}`}>{value}</button>
            ))}
          </div>

          <section aria-labelledby="pending-title">
            <div className="mb-1 flex items-baseline"><h2 id="pending-title" className="text-sm font-semibold">Pending review</h2><span className="ml-auto text-xs tabular-nums text-muted">{visible.length}</span></div>
            <div className="space-y-1.5">
              {visible.map((proposal) => (
                <article key={proposal.id} className="rounded-md border border-line2 bg-panel3">
                  <div className="flex flex-wrap items-start gap-1 border-b border-line px-2 py-1.5">
                    <div><p className="text-[10px] uppercase tracking-wider text-dim">{proposal.domain} · {dateTime(proposal.sourceAt)}</p><h3 className="text-sm font-semibold">{proposal.subject}</h3></div>
                    <span className={`ml-auto rounded-full border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${DIRECTION_STYLE[proposal.direction]}`}>{proposal.direction === 'increase' ? 'approval required' : proposal.direction}</span>
                  </div>
                  <div className="grid gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-1.5 text-xs">
                      <Fact label="Status" value={proposalIsStale(proposal, settings) ? 'Stale — prescription changed' : 'Pending coach decision'} />
                      <Fact label="Intent" value={proposal.intent} />
                      <div><p className="text-[10px] uppercase tracking-wide text-dim">Change</p><div className="mt-0.5 grid grid-cols-[1fr_auto_1fr] items-center gap-1 rounded border border-line bg-panel p-1"><span>{prescription(proposal, 'before')}</span><span aria-hidden="true" className="text-gold">→</span><strong>{prescription(proposal, 'after')}</strong></div></div>
                      <Fact label="Reason" value={proposal.reason} />
                      <div><p className="text-[10px] uppercase tracking-wide text-dim">Evidence</p><ul className="mt-0.5 list-disc space-y-0.5 pl-2 text-muted">{proposal.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      {proposal.dataLimitations.length > 0 && <Fact label="Limitations" value={proposal.dataLimitations.join(' ')} />}
                    </div>
                    <div className="rounded border border-line bg-panel p-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-dim" htmlFor={`rationale-${proposal.id}`}>Coach rationale</label>
                      <textarea id={`rationale-${proposal.id}`} value={rationales[proposal.id] ?? ''} onChange={(event) => setRationales((current) => ({ ...current, [proposal.id]: event.target.value }))} rows={4} className="mt-0.5 w-full resize-y rounded border border-line bg-well p-1 text-xs text-text outline-none focus:border-gold-line" placeholder="Why is this the right next decision?" />
                      <p className="mt-0.5 text-[10px] text-dim">Next: approve, reject, or hold. This demo ledger stays on this device.</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <button type="button" disabled={proposal.direction === 'review' || proposalIsStale(proposal, settings) || hardSafety.length > 0} onClick={() => decide(proposal, 'approved')} className="rounded border border-gold-line bg-gold-wash px-1.5 py-0.5 text-xs font-semibold text-gold2 disabled:cursor-not-allowed disabled:opacity-40">Approve</button>
                        <button type="button" onClick={() => decide(proposal, 'rejected')} className="rounded border border-line2 bg-panel2 px-1.5 py-0.5 text-xs text-muted">Reject</button>
                        <button type="button" onClick={() => decide(proposal, 'held')} className="rounded border border-line2 bg-panel2 px-1.5 py-0.5 text-xs text-muted">Hold</button>
                      </div>
                    </div>
                  </div>
                  <footer className="border-t border-line px-2 py-1 text-[10px] text-dim">Authority: coach approval required · Rule: {proposal.ruleVersion} · Confidence: {proposal.confidence}</footer>
                </article>
              ))}
              {visible.length === 0 && <div className="rounded-md border border-dashed border-line2 bg-panel3 p-3 text-center"><h3 className="text-sm font-semibold">No pending {domain === 'all' ? '' : `${domain} `}proposals</h3><p className="mt-0.5 text-xs text-muted">Complete a session to create a reviewable proposal. Existing accepted prescriptions remain unchanged.</p></div>}
            </div>
          </section>
        </div>

        <aside className="space-y-2 xl:sticky xl:top-[58px] xl:self-start">
          <CoachSection eyebrow="History" title="Decision history" count={ledger.decisions.length}>
            <div className="space-y-1">
              {ledger.decisions.slice(0, 12).map((event) => {
                const proposal = ledger.proposals.find((item) => item.id === event.proposalId);
                return (
                  <article key={event.id} className="rounded border border-line bg-panel p-1">
                    <div className="flex items-baseline gap-1"><strong className="text-xs">{proposal?.subject ?? 'Proposal'}</strong><span className="ml-auto text-[10px] uppercase tracking-wide text-muted">{event.decision}</span></div>
                    <p className="mt-0.5 text-[11px] text-muted">{event.rationale}</p>
                    <p className="mt-0.5 text-[10px] text-dim">{dateTime(event.decidedAt)} · {event.applied ? 'prescription updated' : 'no prescription change'}</p>
                    {event.note && <p className="mt-0.5 text-[10px] text-warn">{event.note}</p>}
                  </article>
                );
              })}
              {ledger.decisions.length === 0 && <p className="text-xs text-muted">No coach decision has been recorded yet.</p>}
            </div>
          </CoachSection>

          <CoachSection eyebrow="Implemented boundary" title="What this screen does and does not do">
            <p className="text-[11px] text-dim">This is real front-end decision logic and local demo persistence. It is not server authorization, a durable audit trail, or multi-device sync.</p>
          </CoachSection>
        </aside>
      </div>
      <div className="sr-only" aria-live="polite">{message}</div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] uppercase tracking-wide text-dim">{label}</p><p className="mt-0.5 text-muted">{value}</p></div>;
}
