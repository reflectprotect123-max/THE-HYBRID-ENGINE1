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

function toAthleteEx(e: CoachEx) {
  return emit.newEx(
    e.name,
    'reps_kg',
    e.sets.map((st) => emit.newSet(st.t, st.rpe)),
    { rest: e.rest, cue: e.cue },
  );
}

/** Publish-time validation, so a bad session fails here and not on a phone. */
export function assertPublishable(sess: CoachSession): Workout<PlannedSet> {
  return emit.assertWorkout(sessionToWorkout(sess));
}
