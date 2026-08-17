import {
  type Block,
  type Concept2Result,
  type Session,
  type Workout,
} from '@hybrid/engine';

/**
 * "Where they're at", derived — never asserted. Erg trends come from
 * Concept2 results, but only within one (modality, distance) group — mixing
 * a 2k with a 5k would make the pace line a lie.
 *
 * Lift trends (bestE1rmByLift-based) were removed with the strength engine
 * deletion — see CLAUDE.md.
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
  blocks.some((b) => b.kind === 'conditioning' && b.effort === 'hard');

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
