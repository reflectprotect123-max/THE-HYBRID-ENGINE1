import {
  bestE1rmByLift,
  type Block,
  type Concept2Result,
  type Session,
  type Workout,
} from '@hybrid/engine';

/**
 * "Where they're at", derived — never asserted. Lift trends come from the
 * engine's own e1RM math (bestE1rmByLift, which already excludes warm-ups
 * and un-done sets), windowed per week. Erg trends come from Concept2
 * results, but only within one (modality, distance) group — mixing a 2k
 * with a 5k would make the pace line a lie.
 */

export interface TrendSeries {
  label: string;
  sub: string;
  /** one slot per week (oldest first); null = no exposure that week */
  points: Array<number | null>;
  latest: number;
  /** latest minus first observed; null when only one observation */
  delta: number | null;
}

const DAY = 864e5;

function mondayMs(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.getTime();
}

export interface LiftTrendSummary {
  /** Every lift with enough real exposure to chart, best-exposed first. */
  series: TrendSeries[];
  /** Lifts the athlete DID train in this window but which have fewer than
   *  three weeks of exposure, so no line can honestly be drawn for them yet.
   *  Named so the screen can say what it is not showing. */
  belowThreshold: string[];
  /** Qualifying lifts dropped by `topK`, if a caller asked for a cap. */
  droppedByCap: string[];
}

/**
 * Weekly best-e1RM series per lift, plus what was left out and why.
 *
 * Added 11 August 2026 by the Stage-1 final review. `liftTrends` returned
 * only the series, and its `topK` default of 2 meant an athlete tracking six
 * lifts saw two, with nothing on screen saying four were dropped. The
 * three-week exposure filter was silent in the same way: a lift trained
 * twice simply vanished. Both are legitimate filters and neither should be
 * invisible — Conditioning states its excluded efforts in full and Nutrition
 * states every absent-data case in words; this is the same line.
 */
export function liftTrendSummary(
  sessions: Session[],
  today: string,
  weeks = 8,
  topK = Number.MAX_SAFE_INTEGER,
): LiftTrendSummary {
  const mon0 = mondayMs(today);
  const perLift = new Map<string, { name: string; points: Array<number | null> }>();

  for (let w = 0; w < weeks; w++) {
    const from = mon0 - (weeks - 1 - w) * 7 * DAY;
    const best = bestE1rmByLift(sessions, from, from + 7 * DAY);
    for (const [key, v] of best) {
      let row = perLift.get(key);
      if (!row) {
        row = { name: v.name, points: Array.from({ length: weeks }, () => null) };
        perLift.set(key, row);
      }
      row.points[w] = Math.round(v.e1 * 10) / 10;
    }
  }

  const rows = [...perLift.values()].map((row) => {
    const seen = row.points.filter((p): p is number => p != null);
    return { row, exposures: seen.length, first: seen[0], latest: seen[seen.length - 1] };
  });

  const qualifying = rows
    .filter((x) => x.exposures >= 3 && x.latest != null)
    .sort((a, b) => b.exposures - a.exposures || (b.latest ?? 0) - (a.latest ?? 0));

  return {
    series: qualifying.slice(0, topK).map(({ row, exposures, first, latest }) => ({
      label: row.name,
      sub: `best e1RM · ${exposures} of ${weeks} weeks`,
      points: row.points,
      latest: latest!,
      delta: exposures > 1 ? Math.round((latest! - first!) * 10) / 10 : null,
    })),
    belowThreshold: rows.filter((x) => x.exposures < 3 || x.latest == null).map((x) => x.row.name),
    droppedByCap: qualifying.slice(topK).map((x) => x.row.name),
  };
}

/** Weekly best-e1RM series for the athlete's most-trained lifts.
 *
 *  `topK` still defaults to 2 for this thin wrapper because its one caller
 *  is `LiftCard`'s expanded-range lookup, which passes an explicit 20 and
 *  `.find`s one label out of the result. Screens that RENDER a card list
 *  want `liftTrendSummary` above, which reports its own exclusions. */
export function liftTrends(
  sessions: Session[],
  today: string,
  weeks = 8,
  topK = 2,
): TrendSeries[] {
  return liftTrendSummary(sessions, today, weeks, topK).series;
}

/** Pace-per-500m trend within the athlete's most repeated erg test. */
export function ergTrend(results: Concept2Result[], maxPoints = 8): TrendSeries | null {
  const usable = results.filter(
    (r) =>
      r.startedAt != null &&
      r.distanceRaw != null &&
      r.distanceRaw >= 500 &&
      r.durationRaw != null &&
      r.durationRaw > 0,
  );
  const groups = new Map<string, Concept2Result[]>();
  for (const r of usable) {
    const key = `${r.modality ?? 'erg'}:${r.distanceRaw}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }
  let best: Concept2Result[] | null = null;
  for (const g of groups.values()) if (!best || g.length > best.length) best = g;
  if (!best || best.length < 3) return null;

  const sorted = best
    .slice()
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
    .slice(-maxPoints);
  // durationRaw is tenths of a second (see engine concept2.ts)
  const pace = sorted.map((r) => Math.round(((r.durationRaw! / 10) / (r.distanceRaw! / 500)) * 10) / 10);
  const sample = sorted[0]!;
  return {
    label: `${sample.distanceRaw}m ${(sample.modality ?? 'erg').replace('_', ' ')}`,
    sub: `pace /500m · last ${pace.length} tests`,
    points: pace,
    latest: pace[pace.length - 1]!,
    delta: pace.length > 1 ? Math.round((pace[pace.length - 1]! - pace[0]!) * 10) / 10 : null,
  };
}

const hardBlocks = (blocks: Block[]): boolean =>
  blocks.some((b) =>
    b.kind === 'conditioning'
      ? b.effort === 'hard'
      : b.kind === undefined &&
        !b.warmup &&
        (b.exercises ?? []).some((ex) => ex.sets.some((s) => parseFloat(String(s.rpe)) >= 8)),
  );

export interface HardBudget {
  count: number;
  budget: number;
}

/**
 * Hard sessions in the current week: logged ones count as themselves;
 * planned occurrences count only on today-or-future dates and only when no
 * logged session of the same name/kind already claimed the day (mirrors the
 * grid's dedup rule).
 */
export function weeklyHardBudget(
  workouts: Workout[],
  sessions: Session[],
  today: string,
  budget: number,
): HardBudget {
  const mon0 = mondayMs(today);
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(mon0 + i * DAY).toISOString().slice(0, 10),
  );
  let count = 0;
  const loggedByDate = new Map<string, Session[]>();
  for (const s of sessions) {
    if (!dates.includes(s.date) || s.status === 'active') continue;
    (loggedByDate.get(s.date) ?? loggedByDate.set(s.date, []).get(s.date)!).push(s);
    if (hardBlocks(s.blocks)) count++;
  }
  for (const date of dates) {
    if (date < today) continue;
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const w of workouts) {
      const placed = (w.dates?.includes(date) ?? false) || (w.days?.includes(wd) ?? false);
      if (!placed || !hardBlocks(w.blocks)) continue;
      const logged = loggedByDate.get(date) ?? [];
      if (logged.some((s) => s.name === w.name && (s.kind ?? 'strength') === (w.kind ?? 'strength'))) continue;
      count++;
    }
  }
  return { count, budget: Math.max(1, budget) };
}
