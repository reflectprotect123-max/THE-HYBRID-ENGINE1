import { useState } from 'react';
import { useDb } from '../../store/db';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import type { AthleteProgressionProposal } from '../data/contracts';
import {
  applyApprovedProposal,
  proposalIsStale,
  type ProgressionDecision,
  type ProgressionProposal,
} from '../../lib/progression';
import { appendProgressionDecision } from '../../store/progression';

/*
 * The app's only two approve/decline implementations, moved here unchanged
 * from `CoachProgression.tsx` (Task 6b). Task 7 (amended) narrows that
 * screen to roster-only instead of deleting it — its self-coach branch is
 * gone, replaced there by a redirect to `/coach/strength` — so
 * `CoachProgression.tsx` now imports both components below instead of
 * keeping its own copy. Both pillar queues (`pillars/Strength.tsx`,
 * `pillars/Conditioning.tsx`) mount `ProgressionActions` — the self-coach
 * path, the only one they have a proposal shape and context for. See this
 * file's header comment on `ProgressionActions` for why: the pillars read
 * `useProgressionLedger()` (`ProgressionProposal`, self-coach), never
 * `useCoachWorkspace().repository.listProgressionProposals` (roster,
 * `AthleteProgressionProposal`) — so `RosterProgressionActions` has no
 * pillar to mount in today. It still moved out of `CoachProgression.tsx`
 * alongside `ProgressionActions`, because that screen lost its self-coach
 * half regardless of which proposal shape a decision path uses;
 * `RosterProgressionActions` remains mounted only at
 * `CoachProgression.tsx`'s `RosterProgressionView` — the roster half that
 * survives.
 *
 * Every guard below is copied, not re-derived: same conditions, same
 * disabled expressions, same messages. This is a move, not a rewrite.
 */

/**
 * The self-coach decision actions — extracted from
 * `SelfCoachProgressionView.decide` (`CoachProgression.tsx`, formerly around
 * line 245). Reads/writes the same local stores that view always did
 * (`useDb()`'s `settings`/`update`/`athleteState`, the progression ledger),
 * so mounting this inside a pillar's `.rd-queue-item` is not a second
 * decision path — it is the same one, in a different card.
 *
 * Four things can block a decision here, unchanged from before extraction:
 *  1. A `review`-direction proposal can never be approved.
 *  2. An active hard whole-athlete-state constraint blocks Approve — checked
 *     live against `athleteState.constraints`, not baked into the proposal.
 *  3. A stale proposal (the accepted prescription changed since this was
 *     computed) blocks Approve — checked live via `proposalIsStale`, and
 *     re-checked inside `applyApprovedProposal` itself as a race backstop:
 *     if the prescription changes between render and click, the write is
 *     still refused and the decision is recorded as `held`, not `approved`.
 *  4. No decision — approve, reject, OR hold — is recorded without a
 *     rationale. The Coordinator never sees this; it stays a local demo
 *     ledger entry, but the requirement is real.
 */
export function ProgressionActions({ proposal }: { proposal: ProgressionProposal }) {
  const { settings, update, athleteState } = useDb();
  const [rationale, setRationale] = useState('');
  const [message, setMessage] = useState('');
  const hardSafety = athleteState.constraints.filter((constraint) => constraint.hard);
  const stale = proposalIsStale(proposal, settings);

  function decide(decision: ProgressionDecision) {
    const trimmed = rationale.trim();
    if (!trimmed) {
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
        appendProgressionDecision(proposal.id, decision, trimmed, true);
        setMessage(`${proposal.subject}: accepted prescription updated.`);
      } catch (error) {
        appendProgressionDecision(proposal.id, 'held', trimmed, false, error instanceof Error ? error.message : 'Stale proposal');
        setMessage('The prescription changed after this proposal was created. It was held for a fresh review.');
      }
    } else {
      appendProgressionDecision(proposal.id, decision, trimmed, false);
      setMessage(`${proposal.subject}: ${decision}. The accepted prescription was not changed.`);
    }
  }

  return (
    <div className="mt-1.5">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-dim" htmlFor={`rationale-${proposal.id}`}>
        Coach rationale
      </label>
      <textarea
        id={`rationale-${proposal.id}`}
        value={rationale}
        onChange={(event) => setRationale(event.target.value)}
        rows={2}
        className="mt-0.5 w-full resize-y rounded border border-line bg-well p-1 text-xs text-text outline-none focus:border-gold-line"
        placeholder="Why is this the right next decision?"
      />
      <div className="mt-1 flex flex-wrap gap-1">
        <button
          type="button"
          disabled={proposal.direction === 'review' || stale || hardSafety.length > 0}
          onClick={() => decide('approved')}
          className="rounded border border-gold-line bg-gold-wash px-1.5 py-0.5 text-xs font-semibold text-gold2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => decide('rejected')}
          className="rounded border border-line2 bg-panel2 px-1.5 py-0.5 text-xs text-muted"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => decide('held')}
          className="rounded border border-line2 bg-panel2 px-1.5 py-0.5 text-xs text-muted"
        >
          Hold
        </button>
      </div>
      {proposal.direction === 'review' && (
        <p className="mt-1 text-[10px] text-dim">A safety-review proposal cannot be applied.</p>
      )}
      {proposal.direction !== 'review' && stale && (
        <p className="mt-1 text-[10px] text-dim">Stale — the accepted prescription changed since this was proposed.</p>
      )}
      {/* Named, not counted. This line used to read "Blocked while a hard
          safety constraint is active." — which tells a coach neither WHICH
          constraint stopped them nor what the engine says to do instead,
          while `hardSafety` has carried both all along. It matters more
          since the Stage-1 redesign than it did before: this is now the only
          acknowledgement of a hard constraint anywhere in the queue, and
          pain and illness outrank every other signal (CLAUDE.md). */}
      {proposal.direction !== 'review' && !stale && hardSafety.length > 0 && (
        <div className="mt-1 text-[10px] text-dim">
          <p>Approval is blocked while a hard safety constraint is active:</p>
          <ul className="mt-0.5 list-disc pl-3">
            {hardSafety.map((constraint) => (
              <li key={constraint.code}>
                {constraint.reason} {constraint.adjustment}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="sr-only" aria-live="polite">{message}</div>
    </div>
  );
}

/**
 * The roster decision actions — extracted from
 * `RosterProgressionView.decide` (`CoachProgression.tsx`, formerly around
 * line 80). Approve never touches a prescription directly here: it writes a
 * decision through `repository.decideProgressionProposal`, which the
 * athlete's own device reads and applies on its next sync.
 *
 * Two guards apply to this path, unchanged from before extraction:
 *  1. A `review`-direction proposal can never be approved.
 *  2. `proposal.hard` blocks Approve directly, independent of `direction` —
 *     defence-in-depth. The backend pairs `hard:true` with
 *     `direction:'review'` today, but nothing here enforces that pairing as
 *     an invariant, so `hard` gates Approve on its own too. Pain/illness
 *     flags outrank every other signal; Approve must never be one dropped
 *     invariant away from clickable on a pain/illness-blocked proposal.
 *
 * `onDecided` lets the caller (the roster proposal list) remove the item and
 * update its own empty-state copy — the same thing `RosterProgressionView`
 * did inline before extraction, just handed back instead of duplicated here,
 * since the list itself still lives in the caller.
 */
export function RosterProgressionActions({
  clientId,
  clientName,
  proposal,
  onDecided,
}: {
  clientId: string;
  clientName: string;
  proposal: AthleteProgressionProposal;
  onDecided?: (proposalId: string, decision: 'approved' | 'declined') => void;
}) {
  const { repository } = useCoachWorkspace();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function decide(decision: 'approved' | 'declined') {
    if (!repository.decideProgressionProposal) return;
    setBusy(true);
    try {
      await repository.decideProgressionProposal(clientId, proposal.id, decision);
      setMessage(`${proposal.subject}: ${decision}. ${clientName}'s device will apply this on its next sync.`);
      onDecided?.(proposal.id, decision);
    } catch {
      setMessage('The decision could not be recorded. Nothing has changed — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      <button
        type="button"
        /* `hard` and `direction` are independent fields on
           AthleteProgressionProposal -- the backend pairs hard:true with
           direction:'review' today, but nothing HERE enforces that
           invariant, so `hard` gates Approve directly too, defence-in-depth.
           Pain/illness flags outrank every other signal (CLAUDE.md);
           Approve must never be one dropped invariant away from clickable
           on a pain/illness-blocked proposal. */
        disabled={proposal.direction === 'review' || proposal.hard || busy}
        onClick={() => decide('approved')}
        className="rounded border border-gold-line bg-gold-wash px-1.5 py-0.5 text-xs font-semibold text-gold2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('declined')}
        className="rounded border border-line2 bg-panel2 px-1.5 py-0.5 text-xs text-muted"
      >
        Decline
      </button>
      <div className="sr-only" aria-live="polite">{message}</div>
    </div>
  );
}
