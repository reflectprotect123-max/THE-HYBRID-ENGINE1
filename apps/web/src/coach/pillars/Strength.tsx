import { useMemo, useState } from 'react';
import type { Session } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { PillarBack } from './PillarBack';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import { useRosterTrend } from './useRosterTrend';
import { RosterTrendPanel } from './RosterTrendPanel';
import { useProgressionLedger } from '../../store/progression';
import type { ProgressionDirection, StrengthProgressionProposal } from '../../lib/progression';
import { ProgressionActions } from '../components/progression-actions';
import { liftTrends, liftTrendSummary, weeklyHardBudget, type HardBudget, type TrendSeries } from '../data/trends';
import '../coach-redesign.css';

/*
 * The mockup's `<section id="view-strength">`, ported to JSX.
 *
 * The progression queue reads the exact same local ledger
 * `CoachProgression`'s self-coach view reads today (`useProgressionLedger`,
 * filtered to domain 'strength' and not yet decided) — not a second source
 * of truth. Each item mounts `ProgressionActions` (Task 6b,
 * `../progression-actions.tsx`) — the SAME decide/apply/rationale logic
 * `CoachProgression`'s self-coach view uses, not a second decision path.
 * Approving here, or on `/coach/progression`, only ever updates
 * `settings.liftProgress` — never a weekly plan, which stays the
 * Coordinator's alone to write.
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
 * e1RM is sparse and weekly, unlike WHOOP's continuous daily series — but
 * `liftTrends`'s `weeks` parameter is real windowing, not a fixed ceiling
 * (trends.ts:37-40), and `sessions` genuinely carries history well past its
 * 8-week default (Progress.tsx windows the same array 16 weeks deep). So the
 * range toggle here is real: 8 weeks (this card's existing default) and 13
 * weeks (~90 days, the longest honest window before weekly e1RM exposure
 * gets too sparse to read as a line). No day-level granularity is invented —
 * the unit stays "week", because that is the true grain of this metric.
 */
const WEEK_RANGES = [8, 13] as const;
type WeekRange = (typeof WEEK_RANGES)[number];
const DEFAULT_WEEK_RANGE: WeekRange = 8;

/** Calendar weeks since the athlete's EARLIEST logged session of any kind —
 *  the true boundary of "there could be data at all", exactly as
 *  `whoopDaily`'s retained length is that boundary for the Readiness cards.
 *  A null slot inside that boundary is a genuine no-exposure week; a null
 *  slot before it is "history hadn't started yet", and the two must not
 *  read the same on screen. */
function weeksOfHistory(sessions: Session[], today: string): number {
  const dates = sessions.map((s) => s.date).filter(Boolean);
  if (!dates.length) return 0;
  const earliest = dates.reduce((a, b) => (a < b ? a : b));
  const days = Math.max(
    0,
    Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 864e5),
  );
  return Math.floor(days / 7) + 1;
}

function LiftCard({
  series,
  sessions,
  today,
  historyWeeks,
}: {
  series: TrendSeries;
  sessions: Session[];
  today: string;
  historyWeeks: number;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<WeekRange>(DEFAULT_WEEK_RANGE);
  const cls = series.delta == null ? 'neutral' : series.delta >= 0 ? 'good' : 'bad';
  const color = cls === 'good' ? 'var(--color-ok)' : cls === 'bad' ? 'var(--color-bad)' : 'var(--color-muted)';
  const spark = liftSparkPath(series.points, 180, 38, 3);

  /* Re-derives THIS lift's real series at the selected window. A large topK
   * only guards against the sort dropping the lift already shown as a card —
   * `.find` by name picks it out, so the range toggle can never silently
   * swap which lift a card is showing. `null` means genuinely fewer than
   * three real exposures inside that particular window, not "no data to
   * ask for". */
  const expanded = useMemo(
    () => liftTrends(sessions, today, range, 20).find((s) => s.label === series.label) ?? null,
    [sessions, today, range, series.label],
  );
  const big = expanded ? liftSparkPath(expanded.points, 500, 60, 4) : null;
  const short = historyWeeks < range;

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
            <div className="rd-range-toggle" role="group" aria-label={`${series.label} chart range`}>
              {WEEK_RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={r === range ? 'active' : undefined}
                  aria-pressed={r === range}
                  onClick={() => setRange(r)}
                >
                  {r}w
                </button>
              ))}
            </div>
            {big ? (
              <>
                {short && (
                  <p className="rd-stale-note" style={{ textAlign: 'left', marginBottom: 6 }}>
                    Only {historyWeeks} week{historyWeeks === 1 ? '' : 's'} of session history on record — showing
                    all of it, not a full {range}-week window.
                  </p>
                )}
                <svg className="rd-big-chart" viewBox="0 0 500 60">
                  <polygon points={big.area} fill={color} opacity={0.14} />
                  <polyline points={big.line} fill="none" stroke={color} strokeWidth={2} />
                </svg>
              </>
            ) : (
              <p className="rd-stale-note" style={{ textAlign: 'left' }}>
                Not enough {series.label} history yet for a {range}-week view.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A roster athlete's Strength pillar.
 *
 * Two snapshots, because the self-coach screen shows two things: the lift
 * trends and the weekly hard-session budget. Both are pushed by the
 * athlete's own device (`trendSnapshotInputs`), so both are read rather than
 * recomputed — this screen has none of the raw sessions they were computed
 * from and must not pretend otherwise.
 *
 * The progression QUEUE is absent here by design, not by omission: roster
 * proposals live on `/coach/progression`, which already reads them and
 * already carries the approve/decline controls. Duplicating that queue here
 * would give a coach two places to decide the same thing.
 */
function RosterStrength({ clientId, clientName }: { clientId: string; clientName: string }) {
  const lifts = useRosterTrend<TrendSeries>(clientId, 'lift_trend');
  const budget = useRosterTrend<HardBudget>(clientId, 'hard_budget');
  const hard = budget.status === 'ready' ? budget.points[0] ?? null : null;

  return (
    <div className="rd-content">
      <PillarBack />
      <p className="rd-section-label">Lift trends · {clientName}</p>
      <RosterTrendPanel state={lifts} unit="kg" label="lift trends" />

      <p className="rd-section-label">Weekly hard-session budget</p>
      {hard ? (
        <div className="rd-panel">
          <div className="rd-loadbar">
            <div className="lb-top">
              <span>Used</span>
              <span className="num">{hard.count} of {hard.budget} hard sessions</span>
            </div>
            <div className="lb-track">
              <div className="lb-fill" style={{ width: `${Math.min(100, (hard.count / hard.budget) * 100)}%` }} />
            </div>
          </div>
        </div>
      ) : (
        <p className="rd-panel-note">
          {budget.status === 'loading' ? 'Loading the budget…' : 'No hard-session budget has been shared yet.'}
        </p>
      )}
    </div>
  );
}

export function Strength() {
  const { selectedClient, loading } = useCoachWorkspace();
  /*
   * The loading state is NOT folded into the self branch, and that is the
   * whole reason it is written out. `listClients()` is async, so for the
   * first frames after mount `selectedClient` is null — and a naive
   * `selectedClient?.source !== 'engine-local' ? roster : self` renders the
   * SELF view during those frames, which puts the signed-in coach's own
   * training on screen under a roster athlete's name. Briefly, but that is
   * exactly the leak `ClientDetailGate`'s header comment exists to prevent,
   * and "only for 200ms" is not a defence for showing one person's data
   * under another person's name. Caught by `roster-pillars.test.tsx`.
   */
  if (loading) return <main className="rd-content" aria-busy="true">Loading…</main>;
  if (selectedClient && selectedClient.source !== 'engine-local') {
    return <RosterStrength clientId={selectedClient.id} clientName={selectedClient.name} />;
  }
  return <SelfStrength />;
}

function SelfStrength() {
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

  /*
   * EVERY lift with enough exposure to chart, not `liftTrends`' default
   * `topK` of 2 (Stage-1 final review). The mockup shows four cards; an
   * athlete tracking six saw two, silently. There is no cap here now, so
   * there is no arbitrary number to justify — the only filter left is the
   * engine's real one, three weeks of exposure, and `belowThreshold` names
   * the lifts it holds back so that filter stops being silent too.
   */
  const { series: lifts, belowThreshold } = useMemo(
    () => liftTrendSummary(sessions, today),
    [sessions, today],
  );
  const historyWeeks = useMemo(() => weeksOfHistory(sessions, today), [sessions, today]);

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
              <ProgressionActions proposal={proposal} />
            </div>
          ))}
        </div>
      </section>

      <p className="rd-section-label">Lift trends · e1RM</p>
      {lifts.length === 0 ? (
        <p className="rd-panel-note">
          Trends appear after three weeks of logged lifting on the same lift — not enough history yet.
          {belowThreshold.length > 0 && ` ${belowThreshold.length} lift${belowThreshold.length === 1 ? ' was' : 's were'} logged in this window but not on three separate weeks: ${belowThreshold.join(', ')}.`}
        </p>
      ) : (
        <>
          <div className="rd-cards">
            {lifts.map((series) => (
              <LiftCard key={series.label} series={series} sessions={sessions} today={today} historyWeeks={historyWeeks} />
            ))}
          </div>
          {belowThreshold.length > 0 && (
            <p className="rd-panel-note">
              Not charted: {belowThreshold.join(', ')} — logged in this window, but not on three separate weeks, so
              there is no honest line to draw yet.
            </p>
          )}
        </>
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
