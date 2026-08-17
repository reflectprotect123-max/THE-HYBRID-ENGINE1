import { INSIGHTS } from './constants';
import type { CondResult, EngineDB, ZoneKey } from './types';

/*
 * What has changed about you that you would not have noticed.
 *
 * Everything else in this app reports what you already lived through: tonnage,
 * session counts, a volume chart. None of it can answer the question the app
 * exists for — am I getting fitter — because adaptation is invisible from the
 * inside. Effort always feels like effort. A session that felt like an 8 last
 * month and an 8 today feels identical, and that is exactly the case where
 * something has changed.
 *
 * So every detector here compares you against YOUR OWN PAST SELF AT MATCHED
 * EFFORT, rather than reporting a raw number that got bigger. More weight is
 * not news if it cost more. More weight at the same felt RPE is.
 *
 * THE RULE THAT KEEPS THIS HONEST: a detector returns nothing below a minimum
 * sample size, and nothing below a relative-change floor. An engine that
 * invents a trend from four data points is worse than no engine at all,
 * because the fabricated finding costs the athlete their trust in the true
 * ones. This is the same discipline as `barScale` refusing to zoom an axis it
 * would mislead with, and as the notes panel preferring silence to a shrug.
 *
 * Declines are reported too, with `improved: false`. A detector that only ever
 * delivered good news would be a compliment generator, and the first time an
 * athlete was quietly overreaching it would say nothing.
 *
 * Nothing is truncated. Every finding that clears the bars is returned, sorted
 * strongest first, and the surface decides how many to draw — a cap applied
 * here would be a silent one, and a screen showing three of eleven findings
 * while implying it showed all of them is the failure this module is meant to
 * avoid.
 */

export type InsightKey =
  | 'strength-at-effort'
  | 'heart-rate-recovery'
  | 'recovery-trend'
  | 'work-rate'
  | 'volume-tolerance'
  | 'zone-efficiency';

export interface InsightEvidence {
  /** samples behind the recent figure */
  recentN: number;
  /** samples behind the baseline figure */
  baselineN: number;
  /** length of each window in days */
  windowDays: number;
}

/**
 * One finding, carrying the evidence for itself.
 *
 * `from`/`to`/`evidence` travel WITH the sentence rather than being recomputed
 * by whatever draws it. A surface that derived its own numbers could disagree
 * with the claim it is printing, and a screen that contradicts itself about
 * training is worse than one that says nothing.
 */
export interface Insight {
  key: InsightKey;
  /** stable identity — safe as a list key and for dismissing a finding */
  id: string;
  /** the movement or session this is about; '' when it concerns everything */
  subject: string;
  title: string;
  detail: string;
  /** the baseline window's figure */
  from: number;
  /** the recent window's figure */
  to: number;
  delta: number;
  /** relative change, or null when the baseline was 0 and a ratio says nothing */
  pct: number | null;
  unit: string;
  /** which direction counts as progress for this metric */
  better: 'higher' | 'lower';
  /** did it move the good way */
  improved: boolean;
  evidence: InsightEvidence;
}

interface Windows {
  recentFrom: number;
  recentTo: number;
  baseFrom: number;
  baseTo: number;
}

function windowsAt(now: Date): Windows {
  const recentTo = now.getTime();
  const recentFrom = recentTo - INSIGHTS.recentDays * 864e5;
  return {
    recentFrom,
    recentTo,
    // The baseline sits immediately before the recent window, not at the start
    // of all history: "fitter than last month" is a question this data can
    // answer, "fitter than the first session you ever logged" compares two
    // different people.
    baseTo: recentFrom,
    baseFrom: recentFrom - INSIGHTS.baselineDays * 864e5,
  };
}

function inRecent(t: number, w: Windows): boolean {
  return t >= w.recentFrom && t <= w.recentTo;
}

function inBaseline(t: number, w: Windows): boolean {
  return t >= w.baseFrom && t < w.baseTo;
}

function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

/** Round to two decimals. Stored figures are compared, so they must be stable. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * When the athlete rated it. Rounded to the half point the slider actually
 * offers, because matching effort is the whole mechanism: two sets are only
 * comparable if they cost the same, and 7.4 against 8.4 is not the same cost.
 */
function feltBucket(v: unknown): number | null {
  const n = parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 2) / 2;
}


interface Change {
  from: number;
  to: number;
  delta: number;
  pct: number | null;
}

/**
 * Compare two windows, or refuse to.
 *
 * Both gates live here so no detector can forget one: too few samples on
 * either side, or a difference inside the noise floor, and there is nothing to
 * report. A null return is the normal outcome for an athlete a fortnight into
 * training, and that is correct — there is genuinely nothing to say yet.
 */
// `minPerWindow` is annotated rather than inferred: `INSIGHTS` is `as const`,
// so an inferred default would type the parameter as the literal 3 and reject
// every detector that passes its own minimum.
function change(recent: number[], base: number[], minPerWindow: number = INSIGHTS.minPerWindow): Change | null {
  if (recent.length < minPerWindow || base.length < minPerWindow) return null;
  const from = mean(base);
  const to = mean(recent);
  const delta = to - from;
  const pct = from > 0 ? delta / from : null;
  if (pct != null && Math.abs(pct) < INSIGHTS.minRelChange) return null;
  // With no usable ratio the floor cannot be applied, so an exactly-zero move
  // is the only thing left to reject.
  if (pct == null && delta === 0) return null;
  return { from: r2(from), to: r2(to), delta: r2(delta), pct };
}

function build(
  key: InsightKey,
  subject: string,
  c: Change,
  unit: string,
  better: 'higher' | 'lower',
  recentN: number,
  baselineN: number,
  title: string,
  detail: string,
): Insight {
  return {
    key,
    id: subject ? `${key}:${subject.toLowerCase()}` : key,
    subject,
    title,
    detail,
    from: c.from,
    to: c.to,
    delta: c.delta,
    pct: c.pct,
    unit,
    better,
    improved: better === 'higher' ? c.delta > 0 : c.delta < 0,
    evidence: { recentN, baselineN, windowDays: INSIGHTS.recentDays },
  };
}

function pctLabel(c: Change): string {
  return c.pct == null ? '' : ` (${c.pct > 0 ? '+' : ''}${Math.round(c.pct * 100)}%)`;
}

/*
 * `strengthAtEffort` (headline strength finding), `workRate` and
 * `volumeTolerance` were deleted whole on 17 August 2026 with the rest of
 * strength — all three compared logged sets/tonnage against a movement
 * catalogue that no longer exists. `heartRateRecovery`/`recoveryTrend`/
 * `zoneEfficiency` below are conditioning/WHOOP-only and stay untouched.
 */
type Buckets = Map<number, number[]>;

/* ---------- 2. heart-rate recovery ---------- */

function condRecords(db: EngineDB): CondResult[] {
  const list = Array.isArray(db.settings.conditioning) ? db.settings.conditioning : [];
  // A simulated session is not a performance. `conAdapt` refuses to bank a
  // level from one and this must refuse to draw a trend from one.
  return list.filter((r) => r && !r.sim && Number.isFinite(r.startedAt as number));
}

/**
 * How fast the heart comes down after the hardest point of a session.
 *
 * The cleanest cardiac adaptation signal in this dataset, and completely
 * imperceptible day to day — nobody notices their own HRR improving, which is
 * precisely why it belongs here rather than on a live screen.
 *
 * Note that `conAdapt` deliberately does NOT gate progression on HRR, because
 * its day-to-day noise swamped the old 1bpm tolerance. Averaging a month of it
 * against another month is a different question from judging one session by
 * it, and is what the noise floor and sample minimum exist to make safe.
 */
function heartRateRecovery(db: EngineDB, w: Windows): Insight[] {
  const recent: number[] = [];
  const base: number[] = [];

  condRecords(db).forEach((r) => {
    if (r.hrr == null || !Number.isFinite(r.hrr)) return;
    const at = r.startedAt as number;
    if (inRecent(at, w)) recent.push(r.hrr);
    else if (inBaseline(at, w)) base.push(r.hrr);
  });

  const c = change(recent, base);
  if (!c) return [];
  const up = c.delta > 0;
  return [
    build(
      'heart-rate-recovery',
      '',
      c,
      'bpm',
      'higher',
      recent.length,
      base.length,
      up ? 'Your heart is settling faster' : 'Your heart is settling more slowly',
      `Heart-rate recovery in the minute after your hardest effort went from ${c.from} to ${c.to}bpm` +
        `${pctLabel(c)} across ${recent.length} recent conditioning sessions.`,
    ),
  ];
}

/* ---------- 3. recovery trend ---------- */

interface DailyRow {
  date?: string;
  recovery?: number | null;
}

/**
 * Where the daily WHOOP figures live, and what survives being stored.
 *
 * NOTE, because it decides what this detector can be: `whoopDaily` keeps only
 * `{ date, recovery, strain }`. Resting heart rate, HRV and sleep performance
 * reach the app on the live `WhoopSample` and are dropped before persistence,
 * so the RHR/HRV drift this module was originally sketched with is NOT
 * computable — there is no history of either to take a mean of. Widening the
 * stored row is the change that would unlock it, and until someone makes it,
 * recovery score is the honest substitute.
 */
function dailyRows(db: EngineDB): DailyRow[] {
  return Array.isArray(db.settings.whoopDaily) ? (db.settings.whoopDaily as DailyRow[]) : [];
}

function recoveryTrend(db: EngineDB, w: Windows): Insight[] {
  const recent: number[] = [];
  const base: number[] = [];

  dailyRows(db).forEach((row) => {
    const n = Number(row && row.recovery);
    if (!Number.isFinite(n)) return;
    const at = Date.parse(String((row && row.date) || '') + 'T12:00:00');
    if (!Number.isFinite(at)) return;
    if (inRecent(at, w)) recent.push(n);
    else if (inBaseline(at, w)) base.push(n);
  });

  const c = change(recent, base);
  if (!c) return [];
  const up = c.delta > 0;
  return [
    build(
      'recovery-trend',
      '',
      c,
      '%',
      'higher',
      recent.length,
      base.length,
      up ? 'You are recovering better than a month ago' : 'You are recovering less well than a month ago',
      `Your mean daily recovery moved from ${c.from}% to ${c.to}%${pctLabel(c)} over ` +
        `${recent.length} days — a change too gradual to feel one morning at a time.`,
    ),
  ];
}

/* ---------- 6. zone efficiency ---------- */

function zonedTotal(z: Record<ZoneKey, number> | undefined): number {
  if (!z) return 0;
  return (z.low || 0) + (z.mod || 0) + (z.high || 0);
}

/**
 * More time in the hard zone, at the same reported effort.
 *
 * Measured as a FRACTION of the session's banked time rather than raw seconds,
 * for the same reason `conAdapt` divides by working time rather than total: a
 * longer session banks more high-zone seconds without anything having
 * improved, and an engine that called that progress would be rewarding a
 * longer run rather than a better one.
 */
function zoneEfficiency(db: EngineDB, w: Windows): Insight[] {
  const recent: Buckets = new Map();
  const base: Buckets = new Map();

  condRecords(db).forEach((r) => {
    const felt = feltBucket(r.felt);
    if (felt == null) return;
    const total = zonedTotal(r.zsec);
    if (!(total > 0)) return;
    const frac = (r.zsec && r.zsec.high) || 0;
    const at = r.startedAt as number;
    const into = inRecent(at, w) ? recent : inBaseline(at, w) ? base : null;
    if (!into) return;
    const arr = into.get(felt);
    if (arr) arr.push(frac / total);
    else into.set(felt, [frac / total]);
  });

  const rMeans: number[] = [];
  const bMeans: number[] = [];
  const matched: number[] = [];
  let rN = 0;
  let bN = 0;

  recent.forEach((rVals, felt) => {
    const bVals = base.get(felt);
    if (!bVals) return;
    if (rVals.length < INSIGHTS.minPerBucket || bVals.length < INSIGHTS.minPerBucket) return;
    rMeans.push(mean(rVals));
    bMeans.push(mean(bVals));
    matched.push(felt);
    rN += rVals.length;
    bN += bVals.length;
  });

  if (!matched.length || rN < INSIGHTS.minPerWindow || bN < INSIGHTS.minPerWindow) return [];

  const c = change([mean(rMeans)], [mean(bMeans)], 1);
  if (!c) return [];

  const pctOf = (v: number) => Math.round(v * 100);
  const up = c.delta > 0;
  return [
    build(
      'zone-efficiency',
      '',
      c,
      'fraction of session',
      'higher',
      rN,
      bN,
      up ? 'You are holding the hard zone for longer' : 'You are spending less time in the hard zone',
      `At the same reported effort (RPE ${matched.sort((a, b) => a - b).join(', RPE ')}), the share of your ` +
        `conditioning spent in Overload went from ${pctOf(c.from)}% to ${pctOf(c.to)}%.`,
    ),
  ];
}

/* ---------- the engine ---------- */

/**
 * Everything this data can honestly say has changed.
 *
 * Returns an empty array far more often than not, and that is the design: an
 * athlete four weeks in has no baseline to be compared against, and silence is
 * the correct output. The first real finding should mean something.
 *
 * Sorted by relative magnitude so the strongest finding leads. Findings with
 * no usable ratio sort last rather than being dropped — they are still true.
 */
export function insights(db: EngineDB, now: Date = new Date()): Insight[] {
  if (!db) return [];
  const w = windowsAt(now);

  const found = [...heartRateRecovery(db, w), ...recoveryTrend(db, w), ...zoneEfficiency(db, w)];

  return found.sort((a, b) => {
    const am = a.pct == null ? -1 : Math.abs(a.pct);
    const bm = b.pct == null ? -1 : Math.abs(b.pct);
    if (am !== bm) return bm - am;
    return b.evidence.recentN - a.evidence.recentN;
  });
}
