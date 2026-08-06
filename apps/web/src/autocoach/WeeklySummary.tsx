import { useMemo } from 'react';
import { ensureSharedCore } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card } from '../ui';
import { summarizeWeek } from './weeklySummary';

/**
 * Read-only weekly review: raw counts, no rolled-up score. Data-shaping lives
 * in `summarizeWeek` (weeklySummary.ts) — this component only renders what
 * that pure function returns, mirroring the trends.ts / AthleteStatus.tsx
 * split. A quiet week with nothing checked in reads as zeros, not as green.
 */

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-well px-1 py-1 text-center">
      <b className="num block text-6 font-[800] text-text">{value}</b>
      <span className="mt-0.5 block text-1 uppercase tracking-wide text-dim">{label}</span>
    </div>
  );
}

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
    <Card className="flex flex-col gap-1">
      <p className="text-3 text-dim">
        {summary.weekStart} – {summary.weekEnd}
      </p>
      <div className="grid grid-cols-3 gap-1">
        <MiniStat label="Planned" value={summary.plannedCount} />
        <MiniStat label="Completed" value={summary.completedCount} />
        <MiniStat label="Incomplete" value={summary.incompleteCount} />
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
