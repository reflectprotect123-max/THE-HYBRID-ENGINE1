import { useMemo, useState } from 'react';
import {
  conMaxHr,
  hrMaxBandSeconds,
  isCond,
  type CondResult,
  type Concept2Result,
  type Downsampled,
  type HrMaxBand,
  type ProgressState,
} from '@hybrid/engine';
import { mondayOf } from '@hybrid/coordinator-adapter';
import { useDb } from '../../store/db';
import { useConcept2 } from '../../cloud/concept2';
import { PillarBack } from './PillarBack';
import { useProgressionLedger } from '../progression-store';
import type { ConditioningProgressionProposal, ProgressionDirection } from '../progression';
import { ergTrend, type TrendSeries } from '../trends';
import { weekDates } from '../ops';
import '../coach-redesign.css';

/*
 * The mockup's `<section id="view-conditioning">`, ported to JSX.
 *
 * The left half of the hero is the app's real three-band model (`zsec`,
 * computed at logging time by `zoneSeconds`); the right half is a SEPARATE
 * five-zone %HRmax breakdown built here from `hrMaxBandSeconds`, purely for
 * coach-facing context — neither model may be read as an instruction, and
 * neither feeds the other. `hrMaxBandSeconds` already refuses to fabricate:
 * an absent trace returns zeroes rather than throwing, so THIS file is the
 * one place responsible for not silently charting an absent trace as a zero
 * — it tracks which sessions had no trace at all and says so.
 */

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/* Same three-state mapping Strength.tsx uses, for the same reason: a
 * `decrease` still needs the coach's Approve click and shares the
 * `approval` badge rather than inventing a fourth CSS class. */
function badgeClass(direction: ProgressionDirection): 'approval' | 'hold' | 'review' {
  if (direction === 'hold') return 'hold';
  if (direction === 'review') return 'review';
  return 'approval';
}

function badgeLabel(direction: ProgressionDirection): string {
  if (direction === 'hold') return 'hold';
  if (direction === 'review') return 'review';
  return 'approval required';
}

function condPrescription(value: ProgressState): string {
  return `Level ${value.level} · ${value.miss} miss`;
}

/** A trace only counts as "recorded" if it actually banked at least one
 *  real beat — an all-null trace (no strap connected during the run) is
 *  the same absence as no trace object at all. */
function hasUsableTrace(ds: Downsampled | null | undefined): boolean {
  return !!ds && Array.isArray(ds.pts) && ds.pts.some((v) => v != null);
}

/* `useConcept2` throws outside its provider (see AthleteStatus.test.tsx's
 * note on the same hook) — this screen renders through `DbProvider` alone
 * in its own test, exactly like Strength.tsx and Readiness.tsx do, so it
 * must tolerate the provider being absent rather than crash the page. The
 * hook itself is still called unconditionally, every render, in the same
 * position — only the thrown error is handled, which does not touch hook
 * order. */
function useConcept2Safe(): { results: Concept2Result[] } {
  try {
    return useConcept2();
  } catch {
    return { results: [] };
  }
}

const HR_BANDS: { key: HrMaxBand; name: string; range: string; color: string }[] = [
  { key: 'z1', name: 'Z1 · Recovery', range: '50–60%', color: 'var(--color-neon-strain)' },
  { key: 'z2', name: 'Z2 · Endurance', range: '60–70%', color: 'var(--color-neon-ok)' },
  { key: 'z3', name: 'Z3 · Tempo', range: '70–80%', color: 'var(--color-neon-warn)' },
  // The mockup's legend wants `--neon-orange` for Z4; that token (and
  // `--zone-orange`) do not exist in packages/design/src/tokens.css — task 2
  // correctly left them out rather than invent them. `--color-gold`, the
  // system's brass accent, is the closest existing token to "orange" and is
  // not already claimed by Z1/Z2/Z3 (cyan/green/amber) or Z5 (red), so it
  // is reused here rather than adding a new token for one arc.
  { key: 'z4', name: 'Z4 · Threshold', range: '80–90%', color: 'var(--color-gold)' },
  { key: 'z5', name: 'Z5 · VO2max', range: '90–100%', color: 'var(--color-neon-bad)' },
];

function ErgIcon() {
  return (
    <span className="c-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 18c2-1 4-4 4-7a4 4 0 0 1 8 0c0 3 2 6 4 7" />
        <circle cx="12" cy="6" r="2" />
      </svg>
    </span>
  );
}

/** Same construction as `LiftCard`'s `liftSparkPath` in Strength.tsx, minus
 *  the sparse-week null handling — `ergTrend`'s points are always real,
 *  logged tests, never a placeholder week, so every index is known. */
function ergSparkPath(points: number[], w: number, h: number, pad: number) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - 2 * pad)) / span;
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const first = 0;
  const last = points.length - 1;
  const area = `${x(first).toFixed(1)},${(h - pad).toFixed(1)} ${line} ${x(last).toFixed(1)},${(h - pad).toFixed(1)}`;
  return { line, area, lastX: x(last), lastY: y(points[last]!) };
}

/** Pace/500m is "lower is faster" — the opposite good-direction of a lift's
 *  e1RM — so the delta's good/bad coloring is inverted from `LiftCard`'s. */
function ErgCard({ series }: { series: TrendSeries }) {
  const [open, setOpen] = useState(false);
  const cls = series.delta == null ? 'neutral' : series.delta <= 0 ? 'good' : 'bad';
  const color = cls === 'good' ? 'var(--color-ok)' : cls === 'bad' ? 'var(--color-bad)' : 'var(--color-muted)';
  const points = series.points.filter((p): p is number => p != null);
  const spark = ergSparkPath(points, 180, 38, 3);
  const big = ergSparkPath(points, 500, 60, 4);

  return (
    <div className={`rd-card${open ? ' open' : ''}`}>
      <button
        type="button"
        className="rd-card-top"
        aria-expanded={open}
        aria-label={`Expand ${series.label} chart`}
        onClick={() => setOpen((v) => !v)}
      >
        <ErgIcon />
        <span className="c-label">{series.label}</span>
        <span className="c-chev">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </button>
      <div className="rd-card-value">
        <span className="c-num num">{series.latest}</span>
        <span className="c-unit">s</span>
      </div>
      <div className={`rd-card-delta ${cls}`}>
        {series.delta == null ? '—' : `${series.delta > 0 ? '+' : ''}${series.delta} s`} · {series.sub}
      </div>
      {spark && (
        <svg className="rd-spark" width="180" height="38" viewBox="0 0 180 38">
          <polygon points={spark.area} fill={color} opacity={0.18} />
          <polyline points={spark.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={spark.lastX} cy={spark.lastY} r={3} fill={color} />
        </svg>
      )}
      {open && big && (
        <div className="rd-card-expand">
          <div className="rd-card-expand-inner">
            <svg className="rd-big-chart" viewBox="0 0 500 60">
              <polygon points={big.area} fill={color} opacity={0.14} />
              <polyline points={big.line} fill="none" stroke={color} strokeWidth={2} />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

export function Conditioning() {
  const { db, sessions } = useDb();
  const ledger = useProgressionLedger();
  const c2 = useConcept2Safe();
  const today = new Date().toISOString().slice(0, 10);

  const decided = useMemo(() => new Set(ledger.decisions.map((event) => event.proposalId)), [ledger.decisions]);
  const pending = useMemo(
    () =>
      ledger.proposals.filter(
        (proposal): proposal is ConditioningProgressionProposal =>
          proposal.domain === 'conditioning' && !decided.has(proposal.id),
      ),
    [ledger.proposals, decided],
  );

  const thisWeek = useMemo(() => weekDates(mondayOf(today)), [today]);

  // Every conditioning block's result from this week's own sessions — never
  // `settings.conditioning`'s standalone history, which the brief's data
  // source is explicitly this screen's `session.condResult`.
  const weekEntries = useMemo(
    () =>
      sessions
        .filter((s) => s.kind === 'conditioning' && s.status !== 'active' && thisWeek.includes(s.date))
        .map((s) => ({
          sessionId: s.id,
          results: s.blocks.filter(isCond).map((b) => b.condResult).filter((r): r is CondResult => !!r),
        }))
        .filter((entry) => entry.results.length > 0),
    [sessions, thisWeek],
  );

  const totalDurSec = useMemo(
    () => weekEntries.reduce((sum, e) => sum + e.results.reduce((s, r) => s + (r.dur ?? 0), 0), 0),
    [weekEntries],
  );
  const totalMinutes = Math.round(totalDurSec / 60);

  const zoneSec = useMemo(
    () =>
      weekEntries.reduce(
        (acc, e) => {
          e.results.forEach((r) => {
            acc.low += r.zsec?.low ?? 0;
            acc.mod += r.zsec?.mod ?? 0;
            acc.high += r.zsec?.high ?? 0;
          });
          return acc;
        },
        { low: 0, mod: 0, high: 0 },
      ),
    [weekEntries],
  );
  const zoneTotalSec = zoneSec.low + zoneSec.mod + zoneSec.high;

  const maxHr = conMaxHr(db.settings.profile);
  const { bandSec, sessionsWithResults, sessionsWithTrace } = useMemo(() => {
    const bands: Record<HrMaxBand, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    let withResults = 0;
    let withTrace = 0;
    weekEntries.forEach((e) => {
      withResults += 1;
      const traced = e.results.some((r) => hasUsableTrace(r.trace));
      if (traced) withTrace += 1;
      e.results.forEach((r) => {
        if (!hasUsableTrace(r.trace)) return;
        const b = hrMaxBandSeconds(r.trace, maxHr);
        (Object.keys(b) as HrMaxBand[]).forEach((k) => {
          bands[k] += b[k];
        });
      });
    });
    return { bandSec: bands, sessionsWithResults: withResults, sessionsWithTrace: withTrace };
  }, [weekEntries, maxHr]);
  const bandTotalSec = HR_BANDS.reduce((sum, b) => sum + bandSec[b.key], 0);
  const excludedCount = sessionsWithResults - sessionsWithTrace;

  const donutCircumference = 2 * Math.PI * 51.5;
  const donutArcs = useMemo(() => {
    let offset = 0;
    return HR_BANDS.map((band) => {
      const sec = bandSec[band.key];
      const frac = bandTotalSec > 0 ? sec / bandTotalSec : 0;
      const len = frac * donutCircumference;
      const arc = { ...band, sec, frac, len, offset };
      offset += len;
      return arc;
    });
  }, [bandSec, bandTotalSec, donutCircumference]);

  const erg = useMemo(() => ergTrend(c2.results), [c2.results]);

  return (
    <div className="rd-content">
      <PillarBack />

      <section className="rd-queue" aria-labelledby="cond-queue-title">
        <div className="rd-queue-head">
          <p>Now</p>
          <h2 id="cond-queue-title">Progression queue</h2>
          <span className="count">{pending.length} open</span>
        </div>
        <div className="rd-queue-list">
          {pending.length === 0 && (
            <div className="rd-queue-item">
              <p className="qi-detail">No pending conditioning proposals right now. Complete a session to create one.</p>
            </div>
          )}
          {pending.map((proposal) => (
            <div className="rd-queue-item" key={proposal.id}>
              <div className="qi-top">
                <span className="qi-lift">{proposal.subject}</span>
                <span className={`qi-badge ${badgeClass(proposal.direction)}`}>{badgeLabel(proposal.direction)}</span>
              </div>
              <p className="qi-change">
                {condPrescription(proposal.before)} <span className="arrow">→</span>{' '}
                <strong>{condPrescription(proposal.after)}</strong>
              </p>
              <p className="qi-detail">
                {capitalize(proposal.confidence)} confidence · {proposal.reason}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rd-hero rd-hero-cond">
        <div className="rd-cond-split">
          <div className="rd-cond-total-col">
            <div className="rd-cond-total">
              <span className="rv num">
                {totalMinutes}
                <span className="unit">min</span>
              </span>
              <span className="rl">Logged this week</span>
            </div>
            {zoneTotalSec > 0 ? (
              <>
                <div
                  className="rd-zone-bar"
                  role="img"
                  aria-label={`${Math.round(zoneSec.low / 60)} minutes easy, ${Math.round(zoneSec.mod / 60)} minutes moderate, ${Math.round(zoneSec.high / 60)} minutes hard`}
                >
                  <div className="zone-seg" style={{ width: `${(zoneSec.low / totalDurSec) * 100}%`, background: 'var(--color-z-low)' }} />
                  <div className="zone-seg" style={{ width: `${(zoneSec.mod / totalDurSec) * 100}%`, background: 'var(--color-z-mod)' }} />
                  <div className="zone-seg" style={{ width: `${(zoneSec.high / totalDurSec) * 100}%`, background: 'var(--color-z-high)' }} />
                </div>
                <div className="rd-zone-legend">
                  <div className="zl-item">
                    <span className="zl-dot" style={{ background: 'var(--color-z-low)' }} />
                    Easy <strong className="num">{Math.round(zoneSec.low / 60)}m</strong>
                  </div>
                  <div className="zl-item">
                    <span className="zl-dot" style={{ background: 'var(--color-z-mod)' }} />
                    Moderate <strong className="num">{Math.round(zoneSec.mod / 60)}m</strong>
                  </div>
                  <div className="zl-item">
                    <span className="zl-dot" style={{ background: 'var(--color-z-high)' }} />
                    Hard <strong className="num">{Math.round(zoneSec.high / 60)}m</strong>
                  </div>
                </div>
              </>
            ) : totalDurSec > 0 ? (
              <p className="rd-panel-note" style={{ textAlign: 'center' }}>
                {totalMinutes} min logged this week, but none of it classified into a zone — no heart-rate data was
                captured.
              </p>
            ) : (
              <p className="rd-panel-note" style={{ textAlign: 'center' }}>
                No conditioning logged this week.
              </p>
            )}
          </div>

          <div className="rd-cond-divider" aria-hidden="true" />

          <div className="rd-cond-donut-col">
            <p className="rd-donut-title">
              Time in HR zone <span className="rd-donut-sub">· % of max HR</span>
            </p>
            <div className="rd-donut-row">
              <svg className="rd-donut" width="132" height="132" viewBox="0 0 132 132">
                <g>
                  {donutArcs
                    .filter((arc) => arc.len > 0)
                    .map((arc) => (
                      <circle
                        key={arc.key}
                        className="dseg"
                        cx={66}
                        cy={66}
                        r={51.5}
                        stroke={arc.color}
                        style={{ color: arc.color }}
                        strokeDasharray={`${arc.len.toFixed(2)} ${(donutCircumference - arc.len).toFixed(2)}`}
                        strokeDashoffset={(-arc.offset).toFixed(2)}
                        transform="rotate(-90 66 66)"
                      />
                    ))}
                </g>
                <text x="66" y="62" textAnchor="middle" className="rd-donut-num num">
                  {bandTotalSec > 0 ? Math.round(bandTotalSec / 60) : '—'}
                </text>
                <text x="66" y="78" textAnchor="middle" className="rd-donut-unit">
                  min total
                </text>
              </svg>
              <ul className="rd-donut-legend">
                {donutArcs.map((arc) => (
                  <li key={arc.key}>
                    <span className="dl-dot" style={{ background: arc.color }} />
                    <span className="dl-name">{arc.name}</span>
                    <span className="dl-range">{arc.range}</span>
                    <span className="dl-min num">
                      {Math.round(arc.sec / 60)}m · {Math.round(arc.frac * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <p className="rd-panel-note" style={{ position: 'relative', zIndex: 1 }}>
          Logged minutes by prescribed intensity, and by the standard 5-zone %HRmax model coaches use to prescribe
          them — context on where the week&rsquo;s load actually went, not a readiness score. The five-zone donut
          only counts sessions with a recorded heart rate; a session that logged no heart-rate trace is excluded
          rather than charted as zero.
          {excludedCount > 0 &&
            ` ${excludedCount} of ${sessionsWithResults} conditioning session${sessionsWithResults === 1 ? '' : 's'} logged this week had no recorded heart rate and ${excludedCount === 1 ? 'is' : 'are'} excluded from the donut.`}
        </p>
      </section>

      <p className="rd-section-label">Erg trends</p>
      {erg ? (
        <div className="rd-cards">
          <ErgCard series={erg} />
        </div>
      ) : (
        <p className="rd-panel-note">
          Trends appear after three tests logged at the same distance and modality — not enough erg history yet.
        </p>
      )}
    </div>
  );
}
