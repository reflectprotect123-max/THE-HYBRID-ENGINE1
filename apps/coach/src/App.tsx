import { useRef, useState, type KeyboardEvent } from 'react';
import { LibProvider, useLib } from './store';
import { CoachCloudProvider, useCoachCloud } from './cloud';
import { Dashboard } from './Dashboard';
import { GuidedFlow } from './builder/GuidedFlow';
import { WeekGrid } from './builder/WeekGrid';
import { CON_FORMATS, blockExercises, isCond } from '@hybrid/engine';
import { type CoachSession } from './model';
import { BRASS, Chip, Field, GHOST, IconCheck, IconDown, IconUp, MICRO, WELL } from './ui';

/*
 * The coach builder. Laptop-only by design: the athlete's phone is the logger,
 * this is where the plan is written, and trying to serve both from one layout
 * is what made the previous builder unusable on either.
 *
 * The shell is the one the kit specifies — rail, week board, wide editor:
 *
 *   design/cards/05-coach-02-rail.html    → the 80px rail
 *   docs/DESIGN-TOKENS.md `--panelw`           → the week board beside it
 *   design/cards/05-coach-01-top-bar.html → the bar above both
 *   design/cards/05-coach-03-…-pills-…    → the day rows and their previews
 *
 * It is a fixed-viewport grid rather than a scrolling page: the rail and the
 * week board stay put and only the editor scrolls, which is what makes this
 * feel like an authoring tool rather than a document. `min-w` below the
 * three-column width buys a horizontal scrollbar instead of a collapse — the
 * token doc records "desktop-only by construction" as a known, accepted
 * property of this surface, so narrowing it honestly beats pretending.
 */
export function App() {
  return (
    <LibProvider>
      <CoachCloudProvider>
        <Shell />
      </CoachCloudProvider>
    </LibProvider>
  );
}

/* ------------------------------------------------------------------ shell -- */

function Shell() {
  const { lib, day, setDay, select, addWeek } = useLib();
  const prog = lib.programs[lib.sel.p];
  const week = prog.weeks[lib.sel.w];
  const [view, setView] = useState<'home' | 'plan'>('home');
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const written = week.days.filter(Boolean).length;

  if (view === 'plan') {
    return (
      <div className="grid h-full min-w-[1080px] grid-cols-[80px_minmax(0,1fr)] grid-rows-[64px_minmax(0,1fr)]">
        <Rail view={view} onView={setView} week={lib.sel.w} weeks={prog.weeks.length} written={written} onSelect={(w) => { setEditingDay(null); select({ w }); }} onCreate={() => { setEditingDay(null); addWeek(); }} />
        <TopBar programme={prog.name} cols="col-start-2" />
        <main className="col-start-2 min-h-0 overflow-y-auto">
          {editingDay != null && week.days[editingDay] ? (
            <GuidedFlow
              session={week.days[editingDay]!}
              onChange={(s) => { select({ d: editingDay }); setDay(s); }}
              onClose={() => setEditingDay(null)}
            />
          ) : (
            <WeekGrid
              onEdit={(i) => setEditingDay(i)}
              onCreate={(i, s) => { select({ d: i }); setDay(s); setEditingDay(i); }}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="grid h-full min-w-[1080px] grid-cols-[80px_320px_minmax(0,1fr)] grid-rows-[64px_minmax(0,1fr)]">
      <Rail view={view} onView={setView} week={lib.sel.w} weeks={prog.weeks.length} written={written} onSelect={(w) => select({ w })} onCreate={addWeek} />
      <TopBar programme={prog.name} />
      <aside className="flex min-h-0 flex-col border-r border-line bg-panel3">
        <div className="flex shrink-0 items-baseline gap-1 border-b border-line px-2 py-1">
          <h2 className={MICRO}>Week</h2>
          <span className="num text-7 leading-none font-[800] text-gold2">{lib.sel.w + 1}</span>
          <span className="num ml-auto text-2 text-muted">{written} of 7 written</span>
        </div>
        <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1">
          {week.days.map((s, i) => (
            <DayRow key={i} index={i} sess={s} on={i === lib.sel.d} onClick={() => select({ d: i })} />
          ))}
        </ol>
        <AccountPanel />
      </aside>
      <main className="min-h-0 overflow-y-auto">
        <Dashboard />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------- rail -- */

/**
 * 05-coach-02. The rail carries the mark, the view switch, and the one
 * navigation axis above the week board: which week you are in.
 *
 * Home was deliberately absent while this app had no such screen — a rail full
 * of controls that do nothing is worse than a short one. It has one now, so it
 * earns its button. Athletes and Analytics still do not exist and still are
 * not here.
 *
 * Three honest gestures, three controls:
 *  - the chevrons STEP, and only within weeks that exist. `onSelect` clamps in
 *    the store and writes nothing to disk — looking is not authoring.
 *  - stepping past the last week is a different act, so the down-chevron
 *    becomes the kit's dashed add treatment (03-shared-01 `.addbtn`) reading
 *    "＋ New week" when that is what the press would do.
 *  - the big numeral opens a week list (05-coach-06 `.c-menu`), because
 *    reaching week 9 of 12 should not cost eight presses.
 */
function Rail({
  view,
  onView,
  week,
  weeks,
  written,
  onSelect,
  onCreate,
}: {
  view: 'home' | 'plan';
  onView: (v: 'home' | 'plan') => void;
  week: number;
  weeks: number;
  written: number;
  onSelect: (w: number) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const numRef = useRef<HTMLButtonElement>(null);
  const atLast = week >= weeks - 1;
  const close = () => {
    setOpen(false);
    numRef.current?.focus();
  };
  const step =
    'grid h-4 w-8 place-items-center rounded-sm text-dim transition-colors duration-150 ' +
    'hover:bg-panel2 hover:text-gold2 disabled:pointer-events-none disabled:opacity-30';

  return (
    <aside className="row-span-2 flex flex-col items-center gap-1 border-r border-line bg-panel3 py-1">
      <nav className="flex flex-col items-center gap-0.5" aria-label="View">
        {(
          [
            ['home', '⌂', 'Home'],
            ['plan', '⊟', 'Plan'],
          ] as const
        ).map(([k, glyph, label]) => (
          <button
            key={k}
            onClick={() => onView(k)}
            aria-current={view === k ? 'page' : undefined}
            aria-label={label}
            title={label}
            className={
              'grid h-6 w-8 place-items-center rounded-md border text-5 transition-colors duration-150 ' +
              (view === k
                ? 'border-gold-line bg-gold-wash text-gold2'
                : 'border-transparent text-dim hover:bg-panel2 hover:text-gold2')
            }
          >
            {glyph}
          </button>
        ))}
      </nav>

      <span
        className="grid h-5 w-5 place-items-center rounded-md border border-line bg-panel text-7 font-[900] text-gold2 [font-family:Georgia,'Times_New_Roman',serif]"
        aria-hidden="true"
      >
        H
      </span>

      <span className="my-1 h-px w-6 bg-line" />

      <span className={MICRO}>Week</span>
      <button className={step} onClick={() => onSelect(week - 1)} disabled={week === 0} aria-label="previous week">
        <IconUp />
      </button>

      {/* The numeral is the "which week" control: it opens the week list. */}
      <span className="relative">
        <button
          ref={numRef}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`week ${week + 1} of ${weeks} — choose a week`}
          className="num rounded-sm px-0.5 text-8 leading-none font-[800] text-gold2 transition-colors duration-150 hover:bg-panel2"
        >
          {week + 1}
        </button>
        {open ? <WeekMenu count={weeks} current={week} onPick={(w) => { onSelect(w); close(); }} onClose={close} /> : null}
      </span>

      {atLast ? (
        <button
          onClick={onCreate}
          aria-label="new week"
          title={`Add week ${weeks + 1} to the programme`}
          className="flex w-8 flex-col items-center gap-0.5 rounded-sm border border-dashed border-line2 py-0.5 text-dim transition-colors duration-150 hover:border-gold-line hover:text-gold2"
        >
          <span className="text-5 leading-none" aria-hidden="true">
            ＋
          </span>
          <span className="text-1 leading-none font-[800] tracking-[.04em] uppercase">New week</span>
        </button>
      ) : (
        <button className={step} onClick={() => onSelect(week + 1)} aria-label="next week">
          <IconDown />
        </button>
      )}
      <span className="num text-1 text-dim">of {weeks}</span>

      <span className="mt-auto h-px w-6 bg-line" />
      <span className="num text-5 font-[800] text-muted">
        {written}
        <span className="text-dim">/7</span>
      </span>
      <span className={MICRO}>Days</span>
    </aside>
  );
}

/**
 * The week list — 05-coach-06's `.c-menu` (panel2 on line2, lifted, option rows
 * with the gold ✓ on the current one), anchored to the rail's numeral and
 * floating over the week board. Picking a week NAVIGATES; it can never create
 * one — the "＋ New week" control below the numeral is the only creator.
 *
 * Escape closes it, same pattern as the Editor's Picker: the handler lives on
 * the menu itself so it dies with the component, and focus starts inside (on
 * the current week) so the key has somewhere to land. Arrow keys walk the list.
 */
function WeekMenu({
  count,
  current,
  onPick,
  onClose,
}: {
  count: number;
  current: number;
  onPick: (w: number) => void;
  onClose: () => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(e.currentTarget.querySelectorAll('button'));
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    }
  };

  return (
    <>
      {/* Click-away, same as the Picker's backdrop — transparent because this is
          a menu, not a modal. */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        aria-label="choose a week"
        onKeyDown={onKeyDown}
        className="absolute top-0 left-full z-50 ml-1 max-h-[50vh] w-19 overflow-y-auto rounded-md border border-line2 bg-panel2 p-0.5 shadow-lift"
      >
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            role="menuitem"
            autoFocus={i === current}
            aria-current={i === current}
            onClick={() => onPick(i)}
            className={
              'flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-4 transition-colors duration-150 hover:bg-panel3 hover:text-gold2 ' +
              (i === current ? 'font-[750] text-gold2' : 'text-text')
            }
          >
            <span className="flex-1">
              Week <span className="num">{i + 1}</span>
            </span>
            {i === current ? <IconCheck /> : null}
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- top bar -- */

/**
 * 05-coach-01. Programme identity on the left, status on the right, and
 * nothing operable in between. The card's "Assign to phone" button is not here
 * on purpose: assigning needs an athlete and a date, both of which live in the
 * editor's Deliver panel, and separating a button from its inputs is how a
 * publish path gets used wrong.
 */
function TopBar({ programme, cols = 'col-span-2' }: { programme: string; cols?: string }) {
  const { enabled, user } = useCoachCloud();
  const initials =
    programme
      .split(/[\s—-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || 'P';

  return (
    <header className={cols + ' flex items-center gap-2 border-b border-line bg-panel3 px-2'}>
      <span className="text-5 font-[800] tracking-[-.01em] text-gold2">THE Hybrid System</span>
      <span className={MICRO}>Coach</span>

      <span className="h-3 w-px bg-line" />

      <span className="flex min-w-0 items-center gap-1">
        <span
          className="num grid h-3 w-3 shrink-0 place-items-center rounded-sm bg-panel2 text-1 font-[800] text-muted"
          aria-hidden="true"
        >
          {initials}
        </span>
        <b className="truncate text-5 font-[750]">{programme}</b>
      </span>

      {enabled ? (
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-pill border border-line bg-panel2 px-1.5 py-0.5 text-3 font-[650] text-muted"
          title={
            user ? 'Signed in — sessions can be sent to an athlete.' : 'Not signed in — the plan saves to this machine only.'
          }
        >
          <span className={'h-1 w-1 shrink-0 rounded-pill ' + (user ? 'bg-ok' : 'bg-dim')} aria-hidden="true" />
          {user ? user.email : 'Local only'}
        </span>
      ) : null}
    </header>
  );
}

/* ------------------------------------------------------------- week board -- */

/** What a day looks like from the outside — names, set count, whether it runs on HR. */
function preview(s: CoachSession) {
  const names: string[] = [];
  const cond: string[] = [];
  let sets = 0;
  for (const b of s.blocks) {
    if (isCond(b)) {
      cond.push(CON_FORMATS[b.condFmt].name);
      continue;
    }
    for (const e of blockExercises(b)) {
      if (e.name.trim()) names.push(e.name.trim());
      sets += e.sets.length;
    }
  }
  const line = names.length
    ? names.slice(0, 3).join(' · ') + (names.length > 3 ? ' +' + (names.length - 3) : '')
    : cond.length
      ? cond.join(' · ')
      : 'No movements yet';
  return { line, sets, cond: cond.length > 0 };
}

/**
 * 05-coach-03. The round numbered pill is the card's `.c-day`, gold dot and
 * all; the lines beside it are the card's `.c-pvex` session preview, flattened
 * to one line so seven of them fit a laptop without scrolling. Seven identical
 * cards reading "rest" was the complaint — a day now says what is in it before
 * you click it.
 */
function DayRow({
  index,
  sess,
  on,
  onClick,
}: {
  index: number;
  sess: CoachSession | null;
  on: boolean;
  onClick: () => void;
}) {
  const p = sess ? preview(sess) : null;

  return (
    <li>
      <button
        onClick={onClick}
        aria-current={on}
        className={
          'flex w-full items-start gap-1 rounded-md border p-1 text-left transition-colors duration-150 ' +
          (on
            ? 'border-gold-line bg-gold-wash'
            : sess
              ? 'border-line bg-panel hover:border-line2'
              : 'border-dashed border-line2 hover:border-gold-line/50')
        }
      >
        <span
          className={
            'num relative grid h-4 w-4 shrink-0 place-items-center rounded-pill border text-4 font-[750] ' +
            (on
              ? 'border-gold-line bg-gold-wash text-gold2'
              : sess
                ? 'border-line2 bg-panel2 text-text'
                : 'border-line text-dim')
          }
          aria-hidden="true"
        >
          {index + 1}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1">
            <span className={on ? MICRO + ' !text-gold2' : MICRO}>Day {index + 1}</span>
            {p && p.sets ? <span className="num ml-auto text-1 text-dim">{p.sets} sets</span> : null}
          </span>

          <b
            className={
              'block truncate text-5 leading-tight font-[750] ' +
              (on ? 'text-gold2' : sess ? 'text-text' : 'text-dim')
            }
          >
            {sess ? sess.name || 'Session' : 'Rest day'}
          </b>

          {p ? (
            <span className="mt-0.5 flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-3 leading-tight text-muted">{p.line}</span>
              {p.cond ? <Chip tone="cond">♥ HR</Chip> : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/* ---------------------------------------------------------- account panel -- */

/*
 * Sign-in and invite codes.
 *
 * This used to be two bare inputs wedged into the top bar next to the wordmark,
 * which is a placement rather than a design. It is now a named panel in the
 * board's footer — 05-coach-04's labelled `.c-field` frame — so the account is
 * something the coach owns rather than debris in the chrome. Nothing moved
 * behind a disclosure: every control reachable before is still reachable
 * without a click.
 *
 * An invite is the ONLY route to a coach link: the RLS policies give a coach no
 * way to attach themselves to an athlete, so the athlete typing the code is the
 * consent step.
 */
function AccountPanel() {
  const { enabled, user, invites, loadError, signIn, signUp, signOut, createInvite, revokeInvite } = useCoachCloud();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  if (!enabled) return null;

  return (
    /* Capped, with its own scroll: expanding the invite list must not eat the
       week board it sits under. */
    <div className="max-h-[52%] shrink-0 overflow-y-auto border-t border-line px-1.5 py-2">
      <Field label={user ? 'Coach account' : 'Sign in'} className="bg-panel">
        {!user ? (
          <div className="flex flex-col gap-1">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              aria-label="email"
              autoComplete="username"
              className={WELL + ' h-4 w-full px-1 text-4'}
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Password"
              aria-label="password"
              autoComplete="current-password"
              className={WELL + ' h-4 w-full px-1 text-4'}
            />
            <div className="flex gap-1">
              <button onClick={async () => setMsg((await signIn(email, password)) || '')} className={BRASS + ' flex-1'}>
                Sign in
              </button>
              <button
                onClick={async () => setMsg((await signUp(email, password)) || '')}
                className={GHOST + ' h-5 flex-1'}
              >
                Create
              </button>
            </div>
            <p className="text-2 text-dim">The plan saves locally either way — an account is what reaches a phone.</p>
            {msg ? <p className="text-3 text-warn">{msg}</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span
                className="grid h-4 w-4 shrink-0 place-items-center rounded-pill border border-gold-line text-3 font-[800] text-gold2 shadow-brass [background:var(--brass-wash)]"
                aria-hidden="true"
              >
                {(user.email || '?')[0].toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-4 text-text">{user.email}</span>
              <button onClick={() => void signOut()} className="shrink-0 text-3 text-dim hover:text-bad">
                Sign out
              </button>
            </div>

            <button onClick={() => setOpen((o) => !o)} className={GHOST + ' w-full'} aria-expanded={open}>
              Athletes &amp; invites
            </button>

            {open ? (
              <div className="flex flex-col gap-1 border-t border-line pt-1">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Name for this athlete (only you see it)"
                  aria-label="athlete label"
                  className={WELL + ' h-4 w-full px-1 text-3'}
                />
                <button
                  onClick={async () => {
                    setMsg((await createInvite(label)) || 'Invite created — share the code.');
                    setLabel('');
                  }}
                  className={BRASS + ' w-full'}
                >
                  ＋ Invite
                </button>
                {msg ? <p className="text-3 text-muted">{msg}</p> : null}
                {loadError ? <p className="text-3 text-warn">{loadError}</p> : null}
                {invites.length ? (
                  <ul className="flex flex-col gap-1">
                    {invites.map((i) => (
                      <li key={i.id} className="flex flex-col gap-0.5 rounded-md border border-line bg-panel2 p-1">
                        <div className="flex items-center gap-1">
                          <span className="num rounded-sm border border-gold-line bg-gold-wash px-1 py-0.5 text-4 font-[800] tracking-[.2em] text-gold2">
                            {i.token}
                          </span>
                          <button
                            onClick={async () => setMsg((await revokeInvite(i.id)) || 'Invite revoked.')}
                            className="ml-auto shrink-0 text-3 text-dim hover:text-bad"
                          >
                            revoke
                          </button>
                        </div>
                        <span className="truncate text-3 text-muted">{i.label || 'unnamed'} · not claimed yet</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-3 text-dim">No pending invites. Create one and give the code to your athlete.</p>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Field>
    </div>
  );
}
