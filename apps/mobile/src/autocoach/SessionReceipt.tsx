import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { resolveSession } from '@hybrid/auto-coach';
import { tombstone, uid, ymd, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Kicker, T, Tap } from '../ui';
import { canApply, ledgerEntryFromApply, planApply, planUndo } from './applyResolution';
import { getConsent, useConsent } from './consent';
import { canUndo, recordApply, recordUndo, useLedger } from './ledger';
import {
  decidePending,
  pendingKey,
  proposePending,
  usePendingProposals,
  withdrawPending,
} from './pendingProposal';
import { getPolicy, updatePolicy, usePolicy } from './policy';

/**
 * The Auto-Coached receipt for today's session, ported from
 * apps/web/src/autocoach/SessionReceipt.tsx. Signal, inference, action, with
 * the original always visible. An eligible resolution is PROPOSED
 * automatically (docs/RISK_REGISTER.md R2) — nothing applies until the
 * athlete taps Approve; Decline is always safe. "Today" here uses mobile's
 * local-time convention (ymd/getDay), matching Home.tsx/Training.tsx — not
 * web's UTC convention. See applyResolution.ts and pendingProposal.ts.
 *
 * Approve is not merely a button: it is the consent gate. Shadow mode's own
 * copy — here and in ModeSwitcher — promises "shown, never applied", so
 * Approve must not exist while the athlete is in shadow, and must not exist
 * before proposals consent has actually been recorded (consent.ts). Both
 * conditions are checked twice: once for what is rendered, and again inside
 * the handler, because a purely visual gate is one UI bug away from being
 * no gate at all.
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

function todaysWorkout(workouts: Workout[], today: string, dow: number): Workout | null {
  return (
    workouts.find((w) => w.dates?.includes(today)) ??
    workouts.find((w) => w.days?.includes(dow)) ??
    null
  );
}

const STATE_PILL: Record<string, { text: string; border: string }> = {
  normal: { text: 'text-muted', border: 'border-line2' },
  advisory: { text: 'text-gold2', border: 'border-gold-line' },
  uncertain: { text: 'text-warn', border: 'border-warn/40' },
  safety_stop: { text: 'text-bad', border: 'border-bad/40' },
};

function StatePill({ state, confidence }: { state: string; confidence: string }) {
  const tone = STATE_PILL[state] ?? STATE_PILL.normal;
  return (
    <View className={`ml-auto shrink-0 rounded-pill border px-1 py-0.5 ${tone.border}`}>
      <T w="bold" className={`text-2 uppercase tracking-wide ${tone.text}`}>
        {state.replace('_', ' ')} · {confidence}
      </T>
    </View>
  );
}

export function SessionReceipt({ compact }: { compact?: boolean }) {
  const { workouts, update, athleteState } = useDb();
  const policy = usePolicy();
  const consent = useConsent();
  const ledger = useLedger();
  const proposals = usePendingProposals();
  const [applyError, setApplyError] = useState<string | null>(null);
  const today = ymd(new Date());
  const dow = new Date().getDay();
  const workout = useMemo(() => todaysWorkout(workouts, today, dow), [workouts, today, dow]);

  const r = useMemo(
    () => (workout ? resolveSession({ workout, policy, state: athleteState }) : null),
    [workout, policy, athleteState],
  );

  // One decision per session, not per day: the merged app can show a Strength
  // and a Conditioning receipt on the same date, each scoped to its own world
  // by useDb(). Keying on the date alone let one world's Approve/Decline
  // consume the other's proposal. See pendingProposal.ts.
  const key = workout ? pendingKey(today, workout.id) : null;
  const pending = key ? (proposals[key] ?? null) : null;

  // The most recent apply/undo recorded for today's session — matched on the
  // workout as well as the date, for the same cross-world reason. A fork
  // changes today's resolved workout's id, so the fork's own id counts as a
  // match too, or the "Applied — undo available" state would vanish the
  // moment the fork it created becomes today's workout.
  const latestToday = workout
    ? (ledger.find(
        (e) =>
          e.date === today && (e.workoutId === workout.id || e.forkedWorkoutId === workout.id),
      ) ?? null)
    : null;
  const appliedEntry = latestToday?.action === 'applied' ? latestToday : null;

  useEffect(() => {
    if (!workout || !r || appliedEntry || !key) return;
    if (pending) {
      if (
        pending.status === 'pending' &&
        (r.state === 'safety_stop' ||
          pending.sourceWorkoutId !== workout.id ||
          pending.sourceWorkoutUpdatedAt !== (workout.updatedAt ?? 0) ||
          policy.status !== 'active')
      ) {
        withdrawPending(key);
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
  }, [workout, r, pending, appliedEntry, today, key]);

  if (!workout || policy.status === 'revoked' || !r || !key) return null;

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
    if (
      r.state === 'safety_stop' ||
      pending.sourceWorkoutId !== workout.id ||
      pending.sourceWorkoutUpdatedAt !== (workout.updatedAt ?? 0) ||
      policy.status !== 'active'
    ) {
      withdrawPending(key);
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
    decidePending(key, 'approved');
  };

  const handleDecline = () => {
    if (!pending || pending.status !== 'pending') return;
    decidePending(key, 'declined');
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
        tombstone(draft, plan.workoutId);
      }
    });
    recordUndo(appliedEntry);
  };

  const quiet = displayResolution.state === 'normal' && !changed;

  return (
    <Card
      tone={quiet ? 'quiet' : undefined}
      className={displayResolution.state === 'safety_stop' ? 'border-bad/40' : ''}
    >
      <View className="flex-row items-baseline gap-1">
        <Kicker>Auto-Coached · {policy.status === 'paused' ? 'paused' : policy.mode}</Kicker>
        <StatePill state={displayResolution.state} confidence={displayResolution.confidence} />
      </View>

      <T className="mt-1 text-3 text-text">{displayResolution.athleteMessage}</T>

      {changed && (
        <View className="mt-1">
          {displayResolution.operations
            .filter((o) => o.type !== 'keep_as_planned')
            .map((o, i) => (
              <View key={i} className="mt-0.5 rounded bg-well px-1 py-0.5">
                <T className="text-3 tabular-nums">
                  <T className="text-dim line-through">{o.before}</T>
                  <T className="text-muted"> → </T>
                  <T className="text-gold2">{o.after}</T>
                </T>
              </View>
            ))}
        </View>
      )}

      {appliedEntry && (
        <T className="mt-1 text-3 text-ok">
          Applied{appliedEntry.wasForked ? ' — today only, future sessions are unchanged' : ''} — undo
          available.
        </T>
      )}

      {applyError && <T className="mt-1 text-3 text-bad">{applyError}</T>}

      <View className="mt-1 flex-row items-center gap-1">
        <T className="flex-1 text-2 text-dim">
          {policy.mode === 'shadow'
            ? 'Shadow mode — shown, never applied. The plan itself is unchanged. Turn on Assisted in Settings to approve changes.'
            : !canDecide
              ? 'Approving needs your consent — turn on Assisted in Settings.'
              : 'Nothing applies without your confirmation.'}
        </T>
        <Tap
          onPress={() =>
            updatePolicy((p) => ({ ...p, status: p.status === 'paused' ? 'active' : 'paused' }))
          }
          box={{ h: 24 }}
          className="shrink-0 rounded border border-line px-1 py-0.5"
        >
          <T className="text-3 text-muted">{policy.status === 'paused' ? 'Resume' : 'Pause'}</T>
        </Tap>
        {showDecide && (
          <>
            <Tap onPress={handleDecline} box={{ h: 24 }} className="shrink-0 rounded border border-line px-1 py-0.5">
              <T className="text-3 text-muted">Decline</T>
            </Tap>
            <Tap
              onPress={handleApprove}
              box={{ h: 24 }}
              className="shrink-0 rounded border border-gold-line bg-gold-wash px-1 py-0.5"
            >
              <T className="text-3 text-gold2">Approve</T>
            </Tap>
          </>
        )}
        {showUndo && (
          <Tap onPress={handleUndo} box={{ h: 24 }} className="shrink-0 rounded border border-line px-1 py-0.5">
            <T className="text-3 text-muted">Undo</T>
          </Tap>
        )}
      </View>
    </Card>
  );
}
