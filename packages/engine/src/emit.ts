import { FORBIDDEN_SET_KEYS, MODE_KEYS } from './constants';
import type {
  CondBlock,
  CondFmtKey,
  EffortKey,
  Exercise,
  ModeKey,
  PlannedSet,
  StrengthBlock,
  Workout,
  ZoneKey,
} from './types';

/*
 * THE Hybrid System — emit contract (coach → athlete).
 *
 * The ONE boundary between the coach app and the athlete app. It builds
 * athlete-shape workouts and pins the athlete's enums and field names, so a
 * future rename fails the contract test loudly instead of silently shipping
 * broken sessions to athletes.
 *
 * The athlete's LOGGER — never the coach — writes the actual-result set fields
 * (aVal, aVal2, felt, done, note). emit MUST never write those; `assert` throws
 * if it sees one, so a target can never masquerade as a logged result.
 */

export const COND_FORMATS: CondFmtKey[] = ['steady', 'intervals', 'tempo', 'custom', 'free'];
export const ZONES: ZoneKey[] = ['low', 'mod', 'high'];

/** Effort names and the zone each one holds. Both are emitted so a reader that
    knows only about zones keeps working. */
export const EFFORTS: Record<EffortKey, ZoneKey> = { easy: 'low', medium: 'mod', hard: 'high' };

export const LB_TO_KG = 0.45359237;

/* Reached through globalThis because the engine targets browser, React Native
   and Node, and only some of those declare `crypto` as a global binding. */
function eid(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* falls through to the timestamp form */
  }
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const s = (v: unknown): string => (v == null ? '' : String(v));

export function newSet(target?: unknown, rpe?: unknown): PlannedSet {
  return { t: s(target), rpe: s(rpe) };
}

export interface ExOpts {
  rest?: number | string;
  tempo?: string;
  /**
   * Coach cue. Also where a PRESCRIBED LOAD lives: the athlete's set model is
   * {t, rpe} with no target-weight field, so a coach naming a number writes it
   * into the cue and the athlete reads it on the card.
   */
  cue?: string;
}

export function newEx(name: string, mode: string, sets?: PlannedSet[], opts: ExOpts = {}): Exercise<PlannedSet> {
  const m: ModeKey = (MODE_KEYS as string[]).includes(mode) ? (mode as ModeKey) : 'reps_kg';
  let rest = parseInt(String(opts.rest), 10);
  if (!Number.isFinite(rest) || rest < 0) rest = 90;
  const ex: Exercise<PlannedSet> = {
    id: eid(),
    name: s(name),
    mode: m,
    tempo: s(opts.tempo),
    rest: Math.min(rest, 3600),
    sets: sets && sets.length ? sets : [newSet(), newSet(), newSet()],
  };
  if (s(opts.cue)) ex.cue = s(opts.cue);
  return ex;
}

export interface BlockOpts {
  minutes?: number | string;
  format?: string;
}

export function newBlock(
  heading: string,
  exercises?: Exercise<PlannedSet>[],
  superset?: boolean,
  opts: BlockOpts = {},
): StrengthBlock<PlannedSet> {
  return {
    id: eid(),
    heading: s(heading) || 'Block',
    minutes: s(opts.minutes),
    format: s(opts.format),
    superset: !!superset,
    exercises: exercises && exercises.length ? exercises : [newEx('', 'reps_kg')],
  };
}

/** Takes an effort (easy/medium/hard) and emits BOTH it and the zone it holds.
    Passing a bare zone still works, for plans authored before effort existed. */
export function newCondBlock(
  heading: string,
  condFmt: string,
  effortOrZone?: string,
  minutes?: number | string,
): CondBlock {
  const fmt: CondFmtKey = (COND_FORMATS as string[]).includes(condFmt)
    ? (condFmt as CondFmtKey)
    : 'intervals';
  let effort: EffortKey = 'medium';
  let zone: ZoneKey = 'mod';
  const k = String(effortOrZone || '').toLowerCase();

  if (k in EFFORTS) {
    effort = k as EffortKey;
    zone = EFFORTS[effort];
  } else if ((ZONES as string[]).includes(k)) {
    zone = k as ZoneKey;
    (Object.keys(EFFORTS) as EffortKey[]).forEach((e) => {
      if (EFFORTS[e] === zone) effort = e;
    });
  }

  return {
    id: eid(),
    kind: 'conditioning',
    heading: s(heading) || 'Conditioning',
    condFmt: fmt,
    effort,
    targetZone: zone,
    minutes: s(minutes),
  };
}

export function newWorkout(
  name: string,
  blocks: (StrengthBlock<PlannedSet> | CondBlock)[],
  extra?: Record<string, unknown>,
): Workout<PlannedSet> {
  const w = {
    id: eid(),
    name: s(name) || 'Session',
    blocks: blocks || [],
    updatedAt: Date.now(),
  } as Workout<PlannedSet>;
  if (extra && typeof extra === 'object') Object.assign(w, extra);
  return w;
}

/**
 * Map a coach column set (measure labels) to a per-exercise mode.
 *
 * The athlete app has 6 modes; the coach editor has ~19 measure column types.
 * Weight present → reps_kg (weight is the target load); Time → seconds; Reps
 * only → reps; nothing quantifiable → completion. Unsupported coach measures
 * (distance, %, calories, height) fall back to the nearest mode and are
 * preserved on the snapshot for a future athlete-app update.
 */
export function measureToMode(cols: string[] = []): ModeKey {
  const has = (pfx: string) => cols.some((c) => String(c).indexOf(pfx) === 0);
  if (has('Weight')) return 'reps_kg';
  if (has('Time')) return 'seconds';
  if (cols.indexOf('Reps') >= 0) return 'reps';
  return 'completion';
}

export function lbToKg(lb: unknown): number | '' {
  const n = parseFloat(String(lb));
  return Number.isFinite(n) ? Math.round(n * LB_TO_KG * 10) / 10 : '';
}

/**
 * Validate an athlete-shape workout before it is stored or assigned. Throws on
 * any out-of-whitelist enum, or any set carrying a logger-owned field.
 */
export function assertWorkout<T extends { blocks?: unknown }>(w: T): T {
  if (!w || typeof w !== 'object') throw new Error('emit: workout must be an object');
  if (!Array.isArray(w.blocks)) throw new Error('emit: workout.blocks must be an array');

  (w.blocks as unknown[]).forEach((b0, bi) => {
    if (!b0 || typeof b0 !== 'object') throw new Error('emit: block ' + bi + ' is not an object');
    // Validating UNTRUSTED input, so read the block through an index signature
    // rather than the discriminated union — the whole point is that the shape
    // may not match, and narrowing on a lie would skip the check.
    const b = b0 as Record<string, unknown>;

    if (b.kind === 'conditioning') {
      if (!(COND_FORMATS as string[]).includes(b.condFmt as string)) {
        throw new Error('emit: block ' + bi + ' bad condFmt "' + b.condFmt + '"');
      }
      if (!(ZONES as string[]).includes(b.targetZone as string)) {
        throw new Error('emit: block ' + bi + ' bad targetZone "' + b.targetZone + '"');
      }
      if (b.effort != null && !((b.effort as string) in EFFORTS)) {
        throw new Error('emit: block ' + bi + ' bad effort "' + b.effort + '"');
      }
      return;
    }

    ((b.exercises as Exercise<PlannedSet>[]) || []).forEach((e, ei) => {
      if (!(MODE_KEYS as string[]).includes(e.mode)) {
        throw new Error('emit: ' + bi + '/' + ei + ' bad mode "' + e.mode + '"');
      }
      (e.sets || []).forEach((st, si) => {
        if (!st || typeof st !== 'object') {
          throw new Error('emit: set ' + bi + '/' + ei + '/' + si + ' is not an object');
        }
        FORBIDDEN_SET_KEYS.forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(st, k)) {
            throw new Error('emit: set ' + bi + '/' + ei + '/' + si + ' carries logger field "' + k + '"');
          }
        });
      });
    });
  });

  return w;
}
