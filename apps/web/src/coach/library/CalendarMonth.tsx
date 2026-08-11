import { useMemo, useState } from 'react';
import { calendarMonthLabel, monthGrid, shiftMonth } from '@hybrid/engine';

export interface CalendarDay {
  /** `YYYY-MM-DD` */
  date: string;
  title: string;
  published: boolean;
  items: number;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "12 August 2026" — the accessible name of a day cell, and how a test addresses one. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

const ChevronLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

const ChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/**
 * The month grid from the approved mockup.
 *
 * The mockup reveals an empty day's two actions on `:hover`. A phone has no
 * hover, and `/coach` became a supported phone surface in Stage 1 — so the
 * cell is a real button and a tap opens the same actions. Hover still works on
 * a desktop through `.cal-hover`'s own CSS; it is simply no longer the only
 * way in.
 *
 * `Message team` and `Publish all` from the mockup's toolbar are deliberately
 * absent: messaging has never been designed, and a bulk write across an
 * athlete's plan deserves its own thinking rather than inheritance from a
 * drawing. See 2026-08-11-stage3a-library-spine-design.md.
 */
export function CalendarMonth({
  days,
  year,
  month,
  onMonthChange,
  onCreate,
  onAddFromLibrary,
  onOpen,
}: {
  days: CalendarDay[];
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  onCreate: (date: string) => void;
  onAddFromLibrary: (date: string) => void;
  onOpen: (date: string) => void;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);

  const cells = useMemo(() => monthGrid(year, month), [year, month]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  function step(delta: number) {
    const next = shiftMonth(year, month, delta);
    setOpenDate(null);
    onMonthChange(next.year, next.month);
  }

  return (
    <div id="cal-month-view">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="lib-icon-btn" aria-label="Previous month" onClick={() => step(-1)}>
            <ChevronLeft />
          </button>
          <button type="button" className="lib-icon-btn" aria-label="Next month" onClick={() => step(1)}>
            <ChevronRight />
          </button>
          <h2 className="cal-month">{calendarMonthLabel(year, month)}</h2>
        </div>
      </div>

      <div className="cal-grid-scroll">
        <div className="cal-grid">
          {DOW.map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}

          {cells.map((cell) => {
            const day = byDate.get(cell.date);

            if (day) {
              return (
                <div key={cell.date} className={`cal-cell has-session${cell.inMonth ? '' : ' dim'}`}>
                  <span className="cal-date">{cell.dayOfMonth}</span>
                  <button
                    type="button"
                    className="cal-session-card"
                    onClick={() => onOpen(cell.date)}
                    aria-label={`Open ${day.title} on ${longDate(cell.date)}`}
                  >
                    <p className="cal-session-title">{day.title}</p>
                    <span className={day.published ? 'cal-session-meta' : 'cal-unpublished'}>
                      {day.published ? 'Published' : 'Unpublished'} · {day.items} item
                      {day.items === 1 ? '' : 's'}
                    </span>
                  </button>
                </div>
              );
            }

            const isOpen = openDate === cell.date;
            /*
             * The tap target is a button INSIDE the cell, not the cell itself.
             * Nesting the two action buttons inside a button element would be
             * invalid HTML, and browsers resolve that inconsistently — the
             * inner clicks are the ones that would break, which is exactly the
             * phone path this structure exists to support.
             */
            return (
              <div key={cell.date} className={`cal-cell empty${cell.inMonth ? '' : ' dim'}`}>
                <button
                  type="button"
                  className={`cal-cell-tap${cell.inMonth ? '' : ' dim'}`}
                  aria-label={longDate(cell.date)}
                  aria-expanded={isOpen}
                  onClick={() => setOpenDate(isOpen ? null : cell.date)}
                >
                  <span className="cal-date">{cell.dayOfMonth}</span>
                </button>
                {isOpen && (
                  <div className="cal-hover open">
                    <button
                      type="button"
                      className="cal-hover-link"
                      data-cal-action="create"
                      onClick={() => onCreate(cell.date)}
                    >
                      Create session
                    </button>
                    <button
                      type="button"
                      className="cal-hover-link"
                      data-cal-action="library"
                      onClick={() => onAddFromLibrary(cell.date)}
                    >
                      Add from library
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
