import { useState } from 'react';
import { LibProvider, useLib } from './store';
import { CoachCloudProvider, useCoachCloud } from './cloud';
import { Editor } from './Editor';
import { emptyWeek, fmtLabel, isCond, newSession, type CoachSession } from './model';
import { BRASS, Chip, Field, GHOST, IconDown, IconRest, IconUp, MICRO, WELL } from './ui';

/*
 * The coach builder. Laptop-only by design: the athlete's phone is the logger,
 * this is where the plan is written, and trying to serve both from one layout
 * is what made the previous builder unusable on either.
 *
 * The shell is the one the kit specifies — rail, week board, wide editor:
 *
 *   design/cards/05-coach-02-rail.html    → the 80px rail
 *   DESIGN-TOKENS.md `--panelw`           → the week board beside it
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
  const { lib, day, setDay, select, update } = useLib();
  const prog = lib.programs[lib.sel.p];
  const week = prog.weeks[lib.sel.w];
  const [publishing, setPublishing] = useState(false);
  const written = week.days.filter(Boolean).length;

  return (
    <div className="grid h-full min-w-[1080px] grid-cols-[80px_320px_minmax(0,1fr)] grid-rows-[64px_minmax(0,1fr)]">
      <Rail
        week={lib.sel.w}
        weeks={prog.weeks.length}
        written={written}
        onPrev={() => select({ w: Math.max(0, lib.sel.w - 1) })}
        onNext={() =>
          update((d) => {
            const p = d.programs[d.sel.p];
            d.sel.w += 1;
            if (!p.weeks[d.sel.w]) p.weeks[d.sel.w] = emptyWeek();
          })
        }
      />

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
        {day ? (
          <Editor publishing={publishing} setPublishing={setPublishing} />
        ) : (
          <RestDay week={lib.sel.w} day={lib.sel.d} onAdd={() => setDay(newSession('Session'))} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------- rail -- */

/**
 * 05-coach-02. The rail carries the mark and the one navigation axis above the
 * week board: which week you are in. The card's Home/Athletes/Library/Analytics
 * buttons are deliberately NOT here — this app has no such screens, and a rail
 * full of controls that do nothing is worse than a short one. The two week
 * controls are the app's existing ones, unchanged down to their labels: `next
 * week` still creates the week when it does not exist yet.
 */
function Rail({
  week,
  weeks,
  written,
  onPrev,
  onNext,
}: {
  week: number;
  weeks: number;
  written: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const step =
    'grid h-4 w-8 place-items-center rounded-sm text-dim transition-colors duration-150 ' +
    'hover:bg-panel2 hover:text-gold2 disabled:pointer-events-none disabled:opacity-30';

  return (
    <aside className="row-span-2 flex flex-col items-center gap-1 border-r border-line bg-panel3 py-1">
      <span
        className="grid h-5 w-5 place-items-center rounded-md border border-line bg-panel text-7 font-[900] text-gold2 [font-family:Georgia,'Times_New_Roman',serif]"
        aria-hidden="true"
      >
        H
      </span>

      <span className="my-1 h-px w-6 bg-line" />

      <span className={MICRO}>Week</span>
      <button className={step} onClick={onPrev} disabled={week === 0} aria-label="previous week">
        <IconUp />
      </button>
      <span className="num text-8 leading-none font-[800] text-gold2">{week + 1}</span>
      <button
        className={step}
        onClick={onNext}
        aria-label="next week"
        title="Next week — created if it does not exist yet"
      >
        <IconDown />
      </button>
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

/* ---------------------------------------------------------------- top bar -- */

/**
 * 05-coach-01. Programme identity on the left, status on the right, and
 * nothing operable in between. The card's "Assign to phone" button is not here
 * on purpose: assigning needs an athlete and a date, both of which live in the
 * editor's Deliver panel, and separating a button from its inputs is how a
 * publish path gets used wrong.
 */
function TopBar({ programme }: { programme: string }) {
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
    <header className="col-span-2 flex items-center gap-2 border-b border-line bg-panel3 px-2">
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
      cond.push(fmtLabel(b.fmt));
      continue;
    }
    for (const e of b.ex) {
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
            {sess ? sess.title || 'Session' : 'Rest day'}
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

/* ------------------------------------------------------------ empty state -- */

/** 03-shared-04. One brass-plated glyph, one sentence, one way forward. */
function RestDay({ week, day, onAdd }: { week: number; day: number; onAdd: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center p-3">
      <div className="w-full max-w-[480px] rounded-lg border border-line2 bg-panel p-4 text-center shadow-card">
        <span className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-md border border-gold-line text-gold2 shadow-brass [background:var(--brass-wash)]">
          <IconRest />
        </span>
        <div className={MICRO}>
          Week {week + 1} · Day {day + 1}
        </div>
        <h1 className="mt-1 text-8 font-[800] tracking-[-.02em]">Rest day</h1>
        <p className="mx-auto mt-1 max-w-[36ch] text-4 text-muted">
          Nothing is written for this day. Leave it as recovery, or start a session — it saves as you go.
        </p>
        <button className={BRASS + ' mt-2 h-6 px-3 text-5'} onClick={onAdd}>
          ＋ Add a session to this day
        </button>
      </div>
    </div>
  );
}
