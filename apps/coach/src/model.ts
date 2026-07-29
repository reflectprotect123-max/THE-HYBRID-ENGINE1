import {
  CON_EFFORTS,
  emit,
  isCond,
  newBlock,
  newCondBlock,
  newEx,
  newSet,
  uid,
  type Block,
  type CondFmtKey,
  type EffortKey,
  type ModeKey,
  type PlannedSet,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';

/*
 * The coach's day, now the engine's own type.
 *
 * `CoachSession` is an ALIAS, not a renamed clone: it IS `Workout<PlannedSet>`.
 * That is what makes `store.tsx` and `cloud.tsx` need no changes at all —
 * they only ever reference this name as a type annotation, never construct or
 * destructure an assumption about a shape the engine doesn't have.
 *
 * Only the programme scaffolding below is genuinely coach-only: the engine
 * has no concept of a programme, a week, or a day slot. Everything about what
 * a SESSION is now comes from the engine, which is the whole point — anything
 * the athlete app can express, the builder can now express too.
 */
export type CoachSession = Workout<PlannedSet>;

export interface CoachWeek {
  days: (CoachSession | null)[];
}

export interface CoachProgram {
  id: string;
  name: string;
  weeks: CoachWeek[];
}

export interface CoachLib {
  programs: CoachProgram[];
  sel: { p: number; w: number; d: number };
}

export const COACH_LS_KEY = 'hybrid-coach-v1';

export const LIBRARY = [
  'Back Squat', 'Front Squat', 'Romanian Deadlift', 'Conventional Deadlift', 'Barbell Hip Thrust',
  'DB Bench Press', 'Barbell Bench Press', 'Incline DB Press', 'Chest-Supported Row', 'Barbell Row',
  'Weighted Pull-up', 'Overhead Press', 'Walking Lunge', 'Bulgarian Split Squat', 'Farmer Carry', 'Plank',
];

/** A fresh, id-bearing session with one starter block — engine-shaped from the start. */
export function newSession(title = 'Session'): CoachSession {
  return { id: uid(), name: title, blocks: [newBlock()], updatedAt: Date.now() };
}

export function emptyWeek(): CoachWeek {
  return { days: [null, null, null, null, null, null, null] };
}

export function emptyLib(): CoachLib {
  return {
    programs: [{ id: uid(), name: 'Programme 1', weeks: [emptyWeek()] }],
    sel: { p: 0, w: 0, d: 0 },
  };
}

/* ---------- reading what is already on disk ----------
   A working coach has a library in localStorage under the SAME key. Its day
   objects are the OLD blocks-based CoachSession shape — h/mins/ss/ex, sets of
   {t, rpe} with no mode or tempo. Converting them is best-effort and lossy BY
   PERMISSION: there is no real coach programme data to preserve (confirmed
   with the owner), so the rule is convert what parses, drop what does not,
   never throw. The far older pre-blocks format (flat exercises, spreadsheet
   columns) is not read forward at all any more — reconstructing it cost real
   complexity for data that, by the same permission, is not worth it. */

const s0 = (v: unknown, dflt = '') => (typeof v === 'string' ? v : dflt);

/**
 * A set target read back off disk. `t`/`rpe` are contractually strings, but a
 * stored library does not have to agree — the vanilla builder coerced with
 * String(), so a numeric path could write `{t: 5, rpe: 8}`. Treating a
 * non-string as blank would silently empty every set in the programme.
 */
const sVal = (v: unknown): string =>
  typeof v === 'string' ? v
  : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '')
  : typeof v === 'boolean' ? String(v)
  : '';

/**
 * Which mode a migrated exercise gets, since the old shape never authored one.
 *
 * Only used here, at migration time, for exactly that reason: a FRESH
 * exercise is authored with an explicit mode from the moment it exists
 * (defaulting to reps_kg via the engine's own `newEx`), so this heuristic —
 * the same one `toAthleteEx` used to run on every publish — only has
 * migrated data left to apply to.
 *
 * The `> 30` test is what separates a duration from a rep count: nobody
 * writes a bare "45" meaning forty-five reps, and nobody holds a plank for
 * eight seconds. `max` wins over it either way, since an AMRAP is about the
 * count regardless of how long it takes.
 */
function inferMode(sets: { t?: unknown }[]): ModeKey {
  const allSecs = sets.length > 0 && sets.every((st) => /^\s*\d+\s*$/.test(String(st.t)) && parseInt(String(st.t), 10) > 30);
  const anyMax = sets.some((st) => /^\s*max\s*$/i.test(String(st.t)));
  return anyMax ? 'amrap' : allSecs ? 'seconds' : 'reps_kg';
}

interface OldEx {
  id?: string;
  name?: string;
  rest?: unknown;
  cue?: unknown;
  sets?: { t?: unknown; rpe?: unknown }[];
}

interface OldBlock {
  kind?: string;
  h?: unknown;
  mins?: unknown;
  ss?: unknown;
  ex?: OldEx[];
  fmt?: unknown;
  eff?: unknown;
}

/** One migrated strength block — h/mins/ss/ex → heading/minutes/superset/exercises. */
function migrateBlock(b: OldBlock): Block<PlannedSet> {
  if (b.kind === 'cond') {
    const fmt = b.fmt as CondFmtKey;
    const eff = (b.eff as EffortKey) in CON_EFFORTS ? (b.eff as EffortKey) : 'medium';
    const cb = newCondBlock();
    cb.heading = s0(b.h, 'Finisher');
    cb.condFmt = fmt;
    cb.effort = eff;
    cb.targetZone = CON_EFFORTS[eff].zone;
    return cb;
  }

  const exercises = (Array.isArray(b.ex) ? b.ex : [])
    .filter((e): e is OldEx => !!e && typeof e === 'object')
    .map((e) => {
      // A plain literal, not the imported `newSet` — the engine's top-level
      // `newSet` is session.ts's ZERO-ARGUMENT version (always blank); the one
      // that takes {t, rpe} only exists as `emit.newSet`. Calling the wrong
      // one here silently discarded every migrated set's actual values.
      const sets: PlannedSet[] = (Array.isArray(e.sets) ? e.sets : []).map((st) => ({ t: sVal(st?.t), rpe: sVal(st?.rpe) }));
      const r = parseInt(String(e.rest), 10);
      const ex = newEx();
      ex.name = s0(e.name);
      ex.mode = inferMode(sets);
      ex.sets = sets.length ? sets : [newSet()];
      ex.rest = Number.isFinite(r) && r >= 0 ? Math.min(r, 3600) : 90;
      if (s0(e.cue)) ex.cue = s0(e.cue);
      return ex;
    });

  const sb: StrengthBlock<PlannedSet> = newBlock();
  sb.heading = s0(b.h, 'Main');
  sb.minutes = s0(b.mins);
  sb.superset = !!b.ss;
  sb.exercises = exercises.length ? exercises : [newEx()];
  return sb;
}

/** One migrated day. Anything that doesn't even look like a session is dropped. */
function migrateDay(raw: unknown): CoachSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { title?: unknown; name?: unknown; note?: unknown; blocks?: unknown };
  const blocks = (Array.isArray(r.blocks) ? r.blocks : [])
    .filter((b): b is OldBlock => !!b && typeof b === 'object')
    .map(migrateBlock)
    .filter((b) => isCond(b) || (b as StrengthBlock).exercises.length);
  if (!blocks.length) return null;

  return {
    id: uid(),
    name: s0(r.name ?? r.title, 'Session'),
    note: s0(r.note),
    blocks,
    updatedAt: Date.now(),
  };
}

/** Read a whole stored library forward, clamping the selection to what exists. */
export function migrateLib(raw: unknown): CoachLib {
  const lib = raw as CoachLib | null;
  if (!lib || typeof lib !== 'object' || !Array.isArray(lib.programs) || !lib.programs.length) return emptyLib();

  const programs = lib.programs
    .filter((p): p is CoachProgram => !!p && typeof p === 'object')
    .map((p) => ({
      id: p.id || uid(),
      name: s0(p.name, 'Programme'),
      weeks: (Array.isArray(p.weeks) && p.weeks.length ? p.weeks : [emptyWeek()]).map((w) => ({
        days: (Array.isArray(w?.days) ? w.days : [])
          .concat([null, null, null, null, null, null, null])
          .slice(0, 7)
          .map(migrateDay),
      })),
    }));
  if (!programs.length) return emptyLib();

  const sel = lib.sel && typeof lib.sel === 'object' ? lib.sel : { p: 0, w: 0, d: 0 };
  const p = Math.max(0, Math.min(programs.length - 1, sel.p | 0));
  return {
    programs,
    sel: {
      p,
      w: Math.max(0, Math.min(programs[p].weeks.length - 1, sel.w | 0)),
      d: Math.max(0, Math.min(6, sel.d | 0)),
    },
  };
}

/**
 * Rest, for the coach's own display. NOT a duplicate of the engine's own
 * `fmtRest` in `num.ts` — that one always renders "M:SS", including "0:00"
 * for no rest. This one says "none", because on an authoring surface "no
 * rest set yet" and "a zero-second rest" read as the same blank M:SS
 * otherwise, and only the coach is choosing between those two states.
 */
export function fmtRest(sec: number): string {
  return sec ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : 'none';
}

/**
 * Publish-time validation, so a bad session fails here and not on a phone.
 *
 * `sess` is already workout-shaped, so there is no translation left to do —
 * this is now the emit contract and nothing else. The empty-blocks fallback
 * is defensive: the UI unmounts the editor once a day's blocks hit zero (see
 * Editor.tsx's `requestRemove`), so this should not be reachable in practice.
 */
export function assertPublishable(sess: CoachSession): Workout<PlannedSet> {
  const blocks = sess.blocks.length ? sess.blocks : [newBlock()];
  return emit.assertWorkout({ ...sess, blocks });
}
