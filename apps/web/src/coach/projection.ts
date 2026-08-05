import type { Block, CondBlock, Session, StrengthBlock, Workout } from '@hybrid/engine';
import { mondayOf } from '@hybrid/coordinator-adapter';

/**
 * Pure projections from the existing store shapes onto the program grid.
 * Nothing here mutates, fetches, or invents state — the grid and the
 * same-weekday view are both renderings of these functions' output, which is
 * what keeps "one object, many views" true.
 */

export interface CellItem {
  id: string;
  kind: 'strength' | 'conditioning';
  name: string;
  /** one compact line: top lift + dose, or modality + format */
  keyline: string;
  source: 'planned' | 'logged';
  status?: Session['status'];
}

export interface DayCell {
  /** YYYY-MM-DD */
  date: string;
  items: CellItem[];
}

export type WeekRow = DayCell[];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Monday-anchored grid of dates: `weeksBack` historical rows, the current
 * week, and `weeksForward - 1` future rows. Row 0 is the oldest.
 */
export function gridDates(today: string, weeksBack: number, weeksForward: number): string[][] {
  const monday = mondayOf(today);
  const rows: string[][] = [];
  for (let w = -weeksBack; w < weeksForward; w++) {
    const start = addDays(monday, w * 7);
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return rows;
}

function isCondBlock(b: Block): b is CondBlock {
  return b.kind === 'conditioning';
}

function strengthKeyline(blocks: Block[]): string {
  const work = blocks.find(
    (b): b is StrengthBlock => b.kind === undefined && !b.warmup && b.exercises.length > 0,
  );
  const ex = work?.exercises[0];
  if (!ex) return 'Strength';
  const sets = ex.sets.length;
  return sets > 0 ? `${ex.name} · ${sets} set${sets === 1 ? '' : 's'}` : ex.name;
}

function condKeyline(blocks: Block[]): string {
  const cond = blocks.find(isCondBlock);
  if (!cond) return 'Conditioning';
  const modality = cond.modality ? cond.modality.replace('_', ' ') : '';
  const fmt = String(cond.condFmt ?? '');
  const mins = cond.minutes ? `${cond.minutes}′` : '';
  return [modality, fmt, mins].filter(Boolean).join(' · ') || 'Conditioning';
}

function keylineFor(kind: 'strength' | 'conditioning', blocks: Block[]): string {
  return kind === 'conditioning' ? condKeyline(blocks) : strengthKeyline(blocks);
}

function workoutKind(w: Workout): 'strength' | 'conditioning' {
  if (w.kind) return w.kind;
  return w.blocks.some(isCondBlock) ? 'conditioning' : 'strength';
}

/** 0=Sunday weekday of an ISO date, matching Workout.days semantics. */
function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * Fill a date grid from the store. Logged sessions claim their exact date.
 * Planned workouts appear on explicit `dates` matches always, and on
 * recurring `days` matches only for today-or-future dates — a recurring slot
 * in a past week that produced no session was a miss, not a plan, and
 * painting it as planned would rewrite history.
 */
export function projectGrid(
  rows: string[][],
  workouts: Workout[],
  sessions: Session[],
  today: string,
): WeekRow[] {
  const byDate = new Map<string, CellItem[]>();
  for (const s of sessions) {
    const kind = s.kind ?? 'strength';
    const items = byDate.get(s.date) ?? [];
    items.push({
      id: s.id,
      kind,
      name: s.name || (kind === 'conditioning' ? 'Conditioning' : 'Strength'),
      keyline: keylineFor(kind, s.blocks),
      source: 'logged',
      status: s.status,
    });
    byDate.set(s.date, items);
  }

  const flat = rows.flat();
  const planned = new Map<string, CellItem[]>();
  for (const w of workouts) {
    const kind = workoutKind(w);
    const item: Omit<CellItem, 'id'> & { id: string } = {
      id: w.id,
      kind,
      name: w.name || (kind === 'conditioning' ? 'Conditioning' : 'Strength'),
      keyline: keylineFor(kind, w.blocks),
      source: 'planned',
    };
    for (const date of flat) {
      const explicit = w.dates?.includes(date) ?? false;
      const recurring = (w.days?.includes(weekdayOf(date)) ?? false) && date >= today;
      if (!explicit && !recurring) continue;
      const items = planned.get(date) ?? [];
      items.push({ ...item });
      planned.set(date, items);
    }
  }

  return rows.map((week) =>
    week.map((date) => {
      const logged = byDate.get(date) ?? [];
      // A planned workout that already has a logged session that day is the
      // same training, not a second one.
      const extra = (planned.get(date) ?? []).filter(
        (p) => !logged.some((l) => l.name === p.name && l.kind === p.kind),
      );
      return { date, items: [...logged, ...extra] };
    }),
  );
}

/**
 * Same-weekday projection: all cells for one weekday column across the grid,
 * oldest week first. A transposition of the grid, not a second model.
 */
export function sameWeekday(grid: WeekRow[], weekdayIndex: number): DayCell[] {
  return grid.map((week) => week[weekdayIndex]).filter((c): c is DayCell => c !== undefined);
}
