import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useDb } from '../store/db';
import { useProgressionLedger } from './progression-store';
import { useCoachWorkspace } from './CoachWorkspaceContext';

export function ArcCoachFrame() {
  const { weeklyPlan } = useDb();
  const ledger = useProgressionLedger();
  const location = useLocation();
  const { selectedClient } = useCoachWorkspace();
  const decided = new Set(ledger.decisions.map((decision) => decision.proposalId));
  const pending = ledger.proposals.filter((proposal) => !decided.has(proposal.id)).length;
  const weekExceptions = weeklyPlan.decisions.filter((decision) => decision.action === 'dropped').length;
  const commandCount = pending + weekExceptions;
  const inLibrary = location.pathname.includes('/library') || location.pathname.includes('/author') || location.pathname.includes('/build/') || location.pathname.includes('/planner/');
  const inSettings = location.pathname.includes('/settings');
  const inReview = location.pathname.includes('/review/');
  const inProgression = location.pathname.includes('/progression');
  const inLegacy = location.pathname.includes('/legacy');

  /*
   * The Stage-1 Command Center is four pillar tiles and nothing else — the
   * approved mockup's `#view-command` has no slot for anything more, and the
   * old screen's system-links row went with the rewrite. Three routes lost
   * their ONLY inbound link with it: `/coach/review/:weekStart`,
   * `/coach/progression` and `/coach/legacy`. `/coach/progression` is the
   * worst of the three — with a roster client selected, every pillar tile
   * correctly badges a pending count and then dead-ends at
   * `ClientDetailGate`'s refusal (the pillars read local stores, so they are
   * gated WITHOUT `layer3Ready` by design), and this route is the only place
   * in the app `RosterProgressionActions` is mounted. Roster approve/decline
   * was unreachable.
   *
   * They live in the rail rather than back in the tile grid: the rail is
   * outside the mockup's Stage-1 scope, already holds Command / Library /
   * Settings, and is where a coach looks for a workspace-level destination.
   * Same `ArcNavLink`, same styling, no new visual language — and because
   * the rail is the drawer below `sm`, they are reachable at phone width by
   * construction rather than by a second layout.
   *
   * Each entry is gated on where it actually LEADS, not merely on where it
   * is declared:
   *  - Week review is `layer3Ready`, so it works for both a local and a
   *    roster client. Always shown. `weeklyPlan.weekStart` is the same
   *    computation the pre-redesign Command Center used for this link —
   *    a real week, not `today` re-derived here.
   *  - Decisions (`/coach/progression`) REDIRECTS a local coach to
   *    `/coach/strength`, which now owns the self-coach queue
   *    (CoachProgression.tsx). A nav entry that bounces you elsewhere is
   *    worse than no entry, so it appears only when the selected client is
   *    not local. `!selectedClient` counts as local — the exact condition
   *    CoachProgression itself branches on, not a re-derived approximation.
   *  - Program bench (`/coach/legacy`) is gated WITHOUT `layer3Ready` and
   *    refuses a roster client, so it appears only for a local one. This
   *    matches what the old system-links row did: it rendered the whole row
   *    only for `engine-local`.
   */
  const isLocalClient = !selectedClient || selectedClient.source === 'engine-local';

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
          <ArcNavLink to="/coach" label="Command" count={commandCount} current={!inLibrary && !inSettings && !inReview && !inProgression && !inLegacy} />
          <ArcNavLink to="/coach/library" label="Library" current={inLibrary} />
          <ArcNavLink to={`/coach/review/${weeklyPlan.weekStart}`} label="Week review" current={inReview} />
          {!isLocalClient && <ArcNavLink to="/coach/progression" label="Decisions" current={inProgression} />}
          {isLocalClient && <ArcNavLink to="/coach/legacy" label="Program bench" current={inLegacy} />}
          <ArcNavLink to="/coach/settings" label="Settings" current={inSettings} />
        </nav>
        {/*
         * The bench has no other exit: `/` redirects here on the unscoped
         * build (App.tsx), so a coach account with no reachable athlete link
         * is stuck in the bench even though `/home` has always worked as a
         * direct address on every build. One real link, not a URL a coach
         * has to already know to type.
         */}
        <Link
          to="/home"
          className="mt-2 flex w-full shrink-0 items-center rounded-md border border-line2 px-2 py-1.5 text-xs text-muted transition-colors hover:bg-panel hover:text-text lg:mt-3"
        >
          <span aria-hidden="true" className="mr-1 h-1 w-1 rounded-full bg-transparent" />
          <span>Athlete app</span>
        </Link>
        <details className="mt-5 hidden border-t border-line pt-2 text-[11px] text-muted lg:block">
          <summary className="cursor-pointer select-none text-[9px] uppercase tracking-wider text-dim">How ARC decides</summary>
          <p className="mt-1">Strength and Conditioning propose. The Coordinator resolves. Nutrition remains context.</p>
        </details>
        {(location.pathname.includes('/build/') || location.pathname.includes('/planner/')) && (
          <div className="mt-1.5 rounded-md border border-gold-line bg-gold-wash p-1.5 text-[11px] text-muted">
            <p className="text-[9px] uppercase tracking-wider text-gold2">Coach authoring mode</p>
            <p className="mt-0.5">You are editing a specialist proposal input—not logging an athlete session and not placing the resolved week.</p>
          </div>
        )}
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
