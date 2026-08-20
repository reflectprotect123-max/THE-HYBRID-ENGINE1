import { CON_EFFORTS } from './constants';
import { condEffort, condEffortGap } from './conditioning';
import { uid } from './num';
import type {
  AnySet,
  Block,
  CondBlock,
  EngineDB,
  LoggedSet,
  Session,
  Workout,
  TextBlock,
} from './types';
/*
 * `isWarmupBlock`/`blockExercises`/`newWarmupBlock`/`newSet`/`newEx`/
 * `newBlock`/`isLiftMode`/`fillLinkedSets`/`duplicateExercise`/`rxLine` were
 * deleted whole on 17 August 2026 (fire-sale rebuild) — they existed only to
 * type and build the old in-repo strength shape. `isStrength` and the
 * `StrengthBlock` union member followed on 21 August 2026 with Task 2 of the
 * repo split: strength MOVED to reflectprotect123-max/strengthside, and
 * `Block` is back to `CondBlock | TextBlock`. Nothing in this file types,
 * builds or guards a strength shape any more.
 */

export function isCond(b: Block | null | undefined): b is CondBlock {
  return !!b && (b as CondBlock).kind === 'conditioning';
}

export function isText(b: Block | null | undefined): b is TextBlock {
  return !!b && (b as TextBlock).kind === 'text';
}

export function newTextBlock(): TextBlock {
  return { id: uid(), kind: 'text', heading: 'Metcon', body: '' };
}

/**
 * The name a duplicate takes: "Push Day" → "Push Day copy" → "Push Day copy 2"
 * → "Push Day copy 3".
 *
 * The suffix exists for ONE reason — otherwise two identically-named cards are
 * indistinguishable in the Library list until expanded — and plain concatenation
 * failed at exactly that job twice. Duplicating a duplicate grew "Push Day copy
 * copy", and then "copy copy copy", unboundedly: a suffix that stops being read
 * as a suffix. And duplicating the SAME session twice produced two cards both
 * called "Push Day copy", which is the very ambiguity the suffix was added to
 * remove.
 *
 * So the tail is parsed rather than appended to. A name already ending in
 * "copy" or "copy N" keeps its base and takes the next number, and `taken` —
 * the names already in the library — pushes the number along until it lands on
 * one nobody is using. Matching is case-insensitive because "Copy" typed by
 * hand is the same suffix to a reader; the emitted form is always lowercase.
 */
function copyNameFor(raw: unknown, taken: string[]): string {
  const src = String(raw == null ? '' : raw).trim() || 'Session';
  const m = /^(.*?)\s+copy(?:\s+(\d+))?$/i.exec(src);
  // `m[1]` empty means the whole name IS "copy" — a real name, not a suffix.
  const base = m && m[1].trim() ? m[1].trim() : src;
  const label = (i: number) => (i > 1 ? `${base} copy ${i}` : `${base} copy`);
  const used = new Set(taken.map((t) => String(t == null ? '' : t).trim().toLowerCase()));
  let n = m && m[1].trim() ? Math.max(1, parseInt(m[2] || '1', 10)) + 1 : 1;
  // Bounded by `taken`: each step rules out one existing name.
  while (used.has(label(n).toLowerCase())) n++;
  return label(n);
}

/**
 * Clone a Workout as a new, independent, unscheduled record.
 *
 * Every level that carries an id gets a fresh one — the workout itself,
 * each block, each exercise — mirroring duplicateExercise's own reasoning:
 * a shared id would let an edit to the copy reach back into the original
 * (directly, or via a sync-layer merge keyed on that id). Sets are copied
 * by value for the same reason.
 *
 * `days`/`dates` are cleared, not copied: inheriting the original's
 * scheduled slot would silently double-book that weekday until the
 * athlete manually reassigns it. `_rev` is sync bookkeeping specific to
 * the original record. `updatedAt` is refreshed like any new record.
 *
 * `folderIds`, by contrast, IS inherited — deliberately, not an oversight.
 * A folder is organisational metadata about the workout ("this belongs under
 * Week 1"), not a scheduling or session-identity fact the way `days`/`dates`/
 * `sample`/`_rev` are, and a duplicate made from something filed in "Week 1"
 * is itself a Week 1 workout until the athlete says otherwise.
 *
 * `existingNames` is optional and only feeds the name (see `copyNameFor`):
 * without it the copy is still never "X copy copy", it just cannot know that
 * "X copy" is already sitting in the library. Callers that HAVE the list — both
 * Library screens do, one line away — should pass it, and get a name that is
 * unique in the list they are about to push onto.
 */
export function duplicateWorkout<S extends AnySet>(
  w: Workout<S>,
  existingNames: string[] = [],
): Workout<S> {
  const blocks: Block<S>[] = w.blocks.map((b) => {
    if (b.kind === 'text') return { ...b, id: uid(), done: false };
    // The strength branch (deep copy of items/sets with fresh ids) MOVED to
    // reflectprotect123-max/strengthside on 21 August 2026 with the rest of
    // strength — `Block` no longer has a strength member to copy.
    return { ...b, id: uid(), condResult: undefined };
  });
  return {
    ...w,
    id: uid(),
    name: copyNameFor(w.name, existingNames),
    blocks,
    days: undefined,
    dates: undefined,
    updatedAt: Date.now(),
    _rev: undefined,
    sample: undefined,
  };
}

/**
 * A conditioning block runs by live heart rate instead of set by set, so it has
 * no exercises; `kind: 'conditioning'` is what tells every path to treat it
 * that way. `effort` is what you author, `targetZone` is kept in lockstep so
 * the live engine and every older read path need no changes.
 */
export function newCondBlock(): CondBlock {
  return {
    id: uid(),
    kind: 'conditioning',
    heading: 'Conditioning',
    condFmt: 'intervals',
    effort: 'medium',
    targetZone: 'mod',
    minutes: '',
  };
}

/**
 * How long the athlete spent in each block, in SECONDS, keyed by block id.
 *
 * Built from `Session.blockLog` — see its own doc for why this is a list of
 * wall-clock stamps rather than a stopwatch. Each entry opens a segment that
 * runs until the next entry, and the last one runs until `completedAt`. A
 * block entered more than once has its segments SUMMED, which is the case a
 * single "first entered at" stamp could not describe.
 *
 * A session still running has no `completedAt`, so `now` stands in — the
 * caller passes it, because this file decides nothing from a clock it read
 * itself. Absent `now` on a live session simply leaves the last block out
 * rather than inventing a duration for it.
 *

 * An ABANDONED session is the one honest wrinkle: `expireStaleSessions` gives
 * it `completedAt = startedAt`, so its last segment stops before it started
 * and clamps to zero. There is no true end time for a session nobody finished,
 * so any answer there is a guess; zero is the quietest one.
 *
 * Blocks the athlete never opened are ABSENT rather than zero. Zero would say
 * "they were there and it took no time"; absent says "they were never there",
 * and only one of those is true of a session that ended early.
 */
export function blockDurations(s: Session, now?: number): Record<string, number> {
  /* Not `?? []`: a session blob is a trust boundary, and a non-array here —
     a backup restore, a hand-edited blob, a bad merge — would throw on
     `forEach` and take the whole recap down. Same guard `sanitizeDB` puts on
     `folders` and `conditioning`, for the same reason. */
  const log = Array.isArray(s.blockLog) ? s.blockLog : [];
  const out: Record<string, number> = {};
  const end = s.completedAt ?? now;
  log.forEach((entry, i) => {
    if (!entry || typeof entry.at !== 'number' || !entry.id) return;
    const stop = i + 1 < log.length ? log[i + 1]?.at : end;
    if (typeof stop !== 'number') return;
    // A clock that went backwards — a device time change mid-session — is not
    // negative training time. Clamp rather than subtract from the total.
    const seconds = Math.max(0, Math.round((stop - entry.at) / 1000));
    out[entry.id] = (out[entry.id] ?? 0) + seconds;
  });
  return out;
}

/**
 * The whole session, in seconds, from the two stamps that have always been
 * there. Zero when either is missing, which is every session that never
 * finished.
 */
export function sessionDuration(s: Session): number {
  if (!s.completedAt || !s.startedAt) return 0;
  return Math.max(0, Math.round((s.completedAt - s.startedAt) / 1000));
}

/**
 * Mean target RPE and mean felt RPE for a session.
 *
 * A conditioning block's banked felt RPE (`condResult.felt`) is on the same
 * 1-10 slider a strength set's `felt` used to be, so it goes in the felt
 * average. `target` is deliberately left alone for a conditioning block: the
 * only candidate, `condResult.targetRpe`, is a coach-authored BAND CENTER
 * (e.g. "Hard" = RPE 8-9.5, center 8.5), not a single number aimed at —
 * folding it in would conflate two different kinds of number.
 */
export function sessionRpe(s: Session): { target: number | null; felt: number | null } {
  const f: number[] = [];
  s.blocks.forEach((b) => {
    if (!isCond(b)) return;
    const ff = parseFloat(String(b.condResult?.felt));
    if (Number.isFinite(ff)) f.push(ff);
  });
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { target: null, felt: avg(f) };
}

/**
 * How many pieces of logged work a session carries — a finished conditioning
 * block. This is the quantity `pickSession` compares first, so a session
 * with any logged work always outranks an emptier one regardless of
 * timestamps.
 */
export function loggedWorkCount(s: Session): number {
  let n = 0;
  (s.blocks || []).forEach((b) => {
    if (b && (b as CondBlock).condResult) n += 1;
  });
  return n;
}

export function hasLoggedWork(s: Session | null | undefined): boolean {
  return (
    !!s &&
    s.blocks.some(
      (b) =>
        (isCond(b) && !!b.condResult) ||
        // A ticked metcon is training that happened. Without this the day reads
        // as untrained and expireStaleSessions bins it.
        (isText(b) && !!b.done),
    )
  );
  /* Strength blocks are no longer representable here at all — the union lost
     its strength member on 21 August 2026 when strength MOVED to
     reflectprotect123-max/strengthside. The Phase A/Phase C accounting
     semantics that used to be pinned in this file (prescription-only blocks
     count for existence, never for logged work) moved with it — see that
     repo's docs/superpowers/specs/2026-08-17-strength-rebuild-design.md. */
}

/* `hasStrengthPrescription` MOVED to reflectprotect123-max/strengthside on
   21 August 2026 with the rest of strength — its one job was protecting
   strength-day EXISTENCE in `expireStaleSessions`, and there are no strength
   days in this repo's products to protect any more. */

/*
 * `exLogFor`/`exBest`/`detectPRs`/`bestE1rmByLift` were deleted whole on
 * 17 August 2026 — every one of them existed to derive an e1RM/PR from
 * logged strength sets, and there is no more strength data to derive one
 * from. `ExerciseHistoryEntry`/`PrRecord` stay in types.ts (harmless,
 * unused) rather than being chased out of every import list they touch.
 */

/**
 * Average felt-minus-target RPE across the most recent session that has any
 * rated work, within the last week. Conditioning counts: its authored effort
 * carries an RPE target and is rated on the same slider, so the gap means the
 * same thing.
 */
export function rpeGapInfo(
  sessions: Session[],
  now = Date.now(),
): { gap: number; date: string; n: number } | null {
  const done = sessions
    .filter(
      (s) =>
        (s.status === 'completed' || s.status === 'incomplete') &&
        s.completedAt &&
        now - (s.completedAt as number) < 7 * 864e5,
    )
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  for (const s of done) {
    const gaps: number[] = [];
    s.blocks.forEach((b) => {
      if (!isCond(b) || !b.condResult) return;
      // condEffort() is the ONLY safe resolver: it hasOwnProperty-guards the
      // CON_EFFORTS lookup. A direct `CON_EFFORTS[effort]` short-circuit here
      // resolved a prototype-named effort ("constructor") to Object's own
      // constructor (truthy, no `.rpe`), which then threw in condEffortGap and
      // white-screened Home. condEffort handles effort→zone→medium identically
      // for every valid input, so this is a pure hardening. (E9.)
      const eff = condEffort(b.condResult);
      const g = condEffortGap(eff, b.condResult.felt);
      if (g != null && b.condResult.targetRpe != null) gaps.push(g);
    });
    if (gaps.length) return { gap: gaps.reduce((a, b) => a + b, 0) / gaps.length, date: s.date, n: gaps.length };
  }
  return null;
}

/**
 * Deep-clone a workout's blocks into a pristine session shape: conditioning
 * blocks reset with no result. Text blocks reset ticked-off. (The strength
 * branch — deep copy of items/sets with fresh ids — MOVED to
 * reflectprotect123-max/strengthside on 21 August 2026 with the rest of
 * strength.)
 */
export function freshSessionBlocks(blocks: Block<AnySet>[]): Block<LoggedSet>[] {
  return (blocks || []).map((b) => {
    if (isCond(b)) {
      const { condResult: _drop, ...rest } = b;
      return { ...rest, id: uid() } as CondBlock;
    }
    return { ...(b as TextBlock), id: uid(), done: false };
  });
}

/* `bestE1rmByLift` was deleted whole on 17 August 2026 with the rest of
   strength — there is no more e1RM to derive. */

/** Whether this workout is a conditioning-kind workout — a stored field
 *  (`Workout.kind`), not scanned from block contents. A workout that has never
 *  had a block authored on it carries no `kind` at all (sanitizeDB refuses to
 *  guess one), which reads as false here — the same answer the block scan used
 *  to give an empty workout, and Home/Library both handle "no blocks yet"
 *  separately anyway. */
export function isCondWorkout(w: Workout): boolean {
  return w.kind === 'conditioning';
}

/** Narrows an EngineDB to one product's own workouts and sessions. A workout or
 *  session with no `kind` set is not conditioning (matches `isCondWorkout`'s
 *  existing default), so it stays on the strength side. `settings`, `core`,
 *  and `ecosystem` are shared across both products and pass through
 *  unchanged — see docs/superpowers/specs/2026-08-05-mobile-sync-product-partition-design.md.
 *
 *  This is safe ONLY for narrowing what a build keeps in on-device storage
 *  AFTER an unfiltered pull/merge has already completed and been pushed. Do
 *  NOT filter a push payload with this, and do NOT filter either operand
 *  going into `applyPull`/`mergeEngines` — a record that exists only on one
 *  side (a locally-authored wrong-kind record never synced, or a legacy
 *  un-split mixed-kind remote record) is invisible to the other side and
 *  would be silently dropped by the merge itself, not merely left out of
 *  this device's local view. This was a real data-loss bug (both a
 *  never-synced local record and a legacy mixed remote record's other-kind
 *  sibling were permanently lost this way), not a hypothetical — see
 *  apps/mobile/src/cloud/sync.tsx's `reconcile` for the correct ordering. */
export function restrictToProduct(db: EngineDB, domain: 'strength' | 'conditioning'): EngineDB {
  const conditioning = domain === 'conditioning';
  return {
    ...db,
    workouts: db.workouts.filter((w) => isCondWorkout(w) === conditioning),
    sessions: db.sessions.filter((s) => (s.kind === 'conditioning') === conditioning),
  };
}

/**
 * How often a library session has actually been trained, and when last.
 *
 * `hasLoggedWork` rather than `status === 'completed'` on purpose: a session
 * started by mistake and finished with nothing on it is not a session you
 * trained, and counting it would make the Library claim a history the athlete
 * knows they do not have.
 */
export function workoutStats(
  w: Workout | null | undefined,
  sessions: Session[] = [],
): { lastDate: string | null; lastAt: number; count: number } {
  if (!w || !w.id) return { lastDate: null, lastAt: 0, count: 0 };
  let lastDate: string | null = null;
  let lastAt = 0;
  let count = 0;

  sessions.forEach((s) => {
    if (!s || s.workoutId !== w.id || s.status === 'active') return;
    if (!hasLoggedWork(s)) return;
    count += 1;
    const at = s.completedAt || 0;
    if (at >= lastAt) {
      lastAt = at;
      lastDate = s.date || lastDate;
    }
  });

  return { lastDate, lastAt, count };
}

/* `knownMovements` was deleted whole on 17 August 2026 — it catalogued
   strength movement names, and there are no more strength exercises to
   catalogue. */
