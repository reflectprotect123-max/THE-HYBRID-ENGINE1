import { useState } from 'react';
import { LibProvider, useLib } from './store';
import { CoachCloudProvider, useCoachCloud } from './cloud';
import { Editor } from './Editor';
import { emptyWeek, newSession } from './model';

/*
 * The coach builder. Laptop-only by design: the athlete's phone is the logger,
 * this is where the plan is written, and trying to serve both from one layout
 * is what made the previous builder unusable on either.
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

/* Sign-in and invite codes. An invite is the ONLY route to a coach link: the
   RLS policies give a coach no way to attach themselves to an athlete, so the
   athlete typing the code is the consent step. */
function AccountBar() {
  const { enabled, user, invites, loadError, signIn, signUp, signOut, createInvite, revokeInvite } = useCoachCloud();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  if (!enabled) return null;

  if (!user) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="email"
          aria-label="email"
          className="h-4 rounded-md border border-line bg-well px-1 text-3 text-text outline-none focus:border-gold-line"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="password"
          aria-label="password"
          className="h-4 rounded-md border border-line bg-well px-1 text-3 text-text outline-none focus:border-gold-line"
        />
        <button
          onClick={async () => setMsg((await signIn(email, password)) || '')}
          className="h-4 rounded-md px-1.5 text-3 font-[650] text-[#1b1509] [background:var(--brass)]"
        >
          Sign in
        </button>
        <button
          onClick={async () => setMsg((await signUp(email, password)) || '')}
          className="h-4 rounded-md border border-line2 px-1.5 text-3 text-muted hover:text-text"
        >
          Create
        </button>
        {msg ? <span className="text-3 text-warn">{msg}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-3 text-muted">{user.email}</span>
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-4 rounded-md border border-line2 px-1.5 text-3 text-muted hover:text-text"
      >
        Athletes &amp; invites
      </button>
      <button onClick={() => void signOut()} className="h-4 px-1 text-3 text-dim hover:text-text">
        Sign out
      </button>

      {open ? (
        <div className="w-full rounded-md border border-line bg-panel p-2">
          <div className="flex flex-wrap items-center gap-1">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Name for this athlete (only you see it)"
              aria-label="athlete label"
              className="h-4 min-w-[220px] flex-1 rounded-md border border-line bg-well px-1 text-3 text-text outline-none focus:border-gold-line"
            />
            <button
              onClick={async () => {
                setMsg((await createInvite(label)) || 'Invite created — share the code.');
                setLabel('');
              }}
              className="h-4 rounded-md px-1.5 text-3 font-[650] text-[#1b1509] [background:var(--brass)]"
            >
              ＋ Invite
            </button>
          </div>
          {msg ? <p className="mt-1 text-3 text-muted">{msg}</p> : null}
          {loadError ? <p className="mt-1 text-3 text-warn">{loadError}</p> : null}
          {invites.length ? (
            <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-line pt-1.5">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center gap-1">
                  <span className="num rounded-sm border border-gold-line bg-gold-wash px-1 text-4 font-[800] tracking-[.2em] text-gold2">
                    {i.token}
                  </span>
                  <span className="flex-1 text-3 text-muted">{i.label || 'unnamed'} · not claimed yet</span>
                  <button
                    onClick={async () => setMsg((await revokeInvite(i.id)) || 'Invite revoked.')}
                    className="text-3 text-dim hover:text-bad"
                  >
                    revoke
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-3 text-dim">No pending invites. Create one and give the code to your athlete.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Shell() {
  const { lib, day, setDay, select, update } = useLib();
  const prog = lib.programs[lib.sel.p];
  const week = prog.weeks[lib.sel.w];
  const [publishing, setPublishing] = useState(false);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-panel3/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 px-3 py-1.5">
          <span className="text-6 font-[800] text-gold2">THE Hybrid System</span>
          <span className="text-3 text-dim">coach</span>

          <AccountBar />

          <div className="ml-auto flex items-center gap-1">
            <button
              className="h-4 rounded-md border border-line2 px-1 text-3 text-muted hover:text-text"
              onClick={() => select({ w: Math.max(0, lib.sel.w - 1) })}
              aria-label="previous week"
            >
              ‹
            </button>
            <span className="num min-w-10 text-center text-4 font-[750]">Week {lib.sel.w + 1}</span>
            <button
              className="h-4 rounded-md border border-line2 px-1 text-3 text-muted hover:text-text"
              onClick={() =>
                update((d) => {
                  const p = d.programs[d.sel.p];
                  d.sel.w += 1;
                  if (!p.weeks[d.sel.w]) p.weeks[d.sel.w] = emptyWeek();
                })
              }
              aria-label="next week"
            >
              ›
            </button>
          </div>

          <ul className="flex w-full gap-1">
            {week.days.map((s, i) => (
              <li key={i} className="flex-1">
                <button
                  onClick={() => select({ d: i })}
                  aria-current={i === lib.sel.d}
                  className={
                    'w-full rounded-md border px-1 py-1 text-3 font-[750] transition-colors duration-120 ' +
                    (i === lib.sel.d
                      ? 'border-gold-line bg-gold-wash text-gold2'
                      : s
                        ? 'border-line2 bg-panel2 text-text'
                        : 'border-line bg-panel text-dim hover:text-muted')
                  }
                >
                  Day {i + 1}
                  <span className="mt-0.5 block truncate text-2 font-[500] text-dim">
                    {s ? s.title || 'Session' : 'rest'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <main className="mx-auto max-w-[820px] px-3 py-3">
        {day ? (
          <Editor publishing={publishing} setPublishing={setPublishing} />
        ) : (
          <div className="rounded-lg border border-line bg-panel p-4 text-center shadow-card">
            <div className="text-2 font-[750] uppercase tracking-[.14em] text-dim">
              Week {lib.sel.w + 1} · Day {lib.sel.d + 1}
            </div>
            <h1 className="mt-1 text-8 font-[800]">Rest day</h1>
            <button
              className="mt-2 h-5 rounded-md px-2 text-5 font-[650] text-[#1b1509] shadow-brass [background:var(--brass)]"
              onClick={() => setDay(newSession('Session'))}
            >
              ＋ Add a session to this day
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
