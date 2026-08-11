import { useMemo, useState } from 'react';
import {
  condEfforts,
  conMaxHr,
  hrMaxBandSeconds,
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
import { ProgressionActions } from '../progression-actions';
import { ergTrend, type TrendSeries } from '../trends';
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
 * — it tracks which efforts had no trace at all and says so.
 *
 * Every number is drawn from `condEfforts(sessions, settings)`
 * (packages/engine/src/balance.ts), the same reader `Progress.tsx` already
 * uses for its own weekly zone total — NOT a hand-rolled walk of
 * `session.blocks`. A conditioning result lives in one of two places
 * depending only on how the athlete started the run: tied to a session
 * block, or (Home's "Start conditioning" with no session context —
 * `screens/Conditioning.tsx`'s `submitMechanical`) standalone in
 * `settings.conditioning`. Both are real training; reading only the first
 * would silently undercount every run started from Home. Because a
 * standalone effort is not a `Session`, this screen counts and excludes
 * EFFORTS, not sessions.
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

/** An effort only counts as "recorded" if it actually banked at least one
 *  real beat — an all-null trace (no strap connected during that block) is
 *  the same absence as no trace object at all. */
function hasUsableTrace(ds: Downsampled | null | undefined): boolean {
  return !!ds && Array.isArray(ds.pts) && ds.pts.some((v) => v != null);
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

/*
 * The erg card's chart range, added 11 August 2026 by the Stage-1 final
 * review. `ErgCard` had no toggle at all: it rendered `ergSparkPath` in the
 * expanded view from the identical `points` array as the collapsed
 * sparkline, so expanding a card enlarged the same eight points and added
 * nothing — while the mockup's `renderCards()` emits `.rd-range-toggle` for
 * every card it draws, `#conditioning-cards` included.
 *
 * It was left out on the same false premise the branch already corrected
 * twice (Task 3's `whoopDaily`, Task 4's `liftTrends`): `ergTrend(results,
 * maxPoints = 8)`'s default was read as a limit on the data. It is not.
 * `netlify/functions/concept2-sync.mjs` stores up to `MAX_STORED_RESULTS =
 * 500` results, accumulated incrementally (it trims by COUNT, never by
 * date), with a 90-day backfill on first connect. The history behind an erg
 * card is routinely far longer than eight tests.
 *
 * The ranges are counts of TESTS, not days or weeks, and that is a
 * deliberate departure from Readiness's 7/30/90d — the same licence
 * Strength took for its justified 8w/13w. An erg series is indexed by test,
 * not by calendar: `ergTrend` charts one (modality, distance) group, so a
 * 30-day window on an athlete who tested twice that month would draw a
 * two-point line and call it a trend. `All` is bounded by the store's own
 * 500-result cap.
 *
 * Card identity is stable across the toggle by construction, not by luck:
 * `ergTrend` picks the largest group BEFORE `maxPoints` is applied, so
 * widening the range can never swap which test a card is showing.
 */
const ERG_RANGES = [8, 20, Number.MAX_SAFE_INTEGER] as const;
const DEFAULT_ERG_RANGE = ERG_RANGES[0];

function ergRangeLabel(range: number): string {
  return range === Number.MAX_SAFE_INTEGER ? 'All' : String(range);
}

/** Pace/500m is "lower is faster" — the opposite good-direction of a lift's
 *  e1RM — so the delta's good/bad coloring is inverted from `LiftCard`'s. */
function ErgCard({ series, results }: { series: TrendSeries; results: Concept2Result[] }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<number>(DEFAULT_ERG_RANGE);
  const cls = series.delta == null ? 'neutral' : series.delta <= 0 ? 'good' : 'bad';
  const color = cls === 'good' ? 'var(--color-ok)' : cls === 'bad' ? 'var(--color-bad)' : 'var(--color-muted)';
  const points = series.points.filter((p): p is number => p != null);
  const spark = ergSparkPath(points, 180, 38, 3);

  /* Re-derived at the selected window from the same results the collapsed
     sparkline came from — never padded or interpolated up to the range. */
  const expanded = useMemo(() => ergTrend(results, range), [results, range]);
  const expandedPoints = (expanded?.points ?? []).filter((p): p is number => p != null);
  const big = ergSparkPath(expandedPoints, 500, 60, 4);
  const short = range !== Number.MAX_SAFE_INTEGER && expandedPoints.length < range;

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
      {open && (
        <div className="rd-card-expand">
          <div className="rd-card-expand-inner">
            <div className="rd-range-toggle" role="group" aria-label={`${series.label} chart range, in tests`}>
              {ERG_RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={r === range ? 'active' : undefined}
                  aria-pressed={r === range}
                  onClick={() => setRange(r)}
                >
                  {ergRangeLabel(r)}
                </button>
              ))}
            </div>
            {big ? (
              <>
                {short && (
                  <p className="rd-stale-note" style={{ textAlign: 'left', marginBottom: 6 }}>
                    Only {expandedPoints.length} test{expandedPoints.length === 1 ? '' : 's'} on record for this
                    format — showing all of them, not a full {range}-test window.
                  </p>
                )}
                <svg className="rd-big-chart" viewBox="0 0 500 60">
                  <polygon points={big.area} fill={color} opacity={0.14} />
                  <polyline points={big.line} fill="none" stroke={color} strokeWidth={2} />
                </svg>
              </>
            ) : (
              <p className="rd-stale-note" style={{ textAlign: 'left' }}>
                Not enough {series.label} history yet for a chart.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Conditioning() {
  const { db, sessions } = useDb();
  const ledger = useProgressionLedger();
  const c2 = useConcept2();
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

  // Monday 00:00 UTC through the following Monday — the same calendar-week
  // boundary `trends.ts`'s `mondayMs`/`weeklyHardBudget` use elsewhere on
  // this screen's sibling pillars.
  const monday = useMemo(() => mondayOf(today), [today]);
  const weekStartMs = useMemo(() => Date.parse(`${monday}T00:00:00Z`), [monday]);
  const weekEndMs = weekStartMs + 7 * 864e5;

  // Both logging paths, one reader: a result tied to a session block and a
  // standalone Home-started run both land here, exactly like Progress.tsx's
  // own weekly zone total already reads them. `startedAt` is set on both
  // paths at completion time (screens/Conditioning.tsx's `finish()`), so
  // filtering on it — not on any `Session`'s date — is what makes a
  // standalone effort visible to "this week" at all.
  const weekEfforts = useMemo(
    () =>
      condEfforts(sessions, db.settings).filter((r) => {
        const at = Number(r.startedAt);
        return Number.isFinite(at) && at >= weekStartMs && at < weekEndMs;
      }),
    [sessions, db.settings, weekStartMs, weekEndMs],
  );

  const totalDurSec = useMemo(() => weekEfforts.reduce((sum, r) => sum + (r.dur ?? 0), 0), [weekEfforts]);
  const totalMinutes = Math.round(totalDurSec / 60);

  const zoneSec = useMemo(
    () =>
      weekEfforts.reduce(
        (acc, r) => {
          acc.low += r.zsec?.low ?? 0;
          acc.mod += r.zsec?.mod ?? 0;
          acc.high += r.zsec?.high ?? 0;
          return acc;
        },
        { low: 0, mod: 0, high: 0 },
      ),
    [weekEfforts],
  );
  const zoneTotalSec = zoneSec.low + zoneSec.mod + zoneSec.high;

  const maxHr = conMaxHr(db.settings.profile);
  const { bandSec, totalEfforts, tracedEfforts } = useMemo(() => {
    const bands: Record<HrMaxBand, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    let traced = 0;
    weekEfforts.forEach((r) => {
      if (!hasUsableTrace(r.trace)) return;
      traced += 1;
      const b = hrMaxBandSeconds(r.trace, maxHr);
      (Object.keys(b) as HrMaxBand[]).forEach((k) => {
        bands[k] += b[k];
      });
    });
    return { bandSec: bands, totalEfforts: weekEfforts.length, tracedEfforts: traced };
  }, [weekEfforts, maxHr]);
  const bandTotalSec = HR_BANDS.reduce((sum, b) => sum + bandSec[b.key], 0);
  const excludedCount = totalEfforts - tracedEfforts;

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
              <ProgressionActions proposal={proposal} />
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
          only counts conditioning efforts with a recorded heart rate — from a session block or a standalone run —
          and an effort that logged no heart-rate trace is excluded rather than charted as zero.
          {excludedCount > 0 &&
            ` ${excludedCount} of ${totalEfforts} conditioning effort${totalEfforts === 1 ? '' : 's'} logged this week had no recorded heart rate and ${excludedCount === 1 ? 'is' : 'are'} excluded from the donut.`}
        </p>
      </section>

      <p className="rd-section-label">Erg trends</p>
      {erg ? (
        <div className="rd-cards">
          <ErgCard series={erg} results={c2.results} />
        </div>
      ) : (
        <p className="rd-panel-note">
          Trends appear after three tests logged at the same distance and modality — not enough erg history yet.
        </p>
      )}
    </div>
  );
}
