// apps/web/src/autocoach/SessionReceipt.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveSession } from '@hybrid/auto-coach';
import { tombstone, uid, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Kicker, cx } from '../ui';
import { canApply, ledgerEntryFromApply, planApply, planUndo } from './applyResolution';
import { getConsent, useConsent } from './consent';
import { canUndo, recordApply, recordUndo, useLedger } from './ledger';
import { decidePending, proposePending, usePendingProposal, withdrawPending } from './pendingProposal';
import { getPolicy, updatePolicy, usePolicy } from './policy';

/**
 * The Auto-Coached receipt for today's session — signal, inference, action,
 * with the original always visible. The resolver's output is a resolved
 * COPY; the coach-authored workout is never mutated. An eligible resolution
 * is PROPOSED automatically (docs/RISK_REGISTER.md R2) — nothing applies
 * until the athlete taps Approve; Decline is always safe, since today's
 * as-authored session is what trains either way, decided or not. Applying
 * writes the FROZEN proposed copy into the real store — in place for a
 * one-off placement, or as a fresh forked one-off when today's workout is a
 * recurring template, so the adaptation never leaks into future
 * occurrences. See applyResolution.ts and pendingProposal.ts.
 *
 * Approve is not merely a button: it is the consent gate. Shadow mode's own
 * copy — here and in ModeSwitcher — promises "shown, never applied", so
 * Approve must not exist while the athlete is in shadow, and must not exist
 * before proposals consent has actually been recorded (consent.ts). Both
 * conditions are checked twice: once for what is rendered, and again inside
 * the handler, because a purely visual gate is one UI bug away from being no
 * gate at all.
 */

/** Whether the athlete has actually authorised applying a change: out of
 *  shadow AND proposals consent on record. `mode` alone is not enough —
 *  policy and consent are separate stores and either could be restored,
 *  migrated or edited independently of the other. */
export function approvalAllowed(
  mode: 'shadow' | 'assisted' | 'auto_daily',
  proposalsAccepted: boolean,
): boolean {
  return mode !== 'shadow' && proposalsAccepted;
}

function todaysWorkout(workouts: Workout[], today: string): Workout | null {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  return (
    workouts.find((w) => w.dates?.includes(today)) ??
    workouts.find((w) => w.days?.includes(wd)) ??
    null
  );
}

/* State pill — the same rounded-full/outline recipe CheckInCard's pain
   choice already uses one card above this, so the two read as one grammar
   rather than two components that happen to share a screen. */
const STATE_PILL: Record<string, string> = {
  normal: 'text-muted outline-line2',
  advisory: 'text-gold2 outline-gold-line',
  uncertain: 'text-warn outline-warn/40',
  safety_stop: 'text-bad outline-bad/40',
};

function StatePill({ state, confidence }: { state: string; confidence: string }) {
  return (
    <span
      className={cx(
        'ml-auto shrink-0 rounded-full px-1 py-0.5 text-2 uppercase tracking-wide outline outline-1',
        STATE_PILL[state],
      )}
    >
      {state.replace('_', ' ')} · {confidence}
    </span>
  );
}

export function SessionReceipt({ compact }: { compact?: boolean }) {
  const { workouts, update, athleteState } = useDb();
  const policy = usePolicy();
  const consent = useConsent();
  const ledger = useLedger();
  const pendingRaw = usePendingProposal();
  const [applyError, setApplyError] = useState<string | null>(null);
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const workout = useMemo(() => todaysWorkout(workouts, today), [workouts, today]);

  const r = useMemo(
    () => (workout ? resolveSession({ workout, policy, state: athleteState }) : null),
    [workout, policy, athleteState],
  );

  const pending = pendingRaw?.date === today ? pendingRaw : null;

  // The most recent apply/undo recorded for today, regardless of which
  // workout id it targeted — a fork changes today's resolved workout's id,
  // so matching on today's date (one Auto-Coached decision per day) is what
  // stays valid across that change.
  const latestToday = ledger.find((e) => e.date === today) ?? null;
  const appliedEntry = latestToday?.action === 'applied' ? latestToday : null;

  // Propose automatically once eligible; withdraw silently the moment a
  // fresh resolve (this same render's `r`) turns hard-unsafe, OR the
  // underlying source workout no longer matches what was frozen at propose
  // time — an athlete edit to today's workout after proposing must not be
  // silently overwritten by Approve applying the stale frozen blocks, OR
  // Auto-Coached has been paused — a pause must withdraw a pending proposal,
  // not leave it sitting there for a later Approve to bank. A decided
  // (approved/declined) proposal is left alone — a decision, once made,
  // stays made for the day.
  useEffect(() => {
    if (!workout || !r || appliedEntry) return;
    if (pending) {
      if (
        pending.status === 'pending' &&
        (r.state === 'safety_stop' ||
          pending.sourceWorkoutId !== workout.id ||
          pending.sourceWorkoutUpdatedAt !== (workout.updatedAt ?? 0) ||
          policy.status !== 'active')
      ) {
        withdrawPending();
      }
      return;
    }
    if (canApply(r)) {
      proposePending({
        date: today,
        sourceWorkoutId: workout.id,
        sourceWorkoutUpdatedAt: workout.updatedAt ?? 0,
        resolution: r,
      });
    }
  }, [workout, r, pending, appliedEntry, today]);

  if (!workout || policy.status === 'revoked' || !r) return null;

  // While a proposal is pending, the card must show — and Approve must
  // apply — the SAME content: the frozen resolution captured at propose
  // time, not a fresh recompute that may have softly drifted since (a drift
  // that isn't hard-unsafe and isn't a source-workout change, the only two
  // things that trigger withdrawal above). Once nothing is pending, display
  // reverts to the live resolve. `r` itself keeps being computed every
  // render regardless — the withdrawal effect and the approve backstop both
  // still need the live value to catch a fresh safety_stop or edit.
  const displayResolution = pending?.status === 'pending' ? pending.resolution : r;

  const changed = displayResolution.operations.some((o) => o.type !== 'keep_as_planned');
  if (compact && !changed) return null;

  // Shadow mode shows what Auto-Coached WOULD do and applies nothing; a
  // proposal with no consent behind it is the same. Either way there is
  // nothing to decide, so neither Approve nor Decline is offered — only the
  // explanation of how to turn it on.
  const canDecide = approvalAllowed(policy.mode, consent.proposalsConsent?.accepted === true);
  const showDecide = pending?.status === 'pending' && canDecide;
  const showUndo = appliedEntry !== null && canUndo(appliedEntry);

  const handleApprove = () => {
    if (!pending || pending.status !== 'pending') return;
    // The consent gate again, read live rather than from this render's
    // closure. Rendering already withholds the button, but a visual gate is
    // not a safety gate: nothing may reach the store without both an
    // out-of-shadow mode and recorded consent.
    if (!approvalAllowed(getPolicy().mode, getConsent().proposalsConsent?.accepted === true)) return;
    // Defence-in-depth backstop: the effect above should already have
    // withdrawn a now-unsafe, now-stale, or now-paused proposal before this
    // button could be clicked, but a hard constraint, an athlete edit to
    // today's workout, or a pause could in principle land between that
    // render and this click, so all four checks are repeated here too.
    if (
      r.state === 'safety_stop' ||
      pending.sourceWorkoutId !== workout.id ||
      pending.sourceWorkoutUpdatedAt !== (workout.updatedAt ?? 0) ||
      policy.status !== 'active'
    ) {
      withdrawPending();
      return;
    }
    const plan = planApply(workout, pending.resolution, today, uid);
    // `update` returns void and abandons the whole write when the callback
    // returns false, so success is captured from inside it. The target can
    // genuinely be gone — deleted from Home, or tombstoned by a sync — in
    // which case nothing was written and neither the ledger nor the decision
    // may claim otherwise, or the card would offer Undo for a change that
    // never happened and the day's proposal would be spent.
    let wrote = false;
    update((draft) => {
      if (plan.kind === 'mutate') {
        const target = draft.workouts.find((x) => x.id === plan.workoutId);
        if (!target) return false;
        target.blocks = plan.afterBlocks;
        target.updatedAt = Date.now();
      } else {
        draft.workouts.push({
          id: plan.forkedWorkoutId,
          name: plan.name,
          kind: plan.workoutKind,
          blocks: plan.blocks,
          dates: [plan.date],
          updatedAt: Date.now(),
        });
      }
      wrote = true;
    });
    if (!wrote) {
      setApplyError('Nothing was changed — today’s session is no longer there.');
      return;
    }
    setApplyError(null);
    recordApply(ledgerEntryFromApply(plan, pending.resolution, today));
    decidePending('approved');
  };

  const handleDecline = () => {
    if (!pending || pending.status !== 'pending') return;
    decidePending('declined');
  };

  const handleUndo = () => {
    if (!appliedEntry) return;
    const plan = planUndo(appliedEntry);
    if (!plan) return;
    update((draft) => {
      if (plan.kind === 'restore') {
        const target = draft.workouts.find((x) => x.id === plan.workoutId);
        if (!target) return false;
        target.blocks = plan.blocks;
        target.updatedAt = Date.now();
      } else {
        const i = draft.workouts.findIndex((x) => x.id === plan.workoutId);
        if (i >= 0) draft.workouts.splice(i, 1);
        // Undo removes a workout the apply may already have pushed, so the
        // removal needs a tombstone or the other device hands it back.
        tombstone(draft, plan.workoutId);
      }
    });
    recordUndo(appliedEntry);
  };

  // Nothing to review recedes; anything worth a look — a proposed change or a
  // safety stop — carries the screen's default weight so it isn't mistaken
  // for reference material the way a quiet card would read.
  const quiet = displayResolution.state === 'normal' && !changed;

  return (
    <Card
      tone={quiet ? 'quiet' : undefined}
      className={cx('flex flex-col gap-1', displayResolution.state === 'safety_stop' && 'border-bad/40')}
    >
      <div className="flex items-baseline gap-1">
        <Kicker>Auto-Coached · {policy.status === 'paused' ? 'paused' : policy.mode}</Kicker>
        <StatePill state={displayResolution.state} confidence={displayResolution.confidence} />
      </div>

      <p className="text-3 text-text">{displayResolution.athleteMessage}</p>

      {changed && (
        <ul className="flex flex-col gap-0.5">
          {displayResolution.operations
            .filter((o) => o.type !== 'keep_as_planned')
            .map((o, i) => (
              <li key={i} className="rounded bg-well px-1 py-0.5 text-3 tabular-nums">
                <span className="text-dim line-through">{o.before}</span>
                <span className="text-muted"> → </span>
                <span className="text-gold2">{o.after}</span>
              </li>
            ))}
        </ul>
      )}

      {appliedEntry && (
        <p className="text-3 text-ok">
          Applied{appliedEntry.wasForked ? ' — today only, future sessions are unchanged' : ''} — undo
          available.
        </p>
      )}

      {applyError && <p className="text-3 text-bad">{applyError}</p>}

      {!compact && (
        <details className="text-3 text-muted">
          <summary className="cursor-pointer text-dim">Why — signals and inference</summary>
          <ul className="mt-0.5 space-y-[1px]">
            {displayResolution.signals.map((s, i) => (
              <li key={i} className={cx(s.quality !== 'known' && 'text-dim')}>
                · {s.text}
              </li>
            ))}
            {displayResolution.inferences.map((s, i) => (
              <li key={`i${i}`} className="text-muted">
                → {s}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex items-center gap-1">
        <span className="text-2 text-dim">
          {policy.mode === 'shadow'
            ? 'Shadow mode — shown, never applied. The plan itself is unchanged. Turn on Assisted below to approve changes.'
            : !canDecide
              ? 'Approving needs your consent — turn on Assisted below.'
              : 'Nothing applies without your confirmation.'}
        </span>
        <button
          className="ml-auto shrink-0 rounded px-1 py-0.5 text-3 text-muted outline outline-1 outline-line hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
          aria-pressed={policy.status === 'paused'}
          onClick={() =>
            updatePolicy((p) => ({ ...p, status: p.status === 'paused' ? 'active' : 'paused' }))
          }
        >
          {policy.status === 'paused' ? 'Resume' : 'Pause'}
        </button>
        {showDecide && (
          <>
            <button
              className="shrink-0 rounded px-1 py-0.5 text-3 text-muted outline outline-1 outline-line hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
              onClick={handleDecline}
            >
              Decline
            </button>
            <button
              className="shrink-0 rounded bg-gold-wash px-1 py-0.5 text-3 text-gold2 outline outline-1 outline-gold-line hover:brightness-110 focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
              onClick={handleApprove}
            >
              Approve
            </button>
          </>
        )}
        {showUndo && (
          <button
            className="shrink-0 rounded px-1 py-0.5 text-3 text-muted outline outline-1 outline-line hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={handleUndo}
          >
            Undo
          </button>
        )}
        {(displayResolution.state === 'safety_stop' || displayResolution.state === 'uncertain') && (
          <button
            className="shrink-0 rounded bg-gold-wash px-1 py-0.5 text-3 text-gold2 outline outline-1 outline-gold-line focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={() => nav('/settings')}
          >
            Review check-in
          </button>
        )}
      </div>
    </Card>
  );
}
