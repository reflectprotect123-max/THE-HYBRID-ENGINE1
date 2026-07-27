import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  barScale,
  bestE1rmByLift,
  conZones,
  fmtClock,
  isCond,
  condEfforts,
  loadBalance,
  sessionVolume,
  ymd,
  type CondResult,
  type Session,
  type ZoneKey,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Empty, Kicker, ScreenTitle, SectionHead } from '../ui';

/*
 * Progress: is any of this going anywhere?
 *
 * Charts are inline SVG with no library — partly because the CSP forbids
 * anything else, and partly because a trend line of eight points does not need
 * 90KB of JavaScript.
 *
 * Every series shows its own axis and refuses to render a trend from a single
 * point. A chart drawn from one data point implies a direction it cannot know,
 * which is worse than an empty state.
 */
export function Progress() {
  const { sessions, settings, hr } = useDb();
  const zones = useMemo(() => conZones(hr), [hr]);

  const weeks = useMemo(() => weeklyVolume(sessions, 8), [sessions]);
  const whoopHist = useMemo(
    () =>
      Array.isArray(settings.whoopDaily)
        ? (settings.whoopDaily as { date: string; recovery: number | null; strain: number | null }[])
        : [],
    [settings.whoopDaily],
  );
  const recovery = useMemo(
    () => whoopHist.filter((h) => h.recovery != null).slice(-30).map((h) => ({ label: h.date.slice(5), value: h.recovery as number })),
    [whoopHist],
  );
  const strain = useMemo(
    () => whoopHist.filter((h) => h.strain != null).slice(-30).map((h) => ({ label: h.date.slice(5), value: h.strain as number })),
    [whoopHist],
  );

  const zoneWeek = useMemo(() => zoneSecondsThisWeek(sessions, settings), [sessions, settings]);
  const hrrTrend = useMemo(() => {
    const recs = condEfforts(sessions, settings);
    return recs.filter((r) => r.hrr != null).slice(-12).map((r, i) => ({ label: String(i + 1), value: r.hrr as number }));
  }, [sessions, settings]);

  const lifts = useMemo(() => {
    const now = Date.now();
    const recent = bestE1rmByLift(sessions, now - 8 * 7 * 864e5, now);
    const prior = bestE1rmByLift(sessions, now - 16 * 7 * 864e5, now - 8 * 7 * 864e5);
    return Array.from(recent.values())
      .map((r) => ({ name: r.name, e1: r.e1, delta: prior.has(r.name.toLowerCase()) ? r.e1 - (prior.get(r.name.toLowerCase()) as { e1: number }).e1 : null }))
      .sort((a, b) => b.e1 - a.e1)
      .slice(0, 5);
  }, [sessions]);

  const balance = useMemo(() => loadBalance(sessions, settings), [sessions, settings]);

  /* Thresholds must match the ones each card renders at — counting a single
     recovery reading as content while every trend needs two left the screen
     blank apart from its title after one WHOOP sync. */
  const anything =
    weeks.some((w) => w.value > 0) ||
    recovery.length > 1 ||
    strain.length > 1 ||
    hrrTrend.length > 1 ||
    lifts.length > 0 ||
    !!balance;

  return (
    <>
      <Kicker>Progress</Kicker>
      {/* Not "Is it working?" — on a screen that can legitimately be empty,
          that reads as the APP asking whether IT is broken. It is a question
          about the training. */}
      <ScreenTitle>Is the training working?</ScreenTitle>

      {!anything ? (
        <Empty
          title="Not enough logged yet"
          body="Trends need a few sessions before they mean anything. Train, and this fills in on its own."
        />
      ) : null}

      {/* First, because it is the answer and everything below is the working.
          It is also the only thing on this screen that reads the two halves of
          the app together — strength progression and conditioning progression
          have always adapted correctly in isolation and never once been
          compared. `loadBalance` returns null unless both sides have enough
          data, so this card simply is not here rather than guessing. */}
      {balance ? (
        <Card tone="raised" className="mt-2">
          <Kicker className="text-1">Strength vs conditioning</Kicker>
          <h3 className="mt-0.5 text-6 font-[750]">{balance.title}</h3>
          <p className="mt-0.5 text-4 text-muted">{balance.body}</p>
          <p className="mt-1 border-t border-line pt-1 text-2 text-dim">
            Two things moving together is not one causing the other — a hard month at work moves both.
          </p>
        </Card>
      ) : null}

      {weeks.some((w) => w.value > 0) ? (
        <>
          <SectionHead title="Weekly volume · 8 weeks" />
          <Card>
            <Bars data={weeks} unit="kg" color="var(--color-gold2)" />
          </Card>
        </>
      ) : null}

      {lifts.length ? (
        <>
          <SectionHead
            title="Top lifts · 8-week change"
            right={
              <Link to="/history" className="rounded-sm text-3 font-[650] text-gold2">
                Full history ›
              </Link>
            }
          />
          <Card>
            <ul className="flex flex-col gap-1">
              {lifts.map((d) => (
                <li key={d.name} className="flex items-baseline gap-1">
                  <span className="min-w-0 flex-1 truncate text-4 font-[650]">{d.name}</span>
                  <span className="num text-4 text-muted">{Math.round(d.e1)}kg</span>
                  <span
                    className="num w-8 text-right text-4 font-[750]"
                    style={{
                      color:
                        d.delta == null
                          ? 'var(--color-dim)'
                          : d.delta > 0
                            ? 'var(--color-ok)'
                            : d.delta < 0
                              ? 'var(--color-bad)'
                              : 'var(--color-muted)',
                    }}
                  >
                    {d.delta == null ? '—' : (d.delta > 0 ? '+' : '') + Math.round(d.delta)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 border-t border-line pt-1 text-2 text-dim">
              Against the same lift&apos;s best 8–16 weeks ago. A dash means it wasn&apos;t trained in that window —
              not that it went nowhere.
            </p>
          </Card>
        </>
      ) : null}

      {zoneWeek.total > 0 ? (
        <>
          <SectionHead title="Zone time · this week" />
          <Card>
            <div className="flex h-2 overflow-hidden rounded-pill">
              {(['low', 'mod', 'high'] as ZoneKey[]).map((k) =>
                zoneWeek[k] > 0 ? (
                  <span key={k} style={{ width: (100 * zoneWeek[k]) / zoneWeek.total + '%', background: ink(k) }} />
                ) : null,
              )}
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {(['low', 'mod', 'high'] as ZoneKey[]).map((k) => (
                <li key={k} className="flex items-center gap-1">
                  <span className="h-1 w-1 shrink-0 rounded-pill" style={{ background: ink(k) }} />
                  <span className="flex-1 text-4">{zones.list.find((b) => b.key === k)?.name}</span>
                  <span className="num text-4 text-muted">{fmtClock(zoneWeek[k])}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      {recovery.length > 1 ? (
        <>
          <SectionHead title="Recovery · 30 days" />
          <Card>
            <Line data={recovery} min={0} max={100} color="var(--color-neon-ok)" unit="%" />
          </Card>
        </>
      ) : null}

      {strain.length > 1 ? (
        <>
          <SectionHead title="Strain · 30 days" />
          <Card>
            <Line data={strain} min={0} max={21} color="var(--color-neon-strain)" unit="" />
          </Card>
        </>
      ) : null}

      {hrrTrend.length > 1 ? (
        <>
          <SectionHead title="Heart-rate recovery" />
          <Card>
            <Line data={hrrTrend} color="var(--color-neon-strain)" unit="bpm" />
            <p className="mt-1 text-2 text-dim">
              Drop in the minute after your session peak. Recorded and shown — it does not gate progression, because
              its day-to-day noise is larger than the effect.
            </p>
          </Card>
        </>
      ) : null}
    </>
  );
}

// Band inks, not neon: banked zone seconds are data read against text
// (01-foundations-colour-05 — these carry meaning; the emissive set is for
// lit dots and strips only).
const ink = (k: ZoneKey) =>
  k === 'low' ? 'var(--color-zone-blue)' : k === 'mod' ? 'var(--color-zone-green)' : 'var(--color-zone-red)';

interface Point {
  label: string;
  value: number;
  /** the current week, still being trained */
  partial?: boolean;
}

function Bars({ data, unit, color }: { data: Point[]; unit: string; color: string }) {
  /* Zero-baselined, this was seven bars spanning 92–100% of the card: the
     largest element on the screen, distinguishing nothing. See `barScale`. */
  /* Scaled from COMPLETE weeks only. The last bucket ends today, so on a
     Monday it holds two days against seven full weeks — which made the spread
     98% and correctly told barScale there was nothing to zoom into. The
     in-progress week is drawn against that scale, not allowed to set it. */
  const done = data.filter((d) => !d.partial);
  const scale = barScale((done.length ? done : data).map((d) => d.value));
  return (
    <div>
      {/* Columns stretch to the full 128px so the percentage heights of the
          bars have something definite to resolve against — with `items-end`
          they resolved to auto and the chart drew nothing. */}
      <div className="flex h-16 gap-0.5">
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col justify-end">
            <span
              className="w-full rounded-t-[4px] transition-[height] duration-200 ease-standard"
              style={{
                // A trained week never renders as literally nothing — 2% is a
                // sliver that reads as "small", where 0 reads as "missing".
                height: d.value > 0 ? Math.max(2, scale.pct(d.value)) + '%' : '2%',
                // The current week is short because it is UNFINISHED, not
                // because it went badly. Outlined rather than filled says
                // "still going" without inventing a number it does not have.
                ...(d.partial
                  ? { background: 'transparent', border: `1px solid ${color}`, opacity: 0.55 }
                  : { background: color, opacity: d.value ? 1 : 0.25 }),
              }}
              title={`${d.label}: ${Math.round(d.value).toLocaleString()}${unit}${d.partial ? ' (this week, so far)' : ''}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-0.5 flex gap-0.5">
        {data.map((d, i) => (
          <span key={i} className="num flex-1 text-center text-1 text-dim">
            {d.label}
          </span>
        ))}
      </div>
      {/* The axis is truncated to make variation visible, so it says so. A
          zoomed chart that implies the shortest bar is nothing is the same
          dishonesty as the flat one, pointing the other way. */}
      <p className="num mt-1 text-3 text-muted">
        {scale.floating
          ? `${Math.round(scale.floor).toLocaleString()}–${Math.round(scale.top).toLocaleString()}${unit} · axis starts at ${Math.round(scale.floor).toLocaleString()}`
          : `peak ${Math.round(scale.top).toLocaleString()}${unit}`}
        {data.some((d) => d.partial) ? ' · outlined bar is this week so far' : ''}
      </p>
    </div>
  );
}

function Line({ data, color, unit, min, max }: { data: Point[]; color: string; unit: string; min?: number; max?: number }) {
  const W = 280;
  const H = 64;
  const lo = min ?? Math.min(...data.map((d) => d.value));
  const hi = max ?? Math.max(...data.map((d) => d.value));
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, data.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * H;
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = data[data.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full overflow-visible" role="img" aria-label={`trend, latest ${last.value}${unit}`}>
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--color-track)" strokeWidth="1" />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(data.length - 1)} cy={y(last.value)} r="3.5" fill={color} stroke="var(--color-chart-dot-ring)" strokeWidth="2" />
      </svg>
      <div className="num mt-0.5 flex justify-between text-2 text-dim">
        <span>{data[0].label}</span>
        <span style={{ color }}>
          {Math.round(last.value)}
          {unit}
        </span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}

/* ---- derivations ---- */

function weeklyVolume(sessions: Session[], n: number): Point[] {
  const out: Point[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const end = new Date(now);
    end.setDate(end.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const a = ymd(start);
    const b = ymd(end);
    const vol = sessions
      .filter((s) => s.status !== 'active' && s.date >= a && s.date <= b)
      .reduce((sum, s) => sum + sessionVolume(s), 0);
    // The last bucket ends today, so it is ALWAYS a partial week. Marked
    // rather than dropped: this week's progress is worth seeing — it just must
    // not be compared against, or allowed to scale against, seven full ones.
    out.push({ label: b.slice(5), value: vol, partial: i === 0 });
  }
  return out;
}

function zoneSecondsThisWeek(sessions: Session[], settings: { conditioning?: CondResult[] }) {
  const since = Date.now() - 7 * 864e5;
  const acc = { low: 0, mod: 0, high: 0, total: 0 };
  condEfforts(sessions, settings)
    .filter((r) => (r.startedAt || 0) >= since)
    .forEach((r) => {
      (['low', 'mod', 'high'] as ZoneKey[]).forEach((k) => {
        const v = r.zsec?.[k] || 0;
        acc[k] += v;
        acc.total += v;
      });
    });
  return acc;
}
