import { useMemo, useState } from 'react';
import { conMaxHr, conZones, restingHr, type Profile } from '@hybrid/engine';
import { useDb } from '../store/db';
import { useSync } from '../cloud/sync';
import { useWhoop } from '../cloud/whoop';
import { Button, Card, Kicker, ScreenTitle, SectionHead } from '../ui';

/*
 * Settings is short on purpose. The only values here are the ones that change
 * what the engine computes — everything else the app can work out for itself.
 */
export function Settings() {
  const { db, settings, hr, whoop, update, saveFailed } = useDb();
  const profile = settings.profile || {};
  const zones = useMemo(() => conZones(hr), [hr]);
  const [busy, setBusy] = useState(false);

  function setProfile(patch: Partial<Profile>) {
    update((draft) => {
      draft.settings.profile = { ...(draft.settings.profile || {}), ...patch };
      draft.settings.updatedAt = Date.now();
    });
  }

  function exportBackup() {
    setBusy(true);
    const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hybrid-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <>
      <Kicker>Settings</Kicker>
      <ScreenTitle>Your numbers</ScreenTitle>

      {saveFailed ? (
        <Card className="mt-2 border-[color:var(--color-bad)]/40 bg-[color:var(--color-bad)]/10">
          <p className="text-4 text-bad">
            The last save failed — usually private browsing or a full disk. Export a backup before you train again.
          </p>
        </Card>
      ) : null}

      <SectionHead title="Profile" />
      <Card className="flex flex-col gap-1.5">
        <Num
          label="Age"
          hint="Used for the Tanaka max-HR estimate (208 − 0.7 × age)."
          value={profile.age}
          onChange={(v) => setProfile({ age: v })}
        />
        <Num
          label="Max HR"
          hint="A tested max wins over the estimate. Leave blank to use the estimate."
          value={profile.maxHr}
          onChange={(v) => setProfile({ maxHr: v })}
        />
        <Num
          label="Resting HR"
          hint="With this, zones use Karvonen instead of percent-of-max — a real improvement if you're well trained."
          value={profile.restingHr}
          onChange={(v) => setProfile({ restingHr: v })}
        />
      </Card>

      <SectionHead title="What that produces" />
      <Card>
        <p className="num text-4 text-muted">
          Max {conMaxHr(profile)} · resting {restingHr(profile, whoop) ?? '—'} · method{' '}
          {zones.method === 'hrr' ? 'Karvonen (HRR)' : 'percent of max'}
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {zones.list.map((b) => (
            <li key={b.key} className="flex items-center gap-1">
              <span className="flex-1 text-4 font-[650]">{b.name}</span>
              <span className="num text-4 text-muted">
                {b.lo}–{b.hi}
              </span>
            </li>
          ))}
        </ul>
        {zones.adj !== 0 ? (
          <p className="mt-1 text-3 text-gold2">
            Shifted today for {zones.rec}% recovery. The earned baseline is untouched — this is a daily gate only.
          </p>
        ) : null}
      </Card>

      <CloudCard />
      <CoachLinkCard />
      <WhoopCard />

      <SectionHead title="Your data" />
      <Card className="flex flex-col gap-1">
        <p className="num text-4 text-muted">
          {db.workouts.length} sessions in the library · {db.sessions.length} logged
        </p>
        <Button onClick={exportBackup} disabled={busy}>
          Export a backup
        </Button>
        <p className="text-3 text-dim">
          A plain JSON file with everything on this device. Keeping one is worth the ten seconds.
        </p>
      </Card>
    </>
  );
}

function CloudCard() {
  const { enabled, user, busy, error, syncedAt, signIn, signUp, signOut, syncNow } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [working, setWorking] = useState(false);

  if (!enabled) return null;

  const go = async (fn: (e: string, p: string) => Promise<string | null>) => {
    setWorking(true);
    setMsg((await fn(email, password)) || '');
    setWorking(false);
  };

  return (
    <>
      <SectionHead title="Cloud sync" />
      <Card>
        {user ? (
          <>
            <p className="text-4 text-muted">
              Signed in as <b className="text-text">{user.email}</b>
            </p>
            <p className="mt-0.5 text-3 text-dim">
              {busy
                ? 'Syncing…'
                : syncedAt
                  ? 'Last synced ' + new Date(syncedAt).toLocaleTimeString()
                  : 'Not synced yet this session.'}
            </p>
            {error ? <p className="mt-1 text-3 text-bad">{error}</p> : null}
            <div className="mt-1.5 flex gap-1">
              <Button onClick={() => void syncNow()} disabled={busy}>
                Sync now
              </Button>
              <Button variant="quiet" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
            <p className="mt-1 text-3 text-dim">
              Devices merge by record rather than overwriting, so logging on your phone and scheduling on a laptop
              between syncs will not cost you either one.
            </p>
          </>
        ) : (
          <>
            <p className="text-4 text-muted">Sign in to sync across devices and receive sessions from a coach.</p>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="email"
              aria-label="email"
              className="mt-1 h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="password"
              aria-label="password"
              className="mt-1 h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
            />
            {msg ? <p className="mt-1 text-3 text-warn">{msg}</p> : null}
            <div className="mt-1.5 flex gap-1">
              <Button variant="brass" disabled={working} onClick={() => void go(signIn)}>
                Sign in
              </Button>
              <Button disabled={working} onClick={() => void go(signUp)}>
                Create account
              </Button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function CoachLinkCard() {
  const { enabled, user, coachLinked, claimInvite } = useSync();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (!enabled || !user) return null;

  return (
    <>
      <SectionHead title="Your coach" />
      <Card>
        {coachLinked ? (
          <p className="text-4 text-muted">
            Linked. Sessions your coach assigns appear in your Library automatically, and they can see a summary of
            your training — never your heart-rate traces, notes or settings, and only the last 90 days.
          </p>
        ) : (
          <>
            <p className="text-4 text-muted">
              Got a code from a coach? Entering it is what grants them access — they cannot link to you on their own.
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="INVITE CODE"
              aria-label="invite code"
              className="num mt-1 h-5 w-full rounded-md border border-line bg-well px-1 text-center text-5 font-[750] tracking-[.2em] uppercase outline-none focus:border-gold-line"
            />
            {msg ? <p className="mt-1 text-3 text-warn">{msg}</p> : null}
            <Button
              variant="brass"
              className="mt-1.5"
              disabled={busy || !code.trim()}
              onClick={async () => {
                setBusy(true);
                setMsg((await claimInvite(code)) || 'Linked — your coach can now assign you sessions.');
                setBusy(false);
              }}
            >
              {busy ? 'Linking…' : 'Link to coach'}
            </Button>
          </>
        )}
      </Card>
    </>
  );
}

function WhoopCard() {
  const { connected, sample, busy, error, lastSyncAt, connect, sync, disconnect } = useWhoop();
  return (
    <>
      <SectionHead title="WHOOP" />
      <Card>
        {connected ? (
          <>
            <p className="text-4 text-muted">
              Connected
              {sample?.recoveryScore != null ? (
                <>
                  {' '}· today&apos;s recovery <b className="text-gold2">{Math.round(Number(sample.recoveryScore))}%</b>
                </>
              ) : ' · no reading yet today'}
            </p>
            {lastSyncAt ? (
              <p className="mt-0.5 text-3 text-dim">Last pulled {new Date(lastSyncAt).toLocaleString()}</p>
            ) : null}
            <div className="mt-1.5 flex gap-1">
              <Button onClick={() => void sync()} disabled={busy}>
                {busy ? 'Pulling…' : 'Pull now'}
              </Button>
              <Button variant="quiet" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-4 text-muted">
              Connect WHOOP and your zones re-tune to the day: a low-recovery morning widens the easy band and pulls
              the hard line down.
            </p>
            <Button variant="brass" className="mt-1.5" onClick={connect}>
              Connect WHOOP
            </Button>
          </>
        )}
        {error ? <p className="mt-1 text-3 text-dim">{error}</p> : null}
      </Card>
    </>
  );
}

function Num({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">{label}</span>
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="num mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 font-[750] shadow-well outline-none focus:border-gold-line"
      />
      <span className="mt-0.5 block text-3 text-dim">{hint}</span>
    </label>
  );
}
