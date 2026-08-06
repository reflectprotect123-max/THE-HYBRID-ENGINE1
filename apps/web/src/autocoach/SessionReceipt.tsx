import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveSession } from '@hybrid/auto-coach';
import type { Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, cx } from '../ui';
import { updatePolicy, usePolicy } from './policy';

/**
 * The Auto-Coached receipt for today's session — signal, inference, action,
 * with the original always visible. V1 runs in shadow/assisted display:
 * nothing is applied to the plan; the athlete reads what the system would
 * do and why, and can pause the whole mode in one tap. The resolver's
 * output is a resolved COPY — the coach-authored workout is untouched by
 * construction.
 */

function todaysWorkout(workouts: Workout[], today: string): Workout | null {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  return (
    workouts.find((w) => w.dates?.includes(today)) ??
    workouts.find((w) => w.days?.includes(wd)) ??
    null
  );
}

const STATE_TONE: Record<string, string> = {
  normal: 'text-muted',
  advisory: 'text-gold2',
  uncertain: 'text-warn',
  safety_stop: 'text-bad',
};

export function SessionReceipt({ compact }: { compact?: boolean }) {
  const { workouts, athleteState } = useDb();
  const policy = usePolicy();
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const workout = useMemo(() => todaysWorkout(workouts, today), [workouts, today]);

  if (!workout || policy.status === 'revoked') return null;

  const r = resolveSession({ workout, policy, state: athleteState });
  const changed = r.operations.some((o) => o.type !== 'keep_as_planned');
  if (compact && !changed) return null;

  return (
    <Card className={cx('flex flex-col gap-1', r.state === 'safety_stop' && 'border-bad/40')}>
      <div className="flex items-baseline gap-1">
        <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">
          Auto-Coached · {policy.status === 'paused' ? 'paused' : policy.mode}
        </span>
        <span className={cx('ml-auto text-2 uppercase tracking-wide', STATE_TONE[r.state])}>
          {r.state.replace('_', ' ')} · {r.confidence} confidence
        </span>
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
          className="ml-auto rounded px-1 py-0.5 text-3 text-muted outline outline-1 outline-line hover:text-text"
          onClick={() =>
            updatePolicy((p) => ({ ...p, status: p.status === 'paused' ? 'active' : 'paused' }))
          }
        >
          {policy.status === 'paused' ? 'Resume' : 'Pause'}
        </button>
        {(r.state === 'safety_stop' || r.state === 'uncertain') && (
          <button
            className="rounded bg-gold-wash px-1 py-0.5 text-3 text-gold2 outline outline-1 outline-gold-line"
            onClick={() => nav('/settings')}
          >
            Review check-in
          </button>
        )}
      </div>
    </Card>
  );
}
