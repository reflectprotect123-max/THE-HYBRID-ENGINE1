import { useMemo, useState } from 'react';
import { useDb } from '../../store/db';
import { PillarBack } from './PillarBack';
import { useProgressionLedger } from '../progression-store';
import type { ProgressionDirection, StrengthProgressionProposal } from '../progression';
import { liftTrends, weeklyHardBudget, type TrendSeries } from '../trends';
import '../coach-redesign.css';

/*
 * The mockup's `<section id="view-strength">`, ported to JSX.
 *
 * The progression queue reads the exact same local ledger
 * `CoachProgression`'s self-coach view reads today (`useProgressionLedger`,
 * filtered to domain 'strength' and not yet decided) — not a second source
 * of truth. This screen is display-only: it does not add an Approve button
 * of its own, so there is no second decision path for a coach to find.
 * Approving a strength proposal still happens on `/coach/progression`
 * (until Task 7 retires that route in favour of this one) and, either way,
 * only ever updates `settings.liftProgress` — never a weekly plan, which
 * stays the Coordinator's alone to write.
 */

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function liftPrescription(value: { kg: number; reps?: number } | null): string {
  if (!value) return 'No accepted working weight';
  return `${value.kg} kg${value.reps ? ` × ${value.reps}` : ''}`;
}

/* The mockup only styles three badge states (`approval` / `hold` / `review`)
 * even though a real proposal can also carry `direction: 'decrease'` (a
 * deload). A decrease still needs the same coach approval click as an
 * increase — only `review` is blocked from Approve — so it shares the
 * `approval` badge rather than inventing a fourth CSS class the approved
 * mockup doesn't define. */
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

/** Weekly e1RM points carry `null` for weeks with no exposure — the x
 *  position for each known point still comes from ITS OWN index in the full
 *  points array (never a compacted index), exactly like the sparkline in
 *  `AthleteStatus.tsx`'s `Spark`, so a gap in training reads as a gap in the
 *  line rather than being silently compressed away. */
function liftSparkPath(points: Array<number | null>, w: number, h: number, pad: number) {
  const known = points
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null);
  if (known.length < 2) return null;
  const min = Math.min(...known.map((p) => p.v));
  const max = Math.max(...known.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - 2 * pad)) / span;
  const line = known.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const first = known[0]!;
  const last = known[known.length - 1]!;
  const area = `${x(first.i).toFixed(1)},${(h - pad).toFixed(1)} ${line} ${x(last.i).toFixed(1)},${(h - pad).toFixed(1)}`;
  return { line, area, lastX: x(last.i), lastY: y(last.v) };
}

function LiftIcon() {
  return (
    <span className="c-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 12h11M3 10v4M21 10v4" />
        <circle cx="4.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="19.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

/*
 * The mockup's lift cards expand into a 7/30/90-day range toggle, but that
 * toggle is wired to fabricated data (`series.concat(series.map(v => v *
 * (0.92 + Math.random() * 0.16)))` in the source artifact) — there is no
 * honest day-level e1RM series to switch between, only the one real weekly
 * window `liftTrends` computes. Padding or jittering one to fill a fake
 * range is exactly what "absent data is stated, never faked" forbids, so
 * this card expands into a bigger view of the SAME real weekly series
 * instead of a range toggle with nothing genuine behind two of its buttons.
 */
function LiftCard({ series }: { series: TrendSeries }) {
  const [open, setOpen] = useState(false);
  const cls = series.delta == null ? 'neutral' : series.delta >= 0 ? 'good' : 'bad';
  const color = cls === 'good' ? 'var(--color-ok)' : cls === 'bad' ? 'var(--color-bad)' : 'var(--color-muted)';
  const spark = liftSparkPath(series.points, 180, 38, 3);
  const big = liftSparkPath(series.points, 500, 60, 4);

  return (
    <div className={`rd-card${open ? ' open' : ''}`}>
      <button
        type="button"
        className="rd-card-top"
        aria-expanded={open}
        aria-label={`Expand ${series.label} chart`}
        onClick={() => setOpen((v) => !v)}
      >
        <LiftIcon />
        <span className="c-label">{series.label} e1RM</span>
        <span className="c-chev">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </button>
      <div className="rd-card-value">
        <span className="c-num num">{series.latest}</span>
        <span className="c-unit">kg</span>
      </div>
      <div className={`rd-card-delta ${cls}`}>
        {series.delta == null ? '—' : `${series.delta >= 0 ? '+' : ''}${series.delta} kg`} · {series.sub}
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
            {big ? (
              <svg className="rd-big-chart" viewBox="0 0 500 60">
                <polygon points={big.area} fill={color} opacity={0.14} />
                <polyline points={big.line} fill="none" stroke={color} strokeWidth={2} />
              </svg>
            ) : (
              <p className="rd-stale-note" style={{ textAlign: 'left' }}>Not enough history yet for a bigger view.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Strength() {
  const { db, workouts, sessions } = useDb();
  const ledger = useProgressionLedger();
  const today = new Date().toISOString().slice(0, 10);

  const decided = useMemo(() => new Set(ledger.decisions.map((event) => event.proposalId)), [ledger.decisions]);
  const pending = useMemo(
    () =>
      ledger.proposals.filter(
        (proposal): proposal is StrengthProgressionProposal => proposal.domain === 'strength' && !decided.has(proposal.id),
      ),
    [ledger.proposals, decided],
  );

  const lifts = useMemo(() => liftTrends(sessions, today), [sessions, today]);

  // Same budget source as `AthleteStatus.tsx`'s self-coach panel: the
  // athlete's own scheduled strength + conditioning sessions/week, not a
  // number invented for this screen.
  const schedule = db.core?.schedule;
  const budgetTarget =
    (schedule?.strengthSessionsPerWeek ?? 0) + (schedule?.conditioningSessionsPerWeek ?? 0) || 3;
  const hard = useMemo(
    () => weeklyHardBudget(workouts, sessions, today, budgetTarget),
    [workouts, sessions, today, budgetTarget],
  );
  const fillPct = Math.min(100, (hard.count / hard.budget) * 100);

  return (
    <div className="rd-content">
      <PillarBack />

      <section className="rd-queue" aria-labelledby="strength-queue-title">
        <div className="rd-queue-head">
          <p>Now</p>
          <h2 id="strength-queue-title">Progression queue</h2>
          <span className="count">{pending.length} open</span>
        </div>
        <div className="rd-queue-list">
          {pending.length === 0 && (
            <div className="rd-queue-item">
              <p className="qi-detail">No pending strength proposals right now. Complete a session to create one.</p>
            </div>
          )}
          {pending.map((proposal) => (
            <div className="rd-queue-item" key={proposal.id}>
              <div className="qi-top">
                <span className="qi-lift">{proposal.subject}</span>
                <span className={`qi-badge ${badgeClass(proposal.direction)}`}>{badgeLabel(proposal.direction)}</span>
              </div>
              <p className="qi-change">
                {liftPrescription(proposal.before)} <span className="arrow">→</span>{' '}
                <strong>{liftPrescription(proposal.after)}</strong>
              </p>
              <p className="qi-detail">
                {capitalize(proposal.confidence)} confidence · {proposal.reason}
              </p>
            </div>
          ))}
        </div>
      </section>

      <p className="rd-section-label">Lift trends · e1RM</p>
      {lifts.length === 0 ? (
        <p className="rd-panel-note">
          Trends appear after three weeks of logged lifting on the same lift — not enough history yet.
        </p>
      ) : (
        <div className="rd-cards">
          {lifts.map((series) => (
            <LiftCard key={series.label} series={series} />
          ))}
        </div>
      )}

      <p className="rd-section-label">Weekly hard-session budget</p>
      <section className="rd-panel">
        <div className="rd-loadbar">
          <div className="lb-top">
            <span>Used</span>
            <span className="num">
              {hard.count} of {hard.budget} hard sessions
            </span>
          </div>
          <div className="lb-track">
            <div className="lb-fill" style={{ width: `${fillPct}%`, background: 'var(--color-gold)' }} />
          </div>
        </div>
        <p className="rd-panel-note">
          A session counts as hard if any block was logged at RPE 8+ (strength) or a hard-effort conditioning block.
          The ceiling is the athlete&rsquo;s own scheduled strength + conditioning sessions/week — not a target to
          fill, a cap not to cross.
        </p>
      </section>
    </div>
  );
}
