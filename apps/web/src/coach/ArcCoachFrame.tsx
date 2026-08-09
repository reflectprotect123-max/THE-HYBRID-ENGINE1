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

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="mx-auto grid min-h-screen max-w-[1440px] bg-bg text-text lg:grid-cols-[208px_minmax(0,1fr)]">
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
        <p className="mt-0.5 pl-[34px] text-[9px] uppercase tracking-wide text-dim">Demo</p>
        <nav
          className="mt-2 flex gap-0.5 overflow-x-auto pb-0.5 text-xs lg:mt-5 lg:grid lg:overflow-visible"
          aria-label="ARC primary navigation"
          onClick={() => setDrawerOpen(false)}
        >
          <ArcNavLink to="/coach" label="Command" count={commandCount} current={!inLibrary && !location.pathname.includes('/settings')} />
          <ArcNavLink to="/coach/library" label="Library" current={inLibrary} />
          <ArcNavLink to="/coach/settings" label="Settings" current={location.pathname.includes('/settings')} />
        </nav>
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
            telling a coach their real athlete is a fixture is its own bug. */}
        {selectedClient && selectedClient.source !== 'engine-local' && !location.pathname.includes('/library') && !location.pathname.includes('/settings') && location.pathname !== '/coach' && (
          <div className="border-b border-warn/40 bg-warn/10 px-3 py-2 text-xs text-muted" role="status">
            {selectedClient.source === 'roster-summary' ? (
              <>
                <strong className="text-text">{selectedClient.name}&apos;s detailed records are not readable yet.</strong>{' '}
                Their weekly counts are real and authorised. Everything below this line is the local athlete&apos;s data, not theirs.
              </>
            ) : (
              <>
                <strong className="text-text">{selectedClient.name} is a synthetic handoff fixture.</strong>{' '}
                Detailed engine records below belong to the local demonstration athlete.
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
    <Link to={to} aria-current={current ? 'page' : undefined} className={`flex pointer-coarse:min-h-11 shrink-0 items-center rounded-md border px-2 py-1.5 transition-colors ${current ? 'border-line2 bg-panel text-text' : 'border-transparent text-muted hover:bg-panel hover:text-text'}`}>
      <span aria-hidden="true" className={`mr-1 h-1 w-1 rounded-full ${current ? 'bg-gold' : 'bg-transparent'}`} />
      <span>{label}</span>
      {count ? <span className="ml-auto rounded-full border border-current px-0.5 text-[9px] tabular-nums">{count}</span> : null}
    </Link>
  );
}
