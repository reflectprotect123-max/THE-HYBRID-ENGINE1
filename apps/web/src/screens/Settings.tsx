import { useMemo, useState } from 'react';
import { conMaxHr, conZones, restingHr, type Profile } from '@hybrid/engine';
import { useDb } from '../store/db';
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
