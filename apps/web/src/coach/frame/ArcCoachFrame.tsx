import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useDb } from '../../store/db';
import { useProgressionLedger } from '../../store/progression';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import { useDesktopView, useViewportMetaApplies } from './useDesktopView';

export function ArcCoachFrame() {
  const ledger = useProgressionLedger();
  const location = useLocation();
  const { selectedClient } = useCoachWorkspace();
  const desktopView = useDesktopView();
  const canSwitchViewport = useViewportMetaApplies();
  const decided = new Set(ledger.decisions.map((decision) => decision.proposalId));
  const pending = ledger.proposals.filter((proposal) => !decided.has(proposal.id)).length;
  /* Was `pending + weekExceptions`, where the second half counted the
     Coordinator's dropped decisions. The Coordinator is deleted (14 August
     2026), so the only thing left to badge is undecided progression
     proposals — which is what the number now means, exactly. */
  const commandCount = pending;
  const inLibrary = location.pathname.includes('/library');
  const inSettings = location.pathname.includes('/settings');

  /*
   * The rail is Command / Library / Settings, and nothing else.
   *
   * Stage 1 added three more entries here — Week review
   * (`/coach/review/:weekStart`), Decisions (`/coach/progression`) and
   * Program bench (`/coach/legacy`) — because the redesigned Command Center
   * had dropped the old system-links row and left those routes with no
   * inbound link at all. Linking them fixed the orphan and, in doing so, put
   * three pre-redesign screens back in front of the coach as permanent tabs.
   * The owner deleted all three from the rail on 11 August 2026.
   *
   * The ROUTES survive, unlinked and reachable by address. That is
   * deliberate, not an oversight: `/coach/progression` is still the only
   * place `RosterProgressionActions` is mounted, so it is the only roster
   * approve/decline in the app, and deleting the route would delete the
   * capability. Re-homing those capabilities into the pillar screens is the
   * work that retires the routes; until then, do NOT "fix" this by re-adding
   * nav entries — the orphan is the owner's decision, and it is recorded
   * here so the next reader does not re-derive Stage 1's reasoning and undo
   * it.
   */

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  /*
   * `max-lg:auto-rows-min` (found while verifying phone width, task 8, then
   * re-measured after review flagged that the comment claimed a range that
   * was never actually checked): below `lg` this grid has exactly two
   * IN-FLOW rows sharing the height `min-h-screen` reserves. Below `sm`
   * that's the hamburger bar plus the `<Outlet/>` wrapper (`<aside>` is
   * `fixed`/off-canvas there); from `sm` up to `lg` it's `<aside>` ITSELF,
   * now `sm:static` and rendered as a horizontal top bar (`sm:border-b`,
   * not yet `lg:border-r`), plus the same wrapper. Only at `lg` does
   * `<aside>` become the two-column sidebar via `lg:grid-cols`, collapsing
   * back to a single row.
   *
   * CSS Grid's default `align-content` is `stretch`, so wherever there are
   * two `auto` row tracks and total content is shorter than the viewport,
   * the leftover height gets split between them — measured directly (not
   * assumed): at 420px wide the ~121px hamburger bar inflated to 315.75px,
   * a ~195px (~200px) growth of dead space above every pillar's content;
   * the same inflation was confirmed at 768/820/1023px wide, where
   * `<aside>`-as-top-bar grew to 340-360px instead of its own natural
   * content height. `auto-rows-min` caps both rows at their own content
   * height instead, for the whole below-`lg` range where this shape holds.
   * At `lg` and up there is only one row again, and it DOES want to stretch
   * to the viewport's full height (the sidebar look) — untouched here.
   */
  return (
    <div className="mx-auto grid min-h-screen max-w-[1440px] bg-bg text-text max-lg:auto-rows-min lg:grid-cols-[208px_minmax(0,1fr)]">
      {/*
        DESKTOP VIEW, and why it is `fixed` rather than living in the phone
        bar above.
        `/coach` is composed at 1440px; phone is a supported second viewport,
        not a replacement, so the phone layout necessarily drops what a wide
        one holds side by side. This is the way back to the whole dashboard —
        what a browser's "Request desktop site" does, remembered, and scoped
        to this bench.
        The obvious home for it was the `sm:hidden` phone bar. That is a
        TRAP: turning it on makes the viewport 1440px, which is above `sm`,
        which hides that bar — taking the only way back with it. So it sits
        outside the responsive layout entirely and is reachable in both
        states.
        Rendered only where the viewport meta does anything at all. A desktop
        browser ignores that tag, so showing this there would ship a control
        that silently fails.
      */}
      {canSwitchViewport && (
        <button
          type="button"
          onClick={desktopView.toggle}
          aria-pressed={desktopView.on}
          className={`fixed bottom-3 right-3 z-40 min-h-11 rounded-full border px-3 text-xs font-semibold shadow-lg ${
            desktopView.on ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 bg-panel text-muted'
          }`}
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          {desktopView.on ? 'Phone view' : 'Desktop view'}
        </button>
      )}
      <div className="flex items-center gap-2 border-b border-line2 bg-panel3 px-2 py-2 sm:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open coach navigation"
          aria-expanded={drawerOpen}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line2 bg-panel"
        >
          <span className="h-4 w-1 rounded-full bg-gold" aria-hidden="true" />
        </button>
        <p className="text-sm font-semibold">Coach workspace</p>
      </div>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 sm:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        aria-hidden={!drawerOpen}
        className={`fixed inset-y-0 left-0 z-40 w-[240px] -translate-x-full overflow-y-auto border-r border-line2 bg-panel3 px-2 py-2 transition-transform duration-200 invisible sm:visible sm:static sm:z-auto sm:w-auto sm:translate-x-0 sm:border-b sm:transition-none lg:border-b-0 lg:border-r lg:px-2.5 lg:py-3 ${drawerOpen ? 'visible translate-x-0' : ''}`}
      >
        <Link to="/coach" className="flex items-center gap-1.5" aria-label="ARC coach command center">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-gold-line/70 bg-gold-wash text-sm font-black text-gold2">A</div>
          <div className="min-w-0"><p className="text-[9px] uppercase tracking-[.2em] text-gold">ARC</p><p className="text-sm font-semibold leading-tight">Coach workspace</p></div>
        </Link>
        <nav
          className="mt-2 flex flex-col gap-0.5 text-xs sm:flex-row sm:overflow-x-auto sm:pb-0.5 lg:mt-5 lg:grid lg:overflow-visible"
          aria-label="ARC primary navigation"
          onClick={() => setDrawerOpen(false)}
        >
          <ArcNavLink to="/coach" label="Command" count={commandCount} current={!inLibrary && !inSettings} />
          <ArcNavLink to="/coach/library" label="Library" current={inLibrary} />
          <ArcNavLink to="/coach/settings" label="Settings" current={inSettings} />
        </nav>
        {/*
         * The bench has no other exit: `/` redirects here on the unscoped
         * build (App.tsx), so a coach account with no reachable athlete link
         * is stuck in the bench even though `/home` has always worked as a
         * direct address on every build. One real link, not a URL a coach
         * has to already know to type.
         */}
        {/*
          The "Athlete app" link is GONE (13 August 2026).

          It existed for one reason, written here at the time: `/` redirects
          to the bench, so a coach account with no reachable athlete link was
          stuck. The athlete web app is parked now (see App.tsx) and every
          non-coach address redirects HERE — so the link would have pointed at
          a route that bounces straight back, which is worse than no link.

          Restoring the athlete app means restoring this too, or the coach is
          stuck again for exactly the original reason.
        */}
        <details className="mt-5 hidden border-t border-line pt-2 text-[11px] text-muted lg:block">
          <summary className="cursor-pointer select-none text-[9px] uppercase tracking-wider text-dim">How ARC decides</summary>
          {/* Said "Strength and Conditioning propose. The Coordinator resolves."
              until 14 August 2026. The Coordinator is deleted and nothing
              arbitrates a week — a header telling a coach otherwise is the
              worst kind of stale, because it describes authority. */}
          <p className="mt-1">You write the week. Strength and Conditioning inform it. Nutrition remains context.</p>
        </details>
        {/* A "Coach authoring mode" panel keyed on `/build/` and `/planner/`
            stood here until 19 August 2026 — routes the old authoring chain
            owned and coach-contract rule 8 now forbids ever re-declaring. A
            branch that can never render is deleted, not kept "just in case". */}
      </aside>
      <div className="min-w-0">
        {/* The warning is keyed on "detail is not this person's", which is true
            of both non-local states — but they are not the same fact, and
            telling a coach their real athlete is a fixture is its own bug.

            Reworded 11 August 2026 (Stage-1 final review): it used to say
            "Everything below this line is the local athlete's data, not
            theirs", which was true when every route rendered through and
            merely disclosed. The four pillar routes are gated WITHOUT
            `layer3Ready` and now REFUSE outright, so on those routes that
            sentence sat above a refusal page describing data that is not
            there. The frame deliberately does not re-derive each route's
            gate verdict — `layer3Ready` is per-route and owned by
            index.tsx — so the copy states the RULE, which holds on every
            route, instead of asserting what a particular one rendered. */}
        {selectedClient && selectedClient.source !== 'engine-local' && !location.pathname.includes('/library') && !location.pathname.includes('/settings') && location.pathname !== '/coach' && (
          <div className="border-b border-warn/40 bg-warn/10 px-3 py-2 text-xs text-muted" role="status">
            {selectedClient.source === 'roster-summary' ? (
              <>
                <strong className="text-text">{selectedClient.name}&apos;s detailed records are not readable yet.</strong>{' '}
                Their weekly counts are real and authorised. Where a tool cannot read them it refuses to open, rather
                than showing you the local athlete&apos;s records under {selectedClient.name}&apos;s name.
              </>
            ) : (
              <>
                <strong className="text-text">{selectedClient.name} is a synthetic handoff fixture.</strong>{' '}
                There is nothing real behind it. A tool that needs detailed engine records refuses to open, rather than
                showing you the local demonstration athlete&apos;s under this name.
              </>
            )}
          </div>
        )}
        <Outlet />
      </div>
    </div>
  );
}

function ArcNavLink({ to, label, current, count }: { to: string; label: string; current: boolean; count?: number }) {
  return (
    <Link to={to} aria-current={current ? 'page' : undefined} className={`flex w-full pointer-coarse:min-h-11 shrink-0 items-center rounded-md border px-2 py-1.5 transition-colors sm:w-auto ${current ? 'border-line2 bg-panel text-text' : 'border-transparent text-muted hover:bg-panel hover:text-text'}`}>
      <span aria-hidden="true" className={`mr-1 h-1 w-1 rounded-full ${current ? 'bg-gold' : 'bg-transparent'}`} />
      <span>{label}</span>
      {count ? <span className="ml-auto rounded-full border border-current px-0.5 text-[9px] tabular-nums">{count}</span> : null}
    </Link>
  );
}
