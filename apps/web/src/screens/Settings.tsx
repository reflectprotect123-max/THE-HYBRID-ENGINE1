import { useMemo, useState } from 'react';
import {
  applyConcept2Import,
  concept2ImportSummary,
  conMaxHr,
  conZones,
  ensureSharedCore,
  planConcept2Import,
  restingHr,
  restoreDb,
  todayRecovery,
  ymd,
  type Concept2ImportCounts,
  type Profile,
  type RestoreReport,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { useSync } from '../cloud/sync';
import { useWhoop } from '../cloud/whoop';
import { useConcept2 } from '../cloud/concept2';
import { Button, Card, Kicker, ScreenTitle, SectionHead } from '../ui';
import { humanizeError } from '../errors';

/*
 * Settings is short on purpose. The only values here are the ones that change
 * what the engine computes — everything else the app can work out for itself.
 */
export function Settings() {
  const { db, settings, hr, whoop, update, saveFailed } = useDb();
  const profile = settings.profile || {};
  const zones = useMemo(() => conZones(hr), [hr]);
  const [busy, setBusy] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const [restoreErr, setRestoreErr] = useState(false);

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

  /**
   * Load a backup back in.
   *
   * Reads and parses BEFORE touching the store, so a corrupt or wrong file
   * leaves the app exactly as it was — the one thing a restore must never do
   * is half-apply. The input is cleared afterwards so picking the same file
   * twice still fires `change`.
   */
  async function onRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setRestoreMsg('');
    try {
      const parsed = JSON.parse(await file.text());
      if (wipe && !window.confirm('Replace everything on this device with this file? This cannot be undone.')) {
        return;
      }
      let report: RestoreReport | null = null;
      update((draft) => {
        const out = restoreDb(draft, parsed, wipe ? 'replace' : 'merge');
        report = out.report;
        draft.workouts = out.db.workouts;
        draft.sessions = out.db.sessions;
        draft.settings = out.db.settings;
      });
      const r = report as RestoreReport | null;
      setRestoreErr(false);
      setRestoreMsg(
        r ? `Restored. ${r.workouts} in the library, ${r.sessions} logged sessions.` : 'Nothing to restore.',
      );
    } catch (err) {
      setRestoreErr(true);
      setRestoreMsg(err instanceof SyntaxError ? "That file isn't valid JSON." : humanizeError(err, 'restore'));
    } finally {
      setBusy(false);
      input.value = '';
    }
  }

  return (
    <>
      <Kicker>Settings</Kicker>
      <ScreenTitle>Your numbers</ScreenTitle>

      {saveFailed ? (
        <Card className="mt-2 border-bad/40 bg-bad/10">
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
      <WhoopCard />
      <RecoveryCard />
      <Concept2Card />

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

        {/* The other end of the safety net. Export has been here since the sync
            work and there was no way to load one back — so the warning above
            ("export a backup before you train again") was advice you could
            follow and never act on. */}
        <label className="mt-1 block">
          <span className="sr-only">Restore from a backup file</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={onRestoreFile}
            disabled={busy}
            className="block w-full rounded-md border border-line bg-panel2 p-1 text-4 text-muted file:mr-1 file:rounded-sm file:border-0 file:bg-gold-wash file:px-1.5 file:py-0.5 file:text-4 file:font-[650] file:text-gold2"
          />
        </label>
        <p className="text-3 text-dim">
          Merges by default — anything logged since the backup is kept, and a session you deleted on
          purpose stays deleted.
        </p>
        <label className="flex items-center gap-1 text-3 text-dim">
          <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
          Replace everything instead (for a corrupted app — this throws away what is here)
        </label>
        {restoreMsg ? (
          <p role="status" className={`text-3 ${restoreErr ? 'text-bad' : 'text-ok'}`}>
            {restoreMsg}
          </p>
        ) : null}
      </Card>
    </>
  );
}

/** Manual whole-athlete context. These observations shape constraints and
 * confidence; they are not diagnoses, and HRV never becomes a pain gate. */
function RecoveryCard() {
  const { db, update } = useDb();
  const today = ymd(new Date());
  const migrated = ensureSharedCore(db);
  const recovery = migrated.core?.recovery.find((x) => x.date === today);
  const life = migrated.core?.lifeLoad.find((x) => x.date === today);
  const [sleep, setSleep] = useState(() => String(recovery?.sleepHours ?? ''));
  const [energy, setEnergy] = useState(() => String(recovery?.energy ?? ''));
  const [soreness, setSoreness] = useState(() => String(recovery?.soreness ?? ''));
  const [stress, setStress] = useState(() => String(life?.stress ?? recovery?.stress ?? ''));
  const [physical, setPhysical] = useState(() => String(life?.physicalLoad ?? ''));
  const [minutes, setMinutes] = useState(() => String(life?.availableMinutes ?? ''));
  const [pain, setPain] = useState(() => migrated.core?.safety.painHold?.areas.join(', ') || '');
  const [illness, setIllness] = useState(() => migrated.core?.safety.illness?.status || 'clear');
  const [saved, setSaved] = useState(false);

  const number = (value: string): number | undefined => {
    const n = Number(value);
    return value.trim() && Number.isFinite(n) ? n : undefined;
  };

  const save = () => {
    update((draft) => {
      const next = ensureSharedCore(draft, Date.now());
      const core = next.core!;
      const at = Date.now();
      core.recovery = [
        ...core.recovery.filter((x) => x.date !== today || x.source !== 'manual'),
        {
          id: `manual-recovery-${today}`,
          date: today,
          sleepHours: number(sleep),
          energy: number(energy),
          soreness: number(soreness),
          stress: number(stress),
          painAreas: pain.split(',').map((x) => x.trim()).filter(Boolean),
          illnessStatus: illness as 'clear' | 'suspected' | 'active' | 'returning',
          source: 'manual',
          recordedAt: at,
        },
      ];
      core.lifeLoad = [
        ...core.lifeLoad.filter((x) => x.date !== today || x.source !== 'manual'),
        {
          id: `manual-life-${today}`,
          date: today,
          stress: number(stress),
          physicalLoad: number(physical),
          availableMinutes: number(minutes),
          source: 'manual',
        },
      ];
      core.safety = {
        ...core.safety,
        painHold: {
          active: !!pain.trim(),
          areas: pain.split(',').map((x) => x.trim()).filter(Boolean),
          updatedAt: at,
        },
        illness: { status: illness as 'clear' | 'suspected' | 'active' | 'returning', updatedAt: at },
      };
      core.updatedAt = at;
      draft.core = core;
      draft.ecosystem = { ...(next.ecosystem || { schemaVersion: 1, partitions: {}, events: [], core }), core };
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <>
      <SectionHead title="Whole-athlete context" />
      <Card className="flex flex-col gap-1.5">
        <p className="text-3 text-muted">A short check-in helps the model account for sleep, soreness, life stress and physical work. It is coaching context, not medical advice.</p>
        <div className="grid grid-cols-2 gap-1">
          <Num label="Sleep hours" hint="Last night" value={sleep} onChange={setSleep} />
          <Num label="Energy 0–10" hint="How you feel" value={energy} onChange={setEnergy} />
          <Num label="Soreness 0–10" hint="Whole-body" value={soreness} onChange={setSoreness} />
          <Num label="Life stress 0–10" hint="Mental load" value={stress} onChange={setStress} />
          <Num label="Physical load 0–10" hint="Work/activity" value={physical} onChange={setPhysical} />
          <Num label="Minutes today" hint="Time available" value={minutes} onChange={setMinutes} />
        </div>
        <label className="block">
          <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Pain areas</span>
          <input value={pain} onChange={(e) => setPain(e.target.value)} placeholder="e.g. lower back (leave blank if clear)" className="mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line" />
          <span className="mt-0.5 block text-3 text-dim">A pain flag stops automatic pushing; it is not a diagnosis.</span>
        </label>
        <label className="block">
          <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Illness status</span>
          <select value={illness} onChange={(e) => setIllness(e.target.value as typeof illness)} className="mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line">
            <option value="clear">Clear</option>
            <option value="suspected">Suspected — reduce intensity</option>
            <option value="active">Active — no hard training</option>
            <option value="returning">Returning to training</option>
          </select>
        </label>
        <Button variant="brass" onClick={save}>{saved ? 'Saved' : 'Save today’s context'}</Button>
        <p className="text-3 text-dim">HRV remains an advisory trend signal only and never decides pain, injury or illness status.</p>
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
            {/* Announced, because this text is the ONLY report a sync gives.
                It changes on its own after a button press, and a change nobody
                is told about is the same as no feedback at all for anyone not
                watching this exact line. `polite` waits for a pause rather
                than interrupting. */}
            <p className="mt-0.5 text-3 text-dim" role="status" aria-live="polite">
              {busy
                ? 'Syncing…'
                : syncedAt
                  ? 'Last synced ' + new Date(syncedAt).toLocaleTimeString()
                  : 'Not synced yet this session.'}
            </p>
            {/* `assertive`: a failed sign-in or a rejected sync is the one thing
                worth interrupting for — carrying on unaware costs you the
                session you thought was saved. */}
            {error ? (
              <p className="mt-1 text-3 text-bad" role="alert" aria-live="assertive">
                {error}
              </p>
            ) : null}
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
            <p className="text-4 text-muted">Sign in to sync across devices.</p>
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

/* Connection only. The readings themselves — sleep, recovery, strain — live on
   Home, where you actually look at them before training. Repeating them here
   was two places to keep honest and one more screen to scroll. */
function WhoopCard() {
  const { connected, sample, busy, error, lastSyncAt, connect, sync, disconnect } = useWhoop();
  const rec = todayRecovery(sample);
  return (
    <>
      <SectionHead title="WHOOP" />
      <Card>
        {connected ? (
          <>
            <p className="num text-4 text-muted">
              Connected{rec != null ? ` · today ${rec}% recovery` : ' · no reading yet today'}
            </p>
            {lastSyncAt ? (
              <p className="mt-1.5 text-3 text-dim">Last pulled {new Date(lastSyncAt).toLocaleString()}</p>
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

/* Same shape as WhoopCard for the connection half; below it, the import step.
   Pulled results stay outside the training database until the athlete says so:
   the plan is computed to show what WOULD land ("N new"), and only the button
   press applies it — matched results onto their session blocks, the rest into
   the standalone history, deduped forever after by externalId. */
function Concept2Card() {
  const { connected, results, busy, error, lastSyncAt, connect, sync, disconnect } = useConcept2();
  const { db, update } = useDb();
  const [importMsg, setImportMsg] = useState('');
  // Recomputed against the live db, so an applied import self-heals to zero
  // pending and the button disappears rather than offering the same work twice.
  const plan = useMemo(() => planConcept2Import(results, db), [results, db]);
  const pending = plan.merges.length + plan.standalone.length;

  function importNow() {
    let counts: Concept2ImportCounts | null = null;
    update((draft) => {
      // Re-plan against the draft: the memoized plan may predate another tab's
      // write, and apply's own re-verification only degrades, never re-matches.
      counts = applyConcept2Import(draft, planConcept2Import(results, draft));
    });
    if (counts) setImportMsg(concept2ImportSummary(counts));
  }

  return (
    <>
      <SectionHead title="Concept2 Logbook" />
      <Card>
        {connected ? (
          <>
            <p className="num text-4 text-muted">
              Connected{results.length ? ` · ${results.length} synced result${results.length === 1 ? '' : 's'}` : ' · no results synced yet'}
            </p>
            {lastSyncAt ? (
              <p className="mt-1.5 text-3 text-dim">Last pulled {new Date(lastSyncAt).toLocaleString()}</p>
            ) : null}
            <div className="mt-1.5 flex gap-1">
              <Button onClick={() => void sync()} disabled={busy}>
                {busy ? 'Pulling…' : 'Pull now'}
              </Button>
              <Button variant="quiet" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
            {pending ? (
              <>
                <Button variant="brass" className="mt-1" onClick={importNow}>
                  Add {pending} new result{pending === 1 ? '' : 's'} to your history
                </Button>
                <p className="mt-0.5 text-3 text-dim">
                  {plan.merges.length
                    ? `${plan.merges.length} line${plan.merges.length === 1 ? 's' : ''} up with a logged session; the rest file on their own. `
                    : ''}
                  Nothing you recorded is overwritten, and each result imports once.
                </p>
              </>
            ) : null}
            {importMsg ? (
              <p role="status" aria-live="polite" className="mt-1 text-3 text-ok">
                {importMsg}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-4 text-muted">
              Connect your Concept2 Logbook and rower, SkiErg and BikeErg sessions pull in with their real splits —
              no re-typing what the erg already measured.
            </p>
            <Button variant="brass" className="mt-1.5" onClick={connect}>
              Connect Concept2
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
