import { useMemo, useState } from 'react';
import { authoredSessions, filterSessions, type SessionSummary } from './session-list';
import type { Workout } from '@hybrid/engine';

/**
 * Choose one of the coach's own sessions to put on a day.
 *
 * This is Stage 3c's "Sessions", reached the way it is actually useful: from
 * the Calendar's "Add from library" on an empty day. Picking one seeds the day
 * builder — 3c's rule is one editor, and this does not become a second.
 */
export function SessionPicker({
  workouts,
  date,
  onPick,
  onCreateInstead,
  onBack,
}: {
  workouts: readonly Workout[];
  date?: string;
  onPick: (id: string) => void;
  onCreateInstead: () => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const all = useMemo(() => authoredSessions(workouts), [workouts]);
  const shown = useMemo(() => filterSessions(all, query), [all, query]);

  return (
    <div className="rd-content">
      <button type="button" className="rd-back" onClick={onBack}>
        Back to calendar
      </button>
      <h2 className="cb-title">Add a session{date ? ` to ${date}` : ''}</h2>
      <p className="cb-note">
        Pick one you have already written. It opens in the builder as a copy — editing it here never
        changes the original.
      </p>

      {all.length === 0 ? (
        <div className="cb-note">
          <p>You have not written any sessions yet.</p>
          <button type="button" className="cb-add-btn primary" onClick={onCreateInstead}>
            Build this day from scratch
          </button>
        </div>
      ) : (
        <>
          <label className="cb-instructions">
            <span className="cal-field-label">Search</span>
            <input
              type="search"
              aria-label="Search sessions"
              value={query}
              placeholder="Session name"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          {shown.length === 0 ? (
            <p className="cb-note">No session matches “{query}”.</p>
          ) : (
            <ul className="cal-session-list">
              {shown.map((session) => (
                <li key={session.id}>
                  <button type="button" className="cal-session-row" onClick={() => onPick(session.id)}>
                    <span className="cal-session-name">{session.name}</span>
                    <span className="cal-session-meta">{summarise(session)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="cb-add-row">
            <button type="button" className="cb-add-btn ghost" onClick={onCreateInstead}>
              Build this day from scratch instead
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Only facts the summary actually has. An unknown kind is omitted, not guessed. */
function summarise(session: SessionSummary): string {
  const parts = [`${session.blockCount} block${session.blockCount === 1 ? '' : 's'}`];
  if (session.kind) parts.push(session.kind);
  if (session.dates.length) parts.push(`already on ${session.dates.length} day${session.dates.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
