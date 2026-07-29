import {
  CON_EFFORTS,
  emit,
  isWarmup,
  uid,
  type CondFmtKey,
  type EffortKey,
  type PlannedSet,
  type Workout,
} from '@hybrid/engine';

/*
 * The coach's own model.
 *
 * It mirrors the athlete's structure closely on purpose: a block holds
 * exercises, an exercise holds sets of {t, rpe}. `sessionToWorkout` is then
 * almost an identity function rather than a translation layer — and a
 * translation layer is exactly where "the coach wrote it but the athlete never
 * got it" bugs live.
 *
 * Field names are short (`h`, `ex`, `ss`) because this shape is also what gets
 * serialised into the coach library blob, and it predates the migration.
 */

export interface CoachSet {
  t: string;
  rpe: string;
}

export interface CoachEx {
  id: string;
  name: string;
  sets: CoachSet[];
  /** seconds */
  rest: number;
  /** free text — also where a prescribed LOAD goes, see below */
  cue: string;
}

export interface CoachBlock {
  kind?: undefined;
  h: string;
  mins: string;
  ss: boolean;
  ex: CoachEx[];
}

export interface CoachCond {
  kind: 'cond';
  h: string;
  fmt: CondFmtKey;
  eff: EffortKey;
}

export type AnyBlock = CoachBlock | CoachCond;

export interface CoachSession {
  title: string;
  note: string;
  blocks: AnyBlock[];
}

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

export const COND_FORMATS: [CondFmtKey, string][] = [
  ['steady', 'Steady'],
  ['intervals', 'Intervals'],
  ['tempo', 'Tempo'],
  ['free', 'Free run'],
];

export const EFFORTS: [EffortKey, string, string][] = [
  ['easy', 'Easy', 'RPE 3-4'],
  ['medium', 'Medium', 'RPE 5-7'],
  ['hard', 'Hard', 'RPE 8-9.5'],
];

export const LIBRARY = [
  'Back Squat', 'Front Squat', 'Romanian Deadlift', 'Conventional Deadlift', 'Barbell Hip Thrust',
  'DB Bench Press', 'Barbell Bench Press', 'Incline DB Press', 'Chest-Supported Row', 'Barbell Row',
  'Weighted Pull-up', 'Overhead Press', 'Walking Lunge', 'Bulgarian Split Squat', 'Farmer Carry', 'Plank',
];

export const newSet = (t = '', rpe = ''): CoachSet => ({ t, rpe });

export const newEx = (name = ''): CoachEx => ({
  id: uid(),
  name,
  sets: [newSet(), newSet(), newSet()],
  rest: 90,
  cue: '',
});

export const newBlock = (h = 'Main', ex: CoachEx[] = [newEx()], ss = false, mins = ''): CoachBlock => ({
  h,
  mins,
  ss,
  ex,
});

/**
 * Insert a copy of one exercise right after itself, with a fresh id.
 *
 * A scoped-down twin of the engine's own `duplicateExercise`: the same rule
 * (fresh id, sets copied by value, never by reference), applied to `CoachEx`
 * because that shape has no `ssNext` to worry about rerouting — the coach's
 * only superset control is still the block-level `ss` flag. Once the coach
 * authors engine types directly, this function is retired in favour of the
 * shared one.
 */
export function duplicateCoachEx(exercises: CoachEx[], ei: number): CoachEx[] {
  const ex = exercises[ei];
  if (!ex) return exercises;
  const out = exercises.slice();
  const copy: CoachEx = { ...ex, id: uid(), sets: ex.sets.map((s) => ({ ...s })) };
  out.splice(ei + 1, 0, copy);
  return out;
}

export const newCond = (h = 'Finisher', fmt: CondFmtKey = 'intervals', eff: EffortKey = 'medium'): CoachCond => ({
  kind: 'cond',
  h,
  fmt,
  eff,
});

export const newSession = (title = 'Session'): CoachSession => ({
  title,
  note: '',
  blocks: [newBlock()],
});

export const emptyWeek = (): CoachWeek => ({ days: [null, null, null, null, null, null, null] });

export function emptyLib(): CoachLib {
  return {
    programs: [{ id: uid(), name: 'Programme 1', weeks: [emptyWeek()] }],
    sel: { p: 0, w: 0, d: 0 },
  };
}

export const isCond = (b: AnyBlock): b is CoachCond => (b as CoachCond).kind === 'cond';

/* ---------- reading what is already on disk ----------
   A working coach has a library in localStorage under the SAME key, written by
   the vanilla builder. Some of it predates the blocks model entirely — a flat
   `exercises` array with spreadsheet-style `cols`/`sets` rows. Dropping that on
   the floor would mean the migration silently ate someone's programme, so it is
   read forward here rather than assumed away. */

const s0 = (v: unknown, dflt = '') => (typeof v === 'string' ? v : dflt);

/**
 * A set target read back off disk.
 *
 * `t` and `rpe` are contractually strings, but a stored library does not have to
 * agree: the vanilla builder's setM() coerced with String(), so anything it
 * wrote through a numeric path — and anything hand-written or imported — can
 * carry `{t: 5, rpe: 8}`. Treating those as "not a string, therefore blank"
 * silently empties every set in the programme, which is the one outcome the
 * migration exists to prevent. Objects and arrays still become '' — they are
 * junk, not a target.
 */
const sVal = (v: unknown): string =>
  typeof v === 'string' ? v
  : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '')
  : typeof v === 'boolean' ? String(v)
  : '';

/** Old measure columns that carried a unit, so a load keeps its unit in the cue. */
const OLD_UNITS: Record<string, string> = {
  'Weight (kg)': 'kg',
  'Weight (lb)': 'lb',
  'Weight (% 1RM)': '%',
};

function secondsFrom(v: unknown): string {
  const raw = String(v || '');
  if (!raw.includes(':')) {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? '' : String(n);
  }
  const q = raw.split(':');
  return String((parseInt(q[0], 10) || 0) * 60 + (parseInt(q[1], 10) || 0));
}

interface OldEx {
  name?: string;
  cues?: string;
  cols?: string[];
  sets?: unknown[][];
  link?: boolean;
}

/**
 * One pre-blocks exercise → the current shape.
 *
 * A prescribed LOAD has no field of its own in the athlete's model (a set is
 * exactly {t, rpe}), so any weight column is folded into the cue as words. That
 * is the same route a coach uses to prescribe a load today, so the athlete
 * reads it in exactly the same place.
 */
function migrateExercise(e: OldEx): CoachEx {
  const cols = Array.isArray(e.cols) ? e.cols : [];
  const rows = Array.isArray(e.sets) ? e.sets : [];
  const repsI = cols.indexOf('Reps');
  const timeI = cols.indexOf('Time (min:sec)');
  const rpeI = cols.indexOf('RPE');
  let wI = -1;
  cols.forEach((c, i) => {
    if (wI < 0 && String(c).startsWith('Weight')) wI = i;
  });

  let sets = rows.map((row) => {
    const r = Array.isArray(row) ? row : [];
    const t = repsI >= 0 ? r[repsI] : timeI >= 0 ? secondsFrom(r[timeI]) : '';
    return newSet(String(t ?? ''), rpeI >= 0 ? String(r[rpeI] ?? '') : '');
  });
  if (!sets.length) sets = [newSet()];

  let cue = s0(e.cues);
  if (wI >= 0) {
    const loads = rows
      .map((r) => (Array.isArray(r) ? String(r[wI] ?? '') : ''))
      .filter((v) => v && v !== '—');
    if (loads.length) {
      const uniqL = Array.from(new Set(loads));
      const unit = OLD_UNITS[cols[wI]] || '';
      cue = (cue ? cue + '\n' : '') + 'Prescribed load: ' + (uniqL.length === 1 ? uniqL[0] : loads.join(' / ')) + unit;
    }
  }

  return { id: uid(), name: s0(e.name), sets, rest: 90, cue };
}

/** A pre-blocks session: consecutive `link`ed exercises become one superset. */
function migrateSession(raw: unknown): CoachSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as CoachSession & { exercises?: OldEx[]; section?: string };
  if (Array.isArray(s.blocks)) return s;
  if (!Array.isArray(s.exercises)) return null;

  const blocks: AnyBlock[] = [];
  let run: OldEx[] = [];
  const head = s0(s.section, 'Main');
  const flush = () => {
    if (run.length) {
      blocks.push(newBlock(head, run.map(migrateExercise), run.length > 1));
      run = [];
    }
  };
  s.exercises.forEach((e, i) => {
    if (i > 0 && !e.link) flush();
    run.push(e);
  });
  flush();
  if (!blocks.length) return null;
  return { title: s0(s.title, 'Session'), note: s0(s.note), blocks };
}

/** Coerce one session into a safe shape. Anything unusable becomes a rest day. */
export function sanitizeSession(raw: unknown): CoachSession | null {
  const sess = migrateSession(raw);
  if (!sess) return null;
  sess.title = s0(sess.title, 'Session');
  sess.note = s0(sess.note);
  sess.blocks = (Array.isArray(sess.blocks) ? sess.blocks : [])
    .map((b0): AnyBlock => {
      // Read the stored block through an index signature, not the union: the
      // whole point is that this data may not match the shape, and narrowing on
      // a claim it makes about itself would skip the validation.
      const b = (b0 && typeof b0 === 'object' ? b0 : {}) as Record<string, unknown>;
      if (b.kind === 'cond') {
        const fmt = b.fmt as CondFmtKey;
        const eff = b.eff as EffortKey;
        return {
          kind: 'cond',
          h: s0(b.h, 'Finisher'),
          fmt: COND_FORMATS.some((f) => f[0] === fmt) ? fmt : 'intervals',
          eff: EFFORTS.some((f) => f[0] === eff) ? eff : 'medium',
        };
      }
      return {
        h: s0(b.h, 'Main'),
        mins: s0(b.mins),
        ss: !!b.ss,
        ex: (Array.isArray(b.ex) ? (b.ex as CoachEx[]) : [])
          .filter((e): e is CoachEx => !!e && typeof e === 'object')
          .map((e) => {
            const r = parseInt(String(e.rest), 10);
            const sets = (Array.isArray(e.sets) ? e.sets : []).map((st) =>
              newSet(sVal((st as CoachSet)?.t), sVal((st as CoachSet)?.rpe)),
            );
            return {
              id: e.id || uid(),
              name: s0(e.name),
              cue: s0(e.cue),
              rest: Number.isFinite(r) && r >= 0 ? Math.min(r, 3600) : 90,
              sets: sets.length ? sets : [newSet()],
            };
          }),
      };
    })
    .filter((b) => isCond(b) || b.ex.length);
  return sess.blocks.length ? sess : null;
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
          .map(sanitizeSession),
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

/** The letter shown on each card. A superset block shares one letter: A1, A2. */
export function letters(s: CoachSession): Record<string, string> {
  const out: Record<string, string> = {};
  let li = 0;
  s.blocks.forEach((b, bi) => {
    if (isCond(b)) return;
    if (b.ss) {
      const L = String.fromCharCode(65 + li++);
      b.ex.forEach((_, ei) => {
        out[bi + '-' + ei] = L + (ei + 1);
      });
    } else {
      b.ex.forEach((_, ei) => {
        out[bi + '-' + ei] = String.fromCharCode(65 + li++);
      });
    }
  });
  return out;
}

export function fmtRest(sec: number): string {
  return sec ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : 'none';
}

/** The one-line summary under a collapsed card. */
export function summary(e: CoachEx): string {
  const work = e.sets.filter((st) => !isWarmup(st));
  const warm = e.sets.length - work.length;
  const ts = work.map((st) => st.t || '—');
  const uniqT = Array.from(new Set(ts));
  const reps = uniqT.length === 1 ? uniqT[0] : ts.join('/');
  const rpes = work.map((st) => String(st.rpe)).filter(Boolean);
  const uniqR = Array.from(new Set(rpes));
  const rpe = rpes.length ? ' @ RPE ' + (uniqR.length === 1 ? uniqR[0] : rpes[0] + '→' + rpes[rpes.length - 1]) : '';
  return (
    (warm ? warm + ' warm-up · ' : '') +
    (work.length ? work.length + ' × ' + reps + rpe : 'no working sets') +
    ' · rest ' + fmtRest(e.rest)
  );
}

export const effLabel = (k: EffortKey) => (EFFORTS.find((x) => x[0] === k) || EFFORTS[1])[1];
export const effBand = (k: EffortKey) => (EFFORTS.find((x) => x[0] === k) || EFFORTS[1])[2];
export const fmtLabel = (k: CondFmtKey) => (COND_FORMATS.find((x) => x[0] === k) || COND_FORMATS[1])[1];
export const condSummary = (b: CoachCond) =>
  `${effLabel(b.eff)} · ${effBand(b.eff)} · ${CON_EFFORTS[b.eff].cue} · runs by heart rate`;

/**
 * Coach model → athlete workout.
 *
 * Everything goes through @hybrid/engine's emit contract, which validates the
 * enums and throws if any set carries a logger-owned field. That check is the
 * only thing standing between a publish and an athlete's logged work being
 * overwritten by a plan.
 */
export function sessionToWorkout(sess: CoachSession): Workout<PlannedSet> {
  const blocks = (sess.blocks || []).map((b) => {
    if (isCond(b)) return emit.newCondBlock(b.h, b.fmt, b.eff, '');
    return emit.newBlock(b.h, b.ex.map(toAthleteEx), b.ss, { minutes: b.mins, format: b.ss ? 'Superset' : '' });
  });
  if (!blocks.length) blocks.push(emit.newBlock('Main', [emit.newEx('', 'reps', [emit.newSet()])], false));
  return emit.newWorkout(sess.title, blocks, sess.note ? { note: sess.note } : undefined);
}

/**
 * Which logger the athlete's phone opens for this movement.
 *
 * The coach never picks a mode — it is inferred from what they wrote, exactly
 * as the vanilla builder's toPhoneEx did. Hardcoding reps_kg here meant a
 * 60-second plank asked the athlete for a weight and a rep count, and `max`
 * gave them a fixed-rep set instead of an AMRAP.
 *
 * The `> 30` test is what separates a duration from a rep count: nobody writes
 * a bare "45" meaning forty-five reps, and nobody holds a plank for 8 seconds.
 * `max` wins over it, because an AMRAP is about the count either way.
 */
function toAthleteEx(e: CoachEx) {
  const sets = e.sets || [];
  const allSecs = sets.length > 0 && sets.every((st) => /^\s*\d+\s*$/.test(String(st.t)) && parseInt(String(st.t), 10) > 30);
  const anyMax = sets.some((st) => /^\s*max\s*$/i.test(String(st.t)));
  const mode = anyMax ? 'amrap' : allSecs ? 'seconds' : 'reps_kg';
  return emit.newEx(
    e.name,
    mode,
    sets.map((st) => emit.newSet(st.t, st.rpe)),
    { rest: e.rest, cue: e.cue },
  );
}

/** Publish-time validation, so a bad session fails here and not on a phone. */
export function assertPublishable(sess: CoachSession): Workout<PlannedSet> {
  return emit.assertWorkout(sessionToWorkout(sess));
}
