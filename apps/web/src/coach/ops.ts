import { tombstone, type Block, type EngineDB, type Workout } from '@hybrid/engine';

/**
 * Pure week-operation planning against the real store model.
 *
 * The store has two kinds of "planned": recurring weekday slots
 * (`Workout.days`) that project onto every future matching date by
 * themselves, and one-off dates (`Workout.dates`). Copy semantics must
 * respect that split — duplicating a week must NOT copy recurring
 * workouts, because they already appear in the target week; copying them
 * would double every session. Only one-off placements copy.
 *
 * Everything here PLANS an operation and returns a description; applying
 * it is a separate, trivial mutation. That split keeps the judgment
 * testable without a store.
 */

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Is this workout, on this date, a recurring projection or a one-off placement? */
export function occurrenceKind(w: Workout, date: string): 'oneoff' | 'recurring' | 'none' {
  if (w.dates?.includes(date)) return 'oneoff';
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (w.days?.includes(wd)) return 'recurring';
  return 'none';
}

export interface CopySpec {
  /** id of the source workout whose blocks/name/kind are cloned */
  sourceId: string;
  name: string;
  kind: 'strength' | 'conditioning' | undefined;
  /** the one target date the copy is placed on */
  date: string;
}

export interface WeekCopyPlan {
  creates: CopySpec[];
  /** recurring workouts present in the source week that were NOT copied —
   *  they project into the target week on their own */
  skippedRecurring: string[];
  /** target dates that already hold a one-off placement */
  collisions: string[];
}

/**
 * Plan copying one week's one-off placements onto one or more target
 * weeks. Dates before `today` are never targeted — the past is history.
 */
export function planWeekCopy(
  workouts: Workout[],
  srcMonday: string,
  dstMondays: string[],
  today: string,
): WeekCopyPlan {
  const src = weekDates(srcMonday);
  const creates: CopySpec[] = [];
  const skipped = new Set<string>();
  const collisions = new Set<string>();

  src.forEach((date, i) => {
    for (const w of workouts) {
      const kind = occurrenceKind(w, date);
      if (kind === 'recurring') skipped.add(w.name || w.id);
      if (kind !== 'oneoff') continue;
      for (const dstMonday of dstMondays) {
        const target = addDays(dstMonday, i);
        if (target < today) continue;
        creates.push({ sourceId: w.id, name: w.name || 'Workout', kind: w.kind, date: target });
        if (workouts.some((o) => o.dates?.includes(target))) collisions.add(target);
      }
    }
  });
  return { creates, skippedRecurring: [...skipped], collisions: [...collisions] };
}

/**
 * Apply a plan to a draft EngineDB (inside db.update). Each create is an
 * INDEPENDENT one-off workout — cloned blocks, fresh id, single date.
 * Nothing stays linked to its source; that is the explicit copy semantic
 * the research argued for and the spec adopted.
 */
export function applyWeekCopy(
  draft: EngineDB,
  plan: WeekCopyPlan,
  mkId: () => string,
  now: number,
): number {
  let made = 0;
  for (const c of plan.creates) {
    const source = draft.workouts.find((w) => w.id === c.sourceId);
    if (!source) continue;
    const blocks = JSON.parse(JSON.stringify(source.blocks)) as Block[];
    draft.workouts.push({
      id: mkId(),
      name: c.name,
      kind: c.kind,
      blocks,
      dates: [c.date],
      updatedAt: now,
    });
    made++;
  }
  return made;
}

export interface ClearPlan {
  /** one-off date placements to remove: workoutId → dates in that week */
  removals: Array<{ workoutId: string; dates: string[]; deletesWorkout: boolean }>;
  /** recurring workouts that will keep projecting — clearing can't touch them
   *  without a schema-level exclusion mechanism, which is a deferred design */
  untouchableRecurring: string[];
}

/** Plan clearing a future week: strips one-off placements only. */
export function planWeekClear(workouts: Workout[], monday: string, today: string): ClearPlan {
  const dates = weekDates(monday).filter((d) => d >= today);
  const removals: ClearPlan['removals'] = [];
  const untouchable = new Set<string>();
  for (const w of workouts) {
    const hit = (w.dates ?? []).filter((d) => dates.includes(d));
    if (hit.length) {
      const remaining = (w.dates ?? []).filter((d) => !dates.includes(d));
      removals.push({
        workoutId: w.id,
        dates: hit,
        deletesWorkout: remaining.length === 0 && !(w.days?.length),
      });
    }
    if (dates.some((d) => occurrenceKind(w, d) === 'recurring')) untouchable.add(w.name || w.id);
  }
  return { removals, untouchableRecurring: [...untouchable] };
}

export function applyWeekClear(draft: EngineDB, plan: ClearPlan, now: number): void {
  for (const r of plan.removals) {
    const w = draft.workouts.find((x) => x.id === r.workoutId);
    if (!w) continue;
    w.dates = (w.dates ?? []).filter((d) => !r.dates.includes(d));
    w.updatedAt = now;
    if (r.deletesWorkout) {
      const i = draft.workouts.findIndex((x) => x.id === r.workoutId);
      if (i >= 0) draft.workouts.splice(i, 1);
      // A tombstone, not just a local delete: without one the next sync sees a
      // workout the remote still has and cheerfully restores it. Every
      // athlete-side delete does this; the coach surface did not.
      tombstone(draft, r.workoutId, now);
    }
  }
}
