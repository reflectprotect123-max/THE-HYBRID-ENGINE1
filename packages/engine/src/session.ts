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
} from './types';

export function isCond(b: Block | null | undefined): b is CondBlock {
  return !!b && (b as CondBlock).kind === 'conditioning';
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
  s.blocks.forEach((b) =>
    blockExercises(b).forEach((e) => {
      if (e.mode !== 'reps_kg' && e.mode !== 'amrap') return;
      e.sets.forEach((st) => {
        if (isWarmup(st)) return;
        if (!st.done) return;
        const kg = parseFloat(String(st.aVal));
        const r = parseFloat(String(st.aVal2));
        if (Number.isFinite(kg) && Number.isFinite(r)) v += kg * r;
      });
    }),
  );
  return Math.round(v);
}

/** Mean target RPE and mean felt RPE for a session. Warm-ups excluded. */
export function sessionRpe(s: Session): { target: number | null; felt: number | null } {
  const t: number[] = [];
  const f: number[] = [];
  s.blocks.forEach((b) =>
    blockExercises(b).forEach((e) =>
      e.sets.forEach((st) => {
        if (isWarmup(st)) return;
        if (!st.done) return;
        const tt = parseFloat(String(st.rpe));
        const ff = parseFloat(String(st.felt));
        if (Number.isFinite(tt)) t.push(tt);
        if (Number.isFinite(ff)) f.push(ff);
      }),
    ),
  );
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { target: avg(t), felt: avg(f) };
}

/**
 * How much a session is "worth" when two devices disagree about it.
 *
 * A finished conditioning block IS logged work. Counting only sets meant a
 * session whose only work was a run scored zero, lost the merge to the remote
 * copy, and had its whole HR record deleted on the next sync.
 */
export function sessionScore(s: Session): number {
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
  return (s.completedAt || s.startedAt || 0) + n * 1e6;
}

export function hasLoggedWork(s: Session | null | undefined): boolean {
  return (
    !!s &&
    s.blocks.some(
      (b) =>
        (isCond(b) && !!b.condResult) ||
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
      s.blocks.forEach((b) =>
        blockExercises(b).forEach((e) => {
          if (!isLiftMode(e.mode) || String(e.name || '').trim().toLowerCase() !== key) return;
          e.sets.forEach((st) => {
            if (isWarmup(st)) return;
            const e1 = epley(st.aVal, st.aVal2);
            if (st.done && e1 != null) {
              sets.push({ kg: Number(st.aVal), reps: Number(st.aVal2), felt: st.felt || '', e1 });
            }
          });
        }),
      );
      if (sets.length) {
        const best = sets.reduce((m, x) => (x.e1 > m.e1 ? x : m), sets[0]);
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
    if (h.sid === excludeSid) return;
    if (!best || h.best.e1 > best.e1) best = Object.assign({ date: h.date }, h.best);
  });
  return best;
}

/** Any lift in a finishing session whose best set beats all prior history. */
export function detectPRs(s: Session, sessions: Session[]): PrRecord[] {
  const prs: PrRecord[] = [];
  const seen = new Set<string>();

  s.blocks.forEach((b) =>
    blockExercises(b).forEach((e) => {
      if (!isLiftMode(e.mode)) return;
      const key = String(e.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);

      let best: { kg: number; reps: number; e1: number } | null = null;
      e.sets.forEach((st) => {
        if (isWarmup(st)) return;
        const e1 = epley(st.aVal, st.aVal2);
        if (st.done && e1 != null && (!best || e1 > best.e1)) {
          best = { kg: Number(st.aVal), reps: Number(st.aVal2), e1 };
        }
      });
      if (!best) return;
      const b2 = best as { kg: number; reps: number; e1: number };

      const prev = exBest(e.name, sessions, s.id);
      if (!prev || b2.e1 > prev.e1 + 0.01) {
        prs.push({ name: e.name, kg: b2.kg, reps: b2.reps, e1: b2.e1, prevE1: prev ? prev.e1 : null });
      }
    }),
  );

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
    s.blocks.forEach((b) =>
      blockExercises(b).forEach((e) =>
        e.sets.forEach((st) => {
          const t = parseFloat(String(st.rpe));
          const f = parseFloat(String(st.felt));
          if (st.done && Number.isFinite(t) && Number.isFinite(f)) gaps.push(f - t);
        }),
      ),
    );
    s.blocks.forEach((b) => {
      if (!isCond(b) || !b.condResult) return;
      const eff = (b.condResult.effort && CON_EFFORTS[b.condResult.effort]) || condEffort(b.condResult);
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
      s.blocks.forEach((b) =>
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
        }),
      );
    });
  return names;
}

/** Is every block in this workout conditioning? Drives how it is presented. */
export function isCondWorkout(w: Workout): boolean {
  return (w.blocks || []).length > 0 && (w.blocks || []).every(isCond);
}
