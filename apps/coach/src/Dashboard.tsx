import { useMemo } from 'react';
import {
  agoLabel,
  barScale,
  bestE1rmByLift,
  exBest,
  hasLoggedWork,
  knownMovements,
  sessionVolume,
  todayRecovery,
  ymd,
  type EngineDB,
  type Session,
  type WhoopSample,
} from '@hybrid/engine';
import { useCoachCloud } from './cloud';
import { MICRO } from './ui';

/*
 * What the coach could never see.
 *
 * The builder has only ever pushed work OUT — assign a session, and never learn
 * whether anyone did it. That is why it read as a stock shell: it genuinely had
 * nothing to show. This reads the signed-in user's own training back and puts
 * the answer above the fold.
 *
 * Everything here is derived from the same engine functions the athlete app
 * uses. No second implementation of volume, of an e1RM, or of what counts as
 * trained — a coach screen disagreeing with the phone about a number is worse
 * than a coach screen that does not exist.
 */
export function Dashboard() {
  const { mine, mineLoading, mineError, user } = useCoachCloud();

  if (!user) {
    return (
      <Shell>
        <Empty
          title="Sign in to see your training"
          body="The builder reads your logged sessions from the same account the phone syncs to. Signed out, it has nothing to read."
        />
      </Shell>
    );
  }
  if (mineLoading) {
    return (
      <Shell>
        <Empty title="Reading your training…" />
      </Shell>
    );
  }
  /* Three different reasons for an empty screen, three different answers. A
     single "nothing logged yet" for all of them is unactionable — it reads as
     "you have not trained" when the real cause is usually "this account has
     never pushed". */
  if (mineError && mineError !== 'none' && mineError !== 'shape') {
    return (
      <Shell>
        <Empty title="Could not read your training" body={mineError} />
      </Shell>
    );
  }
  if (mineError === 'none') {
    return (
      <Shell>
        <Empty
          title="This account has no training in the cloud yet"
          body={`Signed in as ${user.email}. Your sessions are still only on the device that logged them — open the athlete app, sign in with THIS email, and let it sync. If you signed into the athlete app with a different address, that is the one holding your data.`}
        />
      </Shell>
    );
  }
  if (mineError === 'shape') {
    return (
      <Shell>
        <Empty
          title="Found the account, but no training in it"
          body="There is a record for this user with nothing under it. That happens when the athlete app has signed in but not finished a sync — open it and press Sync now."
        />
      </Shell>
    );
  }
  if (!mine || !mine.sessions.length) {
    return (
      <Shell>
        <Empty
          title="Nothing logged yet"
          body="The account synced, and it holds no sessions. Finish one on the phone and this fills in."
        />
      </Shell>
    );
  }

  return <Loaded db={mine} />;
}

function Loaded({ db }: { db: EngineDB }) {
  const stats = useMemo(() => derive(db), [db]);

  return (
    <Shell>
      <header>
        <div className="text-2 font-[800] tracking-[.18em] uppercase text-gold">Coach</div>
        <h1 className="mt-0.5 text-8 leading-tight font-[800]">Your training, and what comes next</h1>
        <p className="mt-0.5 text-3 text-dim num">
          {stats.total} sessions · {stats.first} to {stats.last} · {stats.tonnage.toLocaleString()} kg moved
        </p>
      </header>

      {/* Summary before detail. */}
      <section className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-1">
        <Tile lab="Last trained" big={stats.sinceLast} foot={stats.lastName} accent />
        <Tile lab="This week" big={`${stats.thisWeek.toLocaleString()}`} unit="kg" foot={stats.weekDelta} />
        <Tile lab="Sessions · 12wk" big={String(stats.last12)} foot={`${stats.perWeek} a week`} />
        <Tile
          lab="Readiness"
          big={stats.recovery == null ? '—' : String(stats.recovery)}
          unit={stats.recovery == null ? '' : '%'}
          foot={stats.recovery == null ? 'No WHOOP data' : 'WHOOP'}
        />
        <Tile lab="Movements" big={String(stats.movements)} foot={`${stats.mobility} mobility`} />
      </section>

      <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-line bg-panel p-2">
          <H2>Weekly volume · 12 weeks</H2>
          <Bars weeks={stats.weeks} />
        </section>

        <section className="rounded-lg border border-line bg-panel p-2">
          <H2>Top lifts · best in 6 months</H2>
          {stats.lifts.length ? (
            stats.lifts.map((l) => (
              <div key={l.name} className="flex items-baseline gap-1 border-b border-line py-1 last:border-0">
                <span className="min-w-0 flex-1 truncate text-4 font-[650]">{l.name}</span>
                <span className="num text-4 text-muted">{Math.round(l.e1)}kg</span>
                <span className="num w-16 text-right text-2 text-dim">{agoLabel(l.date)}</span>
              </div>
            ))
          ) : (
            <p className="text-3 text-dim">No loaded sets in the last six months.</p>
          )}
        </section>
      </div>

      <section className="mt-2 rounded-lg border border-line bg-panel3 p-2">
        <H2>Worth a decision</H2>
        {stats.notes.length ? (
          <ul className="flex flex-col gap-1">
            {stats.notes.map((n) => (
              <li key={n} className="text-4 text-muted">
                {n}
              </li>
            ))}
          </ul>
        ) : (
          /* Silence beats a shrug — the same rule the balance readout follows. */
          <p className="text-3 text-dim">Nothing stands out in the data right now.</p>
        )}
      </section>
    </Shell>
  );
}

/* ---- derivations. All of them from the engine, none reimplemented here. ---- */

function derive(db: EngineDB) {
  const done = db.sessions.filter((s) => hasLoggedWork(s)).sort((a, b) => a.date.localeCompare(b.date));
  const tonnage = done.reduce((n, s) => n + sessionVolume(s), 0);

  const today = new Date();
  const weeks: { label: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const end = new Date(today);
    end.setDate(end.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const a = ymd(start);
    const b = ymd(end);
    weeks.push({
      label: b.slice(5),
      value: done.filter((s) => s.date >= a && s.date <= b).reduce((n, s) => n + sessionVolume(s), 0),
    });
  }

  const cut = new Date(today);
  cut.setDate(cut.getDate() - 84);
  const last12 = done.filter((s) => s.date >= ymd(cut)).length;

  const thisWeek = weeks[weeks.length - 1]?.value ?? 0;
  const prevWeek = weeks[weeks.length - 2]?.value ?? 0;
  const weekDelta =
    !prevWeek && !thisWeek
      ? 'nothing yet'
      : !prevWeek
        ? 'first week back'
        : `${thisWeek >= prevWeek ? '+' : ''}${Math.round(((thisWeek - prevWeek) / prevWeek) * 100)}% on last week`;

  const last = done[done.length - 1];
  /* Returns a Map keyed by lowercase name, and carries no date — so the date
     each best came from is fetched per lift from exBest, which does. */
  const now = Date.now();
  const lifts = [...bestE1rmByLift(done, now - 182 * 864e5, now).values()]
    .sort((a, b) => b.e1 - a.e1)
    .slice(0, 6)
    .map((l) => ({ ...l, date: exBest(l.name, done)?.date ?? '' }));
  const movements = knownMovements(db.workouts, done).length;
  const mobility = Array.isArray(db.settings.mobility) ? db.settings.mobility.length : 0;

  /* Only things the data actually says. An observation nobody can act on is
     noise, and a dashboard full of noise stops being read. */
  const notes: string[] = [];
  const stale = lifts.find((l: { date: string }) => {
    if (!l.date) return false;
    return (Date.now() - Date.parse(l.date + 'T12:00:00')) / 86400000 > 90;
  });
  if (stale) notes.push(`${stale.name} has not been trained in ${agoLabel(stale.date)} — its number is going stale.`);
  const zeroWeeks = weeks.filter((w) => !w.value).length;
  if (zeroWeeks >= 2) notes.push(`${zeroWeeks} of the last 12 weeks have no logged tonnage.`);
  const noRpe = done.slice(-20).every((s) => !anyFelt(s));
  if (noRpe) notes.push('No felt RPE in your recent sessions, so autoregulation has nothing to learn from yet.');

  return {
    total: done.length,
    first: done[0]?.date ?? '—',
    last: last?.date ?? '—',
    lastName: last ? `${last.date} · ${last.name || 'Session'}` : '',
    sinceLast: last ? agoLabel(last.date) : '—',
    tonnage: Math.round(tonnage),
    weeks,
    last12,
    perWeek: (last12 / 12).toFixed(1),
    thisWeek,
    weekDelta,
    /* whoopDaily rides along in settings, so the newest entry is the sample.
       Null when there is none — an invented readiness number is worse than a
       dash. */
    recovery: todayRecovery(latestWhoop(db)),
    lifts,
    movements,
    mobility,
    notes,
  };
}

function latestWhoop(db: EngineDB): WhoopSample | null {
  const rows = Array.isArray(db.settings.whoopDaily) ? (db.settings.whoopDaily as WhoopSample[]) : [];
  return rows.length ? rows[rows.length - 1] : null;
}

function anyFelt(s: Session): boolean {
  return s.blocks.some((b) =>
    ((b as { exercises?: { sets: { felt?: string }[] }[] }).exercises || []).some((e) =>
      e.sets.some((st) => !!st.felt),
    ),
  );
}

/* ---- pieces ---- */

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1440px] p-3">{children}</div>;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 text-2 font-[750] tracking-[.16em] uppercase text-gold2/80">{children}</h2>;
}

function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mt-6 rounded-lg border border-line bg-panel p-4 text-center">
      <p className="text-6 font-[750]">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-[46ch] text-4 text-muted">{body}</p> : null}
    </div>
  );
}

function Tile({
  lab,
  big,
  unit,
  foot,
  accent,
}: {
  lab: string;
  big: string;
  unit?: string;
  foot?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        'rounded-lg border p-2 ' + (accent ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel')
      }
    >
      <div className={MICRO}>{lab}</div>
      <b className={'num mt-0.5 block text-8 font-[900] ' + (accent ? 'text-gold2' : '')}>
        {big}
        {unit ? <span className="text-4 text-dim">{unit}</span> : null}
      </b>
      {foot ? <p className="num mt-0.5 text-2 text-dim">{foot}</p> : null}
    </div>
  );
}

/**
 * The same floating baseline the athlete's charts use, and the same honesty
 * about it: when a week is genuinely zero the axis stays at zero, because
 * zooming past a rest week would flatter the weeks around it.
 */
function Bars({ weeks }: { weeks: { label: string; value: number }[] }) {
  const scale = barScale(weeks.map((w) => w.value));
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {weeks.map((w, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end gap-0.5">
            <div
              className={w.value ? 'rounded-sm bg-gold' : 'rounded-sm border border-dashed border-line2'}
              style={{ height: `${Math.max(2, scale.pct(w.value))}%` }}
            />
            <span className="num text-center text-1 text-dim">{w.label}</span>
          </div>
        ))}
      </div>
      <p className="num mt-1 text-3 text-muted">
        {scale.floating
          ? `${Math.round(scale.floor).toLocaleString()}–${Math.round(scale.top).toLocaleString()}kg · axis starts at ${Math.round(scale.floor).toLocaleString()}`
          : `peak ${Math.round(scale.top).toLocaleString()}kg`}
      </p>
    </div>
  );
}
