import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { WeekDay } from './command-week';
import { weekTally } from './command-week';

/*
 * The Command Center's week panel — what fills the space below the four
 * tiles at desktop width.
 *
 * The tiles are COUNTS; this is the plan. That distinction is the whole
 * reason this panel exists rather than a second copy of the pending-proposal
 * numbers already badged above it: restating a number the screen has already
 * shown is clutter, and clutter was the one thing the owner ruled out.
 *
 * Every class here already exists in `coach-redesign.css` — the Library's own
 * seven-column day strip (`.lib-days`, `.lib-day-col`, `.lib-day-card`,
 * `.lib-ex-list`), which is the same shape and already carries its own
 * responsive behaviour: it scrolls INSIDE itself at phone width rather than
 * making the page scroll. Nothing is added to that stylesheet. `text-gold` is
 * the app's Tailwind token, used the same way elsewhere under `coach/`.
 */

/** Mon-first labels, matching the row's own Monday-first index. */
const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A day's status, said in WORDS as well as position.
 *  Colour alone never carries meaning here — a coach with any degree of
 *  colour-blindness reads the same week as everyone else. */
const STATUS_WORD: Record<WeekDay['entries'][number]['status'], string> = {
  logged: 'logged',
  active: 'in progress',
  scheduled: 'scheduled',
};

export function CommandWeek({ days, today, readable, athleteName }: {
  days: readonly WeekDay[];
  /** YYYY-MM-DD. Marked in the row so the coach can find their place. */
  today: string;
  /** False when this client's detail is not readable — a FACT on the
   *  contract, not a failure, and stated as one. */
  readable: boolean;
  athleteName: string;
}) {
  const tally = weekTally(days);
  const strip = useRef<HTMLDivElement>(null);
  const todayCol = useRef<HTMLDivElement>(null);

  /*
   * Bring today into view inside the strip.
   *
   * `.lib-days` is seven 160px-minimum columns that scroll INSIDE themselves
   * rather than making the page scroll — right for the page, wrong for the
   * coach on a phone, who landed on Monday with today three columns off the
   * right edge and no cue that anything was there. A dashboard should open on
   * the day it is about.
   *
   * `scrollLeft` on the container, not `scrollIntoView` on the child: the
   * latter also scrolls the PAGE vertically to reach the element, which yanks
   * the tiles off screen on mount. And `'auto'` under reduced-motion, because
   * an involuntary sideways animation is exactly what that preference is for.
   */
  useEffect(() => {
    const box = strip.current;
    const col = todayCol.current;
    if (!box || !col) return;
    const target = col.offsetLeft - (box.clientWidth - col.clientWidth) / 2;
    if (target <= 0) return; // already in view at desktop width — leave it alone
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ left: target, behavior: still ? 'auto' : 'smooth' });
  }, [days]);

  return (
    /* `mt-6` because `.rd-section-label`'s own `margin: 0 0 8px` is spacing
       BELOW the label, not above the section — so without this the heading
       sits hard against the tile row and the two read as one block. Tailwind
       utility rather than a new rule in `coach-redesign.css`, which this
       stage still does not touch. */
    <section className="mt-6" aria-labelledby="command-week-heading">
      <p className="rd-section-label" id="command-week-heading">This week</p>

      {!readable ? (
        /*
         * "Show a helpful message AND an action" — an empty state that only
         * apologises leaves the coach with nowhere to go. This one names the
         * reason and offers the screen that CAN read this athlete.
         */
        <div className="rd-panel">
          <p className="lib-sub">{athleteName}&rsquo;s week is not readable from here yet.</p>
          {/*
            NO LINK HERE, deliberately. The obvious action would be "open
            decisions" — but `/coach/progression` was removed from the rail by
            the owner, and `coach-routes.test.tsx` guards that it stays
            unlinked: "re-adding one is a product decision, not a bug fix."
            That guard caught this panel's first draft, which is exactly what
            it is for. So this states where the athlete CAN be read and leaves
            the decision about linking there where it belongs.
          */}
          <p className="rd-panel-note">
            The pillar screens read the signed-in account&rsquo;s own training. Decisions and week
            review are the screens wired to a roster athlete, and both are reached by address
            rather than from here.
          </p>
        </div>
      ) : tally.total === 0 ? (
        <div className="rd-panel">
          <p className="lib-sub">Nothing scheduled or logged this week.</p>
          <p className="rd-panel-note">A week with nothing in it is shown as empty, never filled in.</p>
          <p className="lib-detail-cta-row">
            <Link to="/coach/library" className="lib-cta ghost">Open the Library</Link>
          </p>
        </div>
      ) : (
        <>
          <div className="lib-days" ref={strip}>
            {days.map((day) => {
              const isToday = day.date === today;
              return (
                <div
                  key={day.date}
                  ref={isToday ? todayCol : undefined}
                  className={`lib-day-col${day.entries.length === 0 ? ' empty' : ''}`}
                >
                  <p className={`lib-day-label${isToday ? ' text-gold' : ''}`}>
                    {LABELS[day.index]} {day.date.slice(8)}{isToday ? ' · today' : ''}
                  </p>
                  <div className="lib-day-card">
                    {day.entries.length === 0 ? (
                      <p className="cb-note">Rest</p>
                    ) : (
                      <ul className="lib-ex-list">
                        {day.entries.map((entry) => (
                          <li key={entry.id + entry.status}>
                            <span className="ex-badge" aria-hidden>
                              {entry.status === 'logged' ? '✓' : entry.status === 'active' ? '▶' : '·'}
                            </span>
                            <p>
                              {entry.name}
                              <span className="ex-sets">{STATUS_WORD[entry.status]}</span>
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Counted, never written — the same rule the Settings honesty rows
              follow. A tally that is typed goes stale; one that is derived
              cannot. */}
          <p className="rd-panel-note">{tally.logged} of {tally.total} logged</p>
        </>
      )}
    </section>
  );
}
