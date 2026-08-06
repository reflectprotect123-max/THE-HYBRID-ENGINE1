import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveSession } from '@hybrid/auto-coach';
import { uid, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Kicker, cx } from '../ui';
import { canApply, ledgerEntryFromApply, planApply, planUndo } from './applyResolution';
import { canUndo, recordApply, recordUndo, useLedger } from './ledger';
import { updatePolicy, usePolicy } from './policy';

/**
 * The Auto-Coached receipt for today's session — signal, inference, action,
 * with the original always visible. The resolver's output is a resolved
 * COPY; the coach-authored workout is never mutated. Applying writes that
 * copy into the real store — in place for a one-off placement, or as a
 * fresh forked one-off when today's workout is a recurring template, so the
 * adaptation never leaks into future occurrences. See applyResolution.ts.
 */

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
  const ledger = useLedger();
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const workout = useMemo(() => todaysWorkout(workouts, today), [workouts, today]);

  if (!workout || policy.status === 'revoked') return null;

  const r = resolveSession({ workout, policy, state: athleteState });
  const changed = r.operations.some((o) => o.type !== 'keep_as_planned');
  if (compact && !changed) return null;

  // The most recent apply/undo recorded for today, regardless of which
  // workout id it targeted — a fork changes today's resolved workout's id,
  // so matching on today's date (one Auto-Coached decision per day) is what
  // stays valid across that change.
  const latestToday = ledger.find((e) => e.date === today) ?? null;
  const appliedEntry = latestToday?.action === 'applied' ? latestToday : null;
  const showApply = !appliedEntry && canApply(r);
  const showUndo = appliedEntry !== null && canUndo(appliedEntry);

  const handleApply = () => {
    const plan = planApply(workout, r, today, uid);
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
    });
    recordApply(ledgerEntryFromApply(plan, r, today));
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
      }
    });
    recordUndo(appliedEntry);
  };

  // Nothing to review recedes; anything worth a look — a proposed change or a
  // safety stop — carries the screen's default weight so it isn't mistaken
  // for reference material the way a quiet card would read.
  const quiet = r.state === 'normal' && !changed;

  return (
    <Card
      tone={quiet ? 'quiet' : undefined}
      className={cx('flex flex-col gap-1', r.state === 'safety_stop' && 'border-bad/40')}
    >
      <div className="flex items-baseline gap-1">
        <Kicker>Auto-Coached · {policy.status === 'paused' ? 'paused' : policy.mode}</Kicker>
        <StatePill state={r.state} confidence={r.confidence} />
      </div>

      <p className="text-3 text-text">{r.athleteMessage}</p>

      {changed && (
        <ul className="flex flex-col gap-0.5">
          {r.operations
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

      {!compact && (
        <details className="text-3 text-muted">
          <summary className="cursor-pointer text-dim">Why — signals and inference</summary>
          <ul className="mt-0.5 space-y-[1px]">
            {r.signals.map((s, i) => (
              <li key={i} className={cx(s.quality !== 'known' && 'text-dim')}>
                · {s.text}
              </li>
            ))}
            {r.inferences.map((s, i) => (
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
            ? 'Shadow mode — shown, never applied. The plan itself is unchanged.'
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
        {showApply && (
          <button
            className="shrink-0 rounded bg-gold-wash px-1 py-0.5 text-3 text-gold2 outline outline-1 outline-gold-line hover:brightness-110 focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={handleApply}
          >
            Apply
          </button>
        )}
        {showUndo && (
          <button
            className="shrink-0 rounded px-1 py-0.5 text-3 text-muted outline outline-1 outline-line hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={handleUndo}
          >
            Undo
          </button>
        )}
        {(r.state === 'safety_stop' || r.state === 'uncertain') && (
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
