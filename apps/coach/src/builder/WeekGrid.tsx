import { useEffect, useRef, useState } from 'react';
import { uid } from '@hybrid/engine';
import { cellSummary, libraryCandidates } from './grid';
import { useLib } from '../store';
import { newSession, type CoachSession } from '../model';
import { BRASS, Chip, GHOST, MICRO } from '../ui';

/*
 * The Plan view's new primary content.
 *
 * Days as columns is unnecessary given this app is one programme at a time
 * with a 7-day week already fixed, so this is rows of days — matching the
 * existing day-list order — each showing its `cellSummary` and the one or
 * two actions the design calls for: a filled day gets "Edit"; an empty one
 * gets "Create a session" and, when this programme already has sessions
 * elsewhere to copy, "Add from library".
 */
export function WeekGrid({
  onEdit,
  onCreate,
  onClear,
}: {
  onEdit: (dayIndex: number) => void;
  onCreate: (dayIndex: number, session: CoachSession) => void;
  onClear: (dayIndex: number) => void;
}) {
  const { lib } = useLib();
  const prog = lib.programs[lib.sel.p];
  const week = prog.weeks[lib.sel.w];
  const [libraryFor, setLibraryFor] = useState<number | null>(null);
  // Clearing a day is destructive-at-a-distance, so it takes two taps: the
  // first ARMS the row ("Really clear?"), the second clears. Arming one row
  // disarms the others, and an armed row disarms itself after 5s untouched.
  const [armed, setArmed] = useState<number | null>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = (i: number | null) => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    disarmTimer.current = i == null ? null : setTimeout(() => setArmed(null), 5000);
    setArmed(i);
  };
  useEffect(() => () => { if (disarmTimer.current) clearTimeout(disarmTimer.current); }, []);
  const candidates = libraryCandidates(prog);

  return (
    <div className="flex min-h-full flex-col gap-1 p-3">
      <h1 className="text-8 font-[800] tracking-[-.02em]">Week {lib.sel.w + 1}</h1>
      <div className="mt-1 flex flex-col gap-1">
        {week.days.map((sess, i) => {
          const cell = cellSummary(sess);
          return (
            <div key={i} className="relative flex items-center gap-2 rounded-md border border-line bg-panel p-2">
              <span className="num grid h-5 w-5 shrink-0 place-items-center rounded-pill border border-line2 bg-panel2 text-4 font-[750]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={MICRO}>Day {i + 1}</div>
                <b className="block truncate text-5 font-[750]">{sess ? sess.name || 'Session' : 'Rest day'}</b>
                {cell.status === 'filled' ? (
                  <span className="flex items-center gap-1 text-3 text-muted">
                    <span className="min-w-0 flex-1 truncate">{cell.line}</span>
                    {cell.sets ? <span className="num shrink-0 text-2 text-dim">{cell.sets} sets</span> : null}
                    {cell.isCond ? <Chip tone="cond">♥ HR</Chip> : null}
                  </span>
                ) : null}
              </div>

              {cell.status === 'filled' ? (
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => onEdit(i)} className={GHOST}>
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (armed === i) { arm(null); onClear(i); }
                      else arm(i);
                    }}
                    onBlur={() => { if (armed === i) arm(null); }}
                    aria-label={armed === i ? 'really clear day ' + (i + 1) : 'clear day ' + (i + 1)}
                    className={GHOST + (armed === i ? ' !text-bad' : '')}
                  >
                    {armed === i ? 'Really clear?' : 'Clear day'}
                  </button>
                </div>
              ) : libraryFor === i ? (
                <LibraryPicker
                  candidates={candidates}
                  onPick={(s) => {
                    onCreate(i, { ...s, id: uid(), updatedAt: Date.now() });
                    setLibraryFor(null);
                  }}
                  onClose={() => setLibraryFor(null)}
                />
              ) : (
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => onCreate(i, newSession('Session'))} className={BRASS}>
                    Create a session
                  </button>
                  {candidates.length ? (
                    <button onClick={() => setLibraryFor(i)} className={GHOST}>
                      Add from library
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A short pick-one list of sessions already written elsewhere in this programme. */
function LibraryPicker({
  candidates,
  onPick,
  onClose,
}: {
  candidates: CoachSession[];
  onPick: (s: CoachSession) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        aria-label="choose a session to reuse"
        className="absolute z-50 flex max-h-[40vh] w-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-line2 bg-panel2 p-1 shadow-lift"
      >
        {candidates.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(s)}
            className="rounded-sm px-1 py-0.5 text-left text-4 hover:bg-panel3 hover:text-gold2"
          >
            {s.name || 'Session'}
          </button>
        ))}
      </div>
    </>
  );
}
