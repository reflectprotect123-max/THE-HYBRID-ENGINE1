import { useMemo } from 'react';
import { ensureSharedCore } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Stat } from '../ui';
import { summarizeWeek } from './weeklySummary';

/**
 * Read-only weekly review: raw counts, no rolled-up score. Data-shaping lives
 * in `summarizeWeek` (weeklySummary.ts) — this component only renders what
 * that pure function returns, mirroring the trends.ts / AthleteStatus.tsx
 * split. A quiet week with nothing checked in reads as zeros, not as green.
 * Reference material once the week is underway, so the card recedes —
 * `Stat`'s dense recipe (`size="sm"`) is the same tile the coach bench's own
 * weekly figures would use, not a bespoke one built just for this card.
 */

export function WeeklySummary() {
  const { db, sessions, workouts } = useDb();
  const today = new Date().toISOString().slice(0, 10);
  const core = useMemo(() => ensureSharedCore(db).core, [db]);
  const summary = useMemo(
    () => summarizeWeek(sessions, workouts, core?.recovery ?? [], core?.events ?? [], today),
    [sessions, workouts, core, today],
  );

  const tagEntries = Object.entries(summary.tagCounts).sort((a, b) => b[1] - a[1]);
  const flags = [
    summary.painDays > 0 ? `${summary.painDays} day${summary.painDays === 1 ? '' : 's'} with pain flagged` : '',
    summary.illnessDays > 0 ? `${summary.illnessDays} day${summary.illnessDays === 1 ? '' : 's'} with illness flagged` : '',
  ].filter(Boolean);

  return (
    <Card tone="quiet" className="flex flex-col gap-1">
      <p className="text-3 text-dim">
        {summary.weekStart} – {summary.weekEnd}
      </p>
      <div className="grid grid-cols-3 gap-1">
        <Stat size="sm" label="Planned" value={String(summary.plannedCount)} />
        <Stat size="sm" label="Completed" value={String(summary.completedCount)} tint={summary.completedCount > 0} />
        <Stat size="sm" label="Incomplete" value={String(summary.incompleteCount)} />
      </div>

      {flags.length ? <p className="text-3 text-warn">{flags.join(' · ')}</p> : null}

      {summary.feedbackCount > 0 ? (
        <div>
          <span className="text-2 uppercase tracking-wide text-dim">Feedback tags</span>
          <ul className="mt-0.5 flex flex-wrap gap-1">
            {tagEntries.map(([tag, count]) => (
              <li key={tag} className="rounded-full border border-line px-1 py-[1px] text-3 text-muted">
                {tag.replace(/_/g, ' ')} · {count}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-3 text-dim">No post-session feedback logged this week yet.</p>
      )}
    </Card>
  );
}
