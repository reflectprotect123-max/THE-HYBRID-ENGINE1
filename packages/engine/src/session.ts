import { CON_EFFORTS, MODES } from './constants';
import { condEffort, condEffortGap } from './conditioning';
import { epley, fmtRest, uid } from './num';
import { isWarmup } from './autoreg';
import type {
  AnySet,
  Block,
  CondBlock,
  Exercise,
  ExerciseHistoryEntry,
  LoggedSet,
  ModeKey,
  PlannedSet,
  PrRecord,
  Session,
  StrengthBlock,
  Workout,
  TextBlock,
} from './types';

export function isCond(b: Block | null | undefined): b is CondBlock {
  return !!b && (b as CondBlock).kind === 'conditioning';
}

/** A whole block of prep. Nothing inside it counts toward anything earned. */
export function isWarmupBlock(b: Block | null | undefined): boolean {
  return !!b && !isCond(b) && !isText(b) && !!(b as StrengthBlock<AnySet>).warmup;
}

export function newWarmupBlock(): StrengthBlock {
  // One block type for both ends of the session: the rule is the same either
  // way — real movements, ticked off, counting toward nothing earned.
  return { id: uid(), heading: 'Warm-up / Cooldown', warmup: true, superset: false, exercises: [newEx()] };
}

export function isText(b: Block | null | undefined): b is TextBlock {
  return !!b && (b as TextBlock).kind === 'text';
}

export function newTextBlock(): TextBlock {
  return { id: uid(), kind: 'text', heading: 'Metcon', body: '' };
}

export function blockExercises<S extends AnySet>(b: Block<S> | null | undefined): Exercise<S>[] {
  return (b && (b as StrengthBlock<S>).exercises) || [];
}

/** Modes where a load is recorded, and so where an e1RM and a PR are meaningful. */
export function isLiftMode(m: string | undefined): boolean {
  return m === 'reps_kg' || m === 'amrap';
}

export function newSet(): PlannedSet {
  return { t: '', rpe: '' };
}

export function newEx(): Exercise {
  return { id: uid(), name: '', mode: 'reps_kg', tempo: '', rest: 90, sets: [newSet(), newSet(), newSet()] };
}

export function newBlock(): StrengthBlock {
  return { id: uid(), heading: 'New block', minutes: '', format: '', superset: false, exercises: [newEx()] };
}

/**
 * Type once, fill the rest — the authoring-side counterpart to
 * `prefillPrimary`. `newEx` gives every fresh exercise identical blank sets, so
 * the common case is typing set 1 and having it apply everywhere.
 *
 * A later set follows only while it still holds its PRE-edit value. The
 * instant one is edited independently it diverges, and the chain stops there —
 * for every set after it too, since a later coincidental match is not evidence
 * it belongs to the same run. This is `prefillPrimary`'s own rule read
 * backwards: something already typed must never be overwritten by a
 * suggestion, and a blank cell is the only thing that counts as untyped.
 *
 * Never crosses a warm-up/working boundary, for the same reason `isWarmup`
 * guards prefill and the in-session adjustment: a warm-up target and a working
 * target are different claims, however coincidentally similar their strings.
 */
export function fillLinkedSets<S extends AnySet>(sets: S[], si: number, key: 't' | 'rpe', value: string): S[] {
  if (!sets[si]) return sets;
  const out = sets.slice();
  const prev = out[si][key];
  out[si] = { ...out[si], [key]: value };

  const warm = isWarmup(sets[si]);
  for (let j = si + 1; j < out.length; j++) {
    const cur = sets[j];
    if (!cur || isWarmup(cur) !== warm || cur[key] !== prev) break;
    out[j] = { ...cur, [key]: value };
  }
  return out;
}

/**
 * Insert a copy of one exercise immediately after itself, with a fresh id.
 *
 * The fastest way to build a session with any repeated structure, which is
 * most of them: a superset pair, unilateral left/right work, a near-identical
 * accessory. Sets are copied by value, never by reference, so editing the
 * copy can never reach back into the original.
 *
 * The copy never links onward (`ssNext` is always false): defaulting it true
 * would splice an unrequested link into whatever the array holds next.
 *
 * If the ORIGINAL linked onward, that link is cleared rather than left in
 * place. `ssNext` is purely positional — "link to whatever is next" — so
 * inserting anything after the original would otherwise silently reroute an
 * existing chain from its real partner onto the new copy, a change to a link
 * the coach did not touch by duplicating a different exercise.
 */
export function duplicateExercise<S extends AnySet>(exercises: Exercise<S>[], ei: number): Exercise<S>[] {
  const ex = exercises[ei];
  if (!ex) return exercises;
  const out = exercises.slice();
  if (out[ei].ssNext) out[ei] = { ...out[ei], ssNext: false };
  const copy: Exercise<S> = { ...ex, id: uid(), ssNext: false, sets: ex.sets.map((s) => ({ ...s })) };
  out.splice(ei + 1, 0, copy);
  return out;
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

/** The one-line prescription shown under an exercise name. */
export function rxLine(ex: Exercise<AnySet>): string {
  const cfg = MODES[ex.mode as ModeKey] || MODES.reps_kg;
  const n = ex.sets.length;
  let rx: string;

  if (ex.mode === 'completion') {
    rx = n + ' × complete';
  } else {
    const vals = ex.sets.map((s) =>
      ex.mode === 'amrap' || s.t === 'max' ? 'max' : (s.t || '—') + cfg.unit,
    );
    const u = Array.from(new Set(vals));
    rx = n + ' × ' + (u.length === 1 ? u[0] : vals.join('/'));
    const rpes = ex.sets.map((s) => s.rpe).filter(Boolean);
    if (rpes.length) {
      const uu = Array.from(new Set(rpes));
      rx += ' · RPE ' + (uu.length === 1 ? uu[0] : rpes[0] + '→' + rpes[rpes.length - 1]);
    }
  }
  if (ex.tempo) rx += ' · @' + ex.tempo;
  if (ex.rest) rx += ' · rest ' + fmtRest(ex.rest);
  return rx;
}

/** Warm-ups are excluded: they inflate volume without being training. */
export function sessionVolume(s: Session): number {
  let v = 0;
  s.blocks.forEach((b) => {
    // Prep is not tonnage. The per-set marker handles a ramp inside a working
    // exercise; this skips the whole block.
    if (isWarmupBlock(b)) return;
    blockExercises(b).forEach((e) => {
      if (e.mode !== 'reps_kg' && e.mode !== 'amrap') return;
      e.sets.forEach((st) => {
        if (isWarmup(st)) return;
        if (!st.done) return;
        const kg = parseFloat(String(st.aVal));
        const r = parseFloat(String(st.aVal2));
        if (Number.isFinite(kg) && Number.isFinite(r)) v += kg * r;
      });
    });
  });
  return Math.round(v);
}

/**
 * Mean target RPE and mean felt RPE for a session. Warm-ups excluded.
 *
 * A conditioning block's banked felt RPE (`condResult.felt`) is on the same
 * 1-10 slider a strength set's `felt` is, so it belongs in the felt average —
 * `blockExercises(b)` is always `[]` for a CondBlock, so without this a
 * conditioning-only or hybrid session's rated effort never contributed at
 * all. `target` is deliberately left alone for a conditioning block: the only
 * candidate, `condResult.targetRpe`, is a coach-authored BAND CENTER (e.g.
 * "Hard" = RPE 8-9.5, center 8.5), not a single number aimed at the way a
 * strength set's own `rpe` is — folding it in would conflate two different
 * kinds of number and would change `target` for every already-recorded
 * conditioning result that carries a `targetRpe`.
 */
export function sessionRpe(s: Session): { target: number | null; felt: number | null } {
  const t: number[] = [];
  const f: number[] = [];
  s.blocks.forEach((b) => {
    if (isWarmupBlock(b)) return; // whole-block prep is not rated effort — the
    // per-set isWarmup guard misses a warm-up block whose sets carry an
    // ordinary target ("10"), the same skip every sibling opens with.
    if (isCond(b)) {
      const ff = parseFloat(String(b.condResult?.felt));
      if (Number.isFinite(ff)) f.push(ff);
      return;
    }
    blockExercises(b).forEach((e) =>
      e.sets.forEach((st) => {
        if (isWarmup(st)) return;
        if (!st.done) return;
        const tt = parseFloat(String(st.rpe));
        const ff = parseFloat(String(st.felt));
        if (Number.isFinite(tt)) t.push(tt);
        if (Number.isFinite(ff)) f.push(ff);
      }),
    );
  });
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { target: avg(t), felt: avg(f) };
}

/**
 * How many pieces of logged work a session carries — a done set, or a
 * finished conditioning block. A finished conditioning block IS logged work:
 * counting only sets meant a session whose only work was a run scored zero.
 *
 * This is the quantity `pickSession` compares first, so a session with any
 * logged work always outranks an emptier one regardless of timestamps.
 */
export function loggedWorkCount(s: Session): number {
  let n = 0;
  (s.blocks || []).forEach((b) => {
    if (b && (b as CondBlock).condResult) {
      n += 1;
      return;
    }
    ((b && (b as StrengthBlock).exercises) || []).forEach((e) =>
      (e.sets || []).forEach((st) => {
        if (st && st.done) n += 1;
      }),
    );
  });
  return n;
}

/** How much a session is "worth" — kept for existing consumers of the raw number. */
export function sessionScore(s: Session): number {
  return (s.completedAt || s.startedAt || 0) + loggedWorkCount(s) * 1e6;
}

export function hasLoggedWork(s: Session | null | undefined): boolean {
  return (
    !!s &&
    s.blocks.some(
      (b) =>
        (isCond(b) && !!b.condResult) ||
        // A ticked metcon is training that happened. Without this the day reads
        // as untrained and expireStaleSessions bins it.
        (isText(b) && !!b.done) ||
        blockExercises(b).some((e) => e.sets.some((st) => st.done || st.aVal || st.aVal2 || st.felt)),
    )
  );
}

/**
 * Every completed working set of one lift, oldest first, with the best set of
 * each session picked out. Warm-ups never enter the record.
 */
export function exLogFor(name: string, sessions: Session[]): ExerciseHistoryEntry[] {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return [];
  const out: ExerciseHistoryEntry[] = [];

  sessions
    .filter((s) => s.status !== 'active' && s.completedAt)
    .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0))
    .forEach((s) => {
      const sets: ExerciseHistoryEntry['sets'] = [];
      s.blocks.forEach((b) => {
        if (isWarmupBlock(b)) return;
        blockExercises(b).forEach((e) => {
          if (!isLiftMode(e.mode) || String(e.name || '').trim().toLowerCase() !== key) return;
          e.sets.forEach((st) => {
            if (isWarmup(st)) return;
            if (!st.done) return;
            const reps = Number(st.aVal2);
            // Reps are what make it a set. A bodyweight rep is training that
            // happened; gating on a WEIGHT threw it away.
            if (!(reps > 0)) return;
            const e1 = epley(st.aVal, st.aVal2);
            sets.push({ kg: e1 == null ? null : Number(st.aVal), reps, felt: st.felt || '', e1 });
          });
        });
      });
      if (sets.length) {
        // `best` stays the best LOADED set: an e1RM is a claim about load, and
        // bodyweight work cannot make one. Null when the whole session was
        // bodyweight, which the chart skips and the set list still shows.
        const loaded = sets.filter(
          (x): x is { kg: number; reps: number; felt: string; e1: number } => x.e1 != null,
        );
        const best = loaded.length ? loaded.reduce((m, x) => (x.e1 > m.e1 ? x : m)) : null;
        out.push({ sid: s.id, date: s.date, at: s.completedAt as number, sets, best });
      }
    });

  return out;
}

export function exBest(
  name: string,
  sessions: Session[],
  excludeSid?: string,
): (ExerciseHistoryEntry['best'] & { date: string }) | null {
  let best: (ExerciseHistoryEntry['best'] & { date: string }) | null = null;
  exLogFor(name, sessions).forEach((h) => {
    if (h.sid === excludeSid || !h.best) return;
    if (!best || h.best.e1 > best.e1) best = Object.assign({ date: h.date }, h.best);
  });
  return best;
}

/** Any lift in a finishing session whose best set beats all prior history. */
export function detectPRs(s: Session, sessions: Session[]): PrRecord[] {
  const prs: PrRecord[] = [];
  const bestByKey = new Map<string, { name: string; kg: number; reps: number; e1: number }>();

  s.blocks.forEach((b) => {
    if (isWarmupBlock(b)) return;
    blockExercises(b).forEach((e) => {
      if (!isLiftMode(e.mode)) return;
      const key = String(e.name || '').trim().toLowerCase();
      if (!key) return;
      e.sets.forEach((st) => {
        if (isWarmup(st)) return;
        const e1 = epley(st.aVal, st.aVal2);
        if (st.done && e1 != null) {
          const cur = bestByKey.get(key);
          // scan EVERY block for this movement's best — a heavy single in a
          // later block used to be skipped by the old dedupe-before-scan, so
          // the PR banner never fired while the chart jumped.
          if (!cur || e1 > cur.e1) bestByKey.set(key, { name: e.name, kg: Number(st.aVal), reps: Number(st.aVal2), e1 });
        }
      });
    });
  });

  bestByKey.forEach((best) => {
    const prev = exBest(best.name, sessions, s.id);
    if (!prev || best.e1 > prev.e1 + 0.01) {
      prs.push({ name: best.name, kg: best.kg, reps: best.reps, e1: best.e1, prevE1: prev ? prev.e1 : null });
    }
  });

  return prs;
}

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
      if (isWarmupBlock(b)) return;
      blockExercises(b).forEach((e) =>
        e.sets.forEach((st) => {
          if (isWarmup(st)) return;
          const t = parseFloat(String(st.rpe));
          const f = parseFloat(String(st.felt));
          if (st.done && Number.isFinite(t) && Number.isFinite(f)) gaps.push(f - t);
        }),
      );
    });
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
 * Deep-clone a workout's blocks into a pristine session shape: strength sets
 * cleared of any recorded values, conditioning blocks reset with no result. One
 * helper so every entry point — preview, start, restart — treats hybrid blocks
 * identically.
 */
export function freshSessionBlocks(blocks: Block<AnySet>[]): Block<LoggedSet>[] {
  return (blocks || []).map((b) => {
    if (isCond(b)) {
      const { condResult: _drop, ...rest } = b;
      return { ...rest, id: uid() } as CondBlock;
    }
    const sb = b as StrengthBlock<AnySet>;
    return {
      ...sb,
      id: uid(),
      exercises: (sb.exercises || []).map((e) => ({
        ...e,
        id: uid(),
        sets: (e.sets || []).map((st) => ({ t: st.t || '', rpe: st.rpe || '' }) as LoggedSet),
      })),
    } as StrengthBlock<LoggedSet>;
  });
}

/** Best e1RM per movement inside a window, keyed by lowercased name. */
export function bestE1rmByLift(
  sessions: Session[],
  fromMs: number,
  toMs: number,
): Map<string, { name: string; e1: number; kg: number; reps: number }> {
  const names = new Map<string, { name: string; e1: number; kg: number; reps: number }>();
  sessions
    .filter((s) => s.status !== 'active')
    .forEach((s) => {
      const t = Date.parse(s.date + 'T12:00:00');
      if (!Number.isFinite(t) || t < fromMs || t >= toMs) return;
      s.blocks.forEach((b) => {
        if (isWarmupBlock(b)) return;
        blockExercises(b).forEach((e) => {
          if (!isLiftMode(e.mode)) return;
          const k = String(e.name || '').trim();
          if (!k) return;
          e.sets.forEach((st) => {
            if (isWarmup(st)) return;
            const e1 = epley(st.aVal, st.aVal2);
            if (st.done && e1 != null) {
              const cur = names.get(k.toLowerCase());
              if (!cur || e1 > cur.e1) {
                names.set(k.toLowerCase(), { name: k, e1, kg: Number(st.aVal), reps: Number(st.aVal2) });
              }
            }
          });
        });
      });
    });
  return names;
}

/** Is every block in this workout conditioning? Drives how it is presented. */
export function isCondWorkout(w: Workout): boolean {
  return (w.blocks || []).length > 0 && (w.blocks || []).every(isCond);
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

/**
 * Every movement name the athlete has ever written, newest spelling first.
 *
 * DERIVED, never stored. The point of this list is to stop the same lift being
 * written two ways — "Squat" and "Back Squat" are two different lifts to
 * `exLogFor`, `detectPRs`, `bestE1rmByLift` and the earned working weight — and
 * a stored catalogue would be one more thing that can desync and disagree with
 * the sessions it is meant to describe. The sessions ARE the catalogue.
 *
 * De-duplicated case-insensitively keeping the most recent spelling, because
 * the last way you wrote it is the way you are writing it now.
 */
export function knownMovements(
  workouts: Workout[] = [],
  sessions: Session[] = [],
): string[] {
  // Newest first so the first spelling seen for a key is the freshest one.
  const src: { blocks: Block<AnySet>[]; at: number }[] = [];
  (workouts || []).forEach((w) => w && src.push({ blocks: w.blocks || [], at: w.updatedAt || 0 }));
  (sessions || []).forEach((s) => s && src.push({ blocks: s.blocks || [], at: s.completedAt || s.updatedAt || 0 }));
  src.sort((a, b) => b.at - a.at);

  const seen = new Map<string, string>();
  src.forEach((x) =>
    x.blocks.forEach((b) =>
      blockExercises(b).forEach((e) => {
        if (!isLiftMode(e.mode)) return;
        const name = String(e.name || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!seen.has(key)) seen.set(key, name);
      }),
    ),
  );

  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
