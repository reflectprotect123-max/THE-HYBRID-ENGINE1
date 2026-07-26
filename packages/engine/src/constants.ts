import type { CondFmtKey, EffortKey, ModeKey, ZoneKey } from './types';

/*
 * Constants that carry meaning. Where a number came from a source rather than a
 * preference, the source is named — those comments are the reason anyone can
 * safely change these later, and dropping them would leave a pile of magic
 * numbers nobody dares touch.
 */

/**
 * Per-set autoregulation, Tuchscherer/Helms RPE-load basis.
 *
 * `pctPerRpePoint` — one RPE point is worth ~2.5% of load near a working
 * single. `missedFloorRpe` — missing the rep floor is treated as *harder* than
 * a 10, so the next set always comes down. `plateIncrement` — the smallest
 * change a normal gym can actually make.
 */
export const AUTOREG = {
  targetRpeCenter: 8.5,
  pctPerRpePoint: 2.5,
  missedFloorRpe: 10.5,
  plateIncrement: 2.5,
  stepKg: 2.5,
} as const;

/** Nothing loadable on a barbell goes above this. Guards Infinity/overflow. */
export const MAX_KG = 2000;

export const MODES: Record<ModeKey, { label: string; unit: string; ph: string }> = {
  reps_kg: { label: 'Reps + Kilos', unit: '', ph: 'reps' },
  amrap: { label: 'Max reps', unit: '', ph: 'max' },
  seconds: { label: 'Seconds', unit: 's', ph: 'secs' },
  reps_seconds: { label: 'Reps + Seconds', unit: 's', ph: 'secs' },
  reps: { label: 'Reps only', unit: '', ph: 'reps' },
  completion: { label: 'For completion', unit: '', ph: '' },
};

export const MODE_KEYS = Object.keys(MODES) as ModeKey[];

/**
 * Recovery banding. 67 and 34 are WHOOP's own green/yellow/red boundaries;
 * every surface reads them from here so Home can't say "green light" while the
 * live screen says "steady".
 */
export const RECOVERY_BANDS = { good: 67, watch: 34 } as const;

/**
 * Daily re-zoning, applied as a fraction shift on the band ceilings.
 *
 * PROVISIONAL — the direction is Morpheus-style and well founded (a red day
 * should widen the easy band and pull the hard line down); the magnitudes are
 * ours, not published. Asymmetric on purpose: protecting a depleted athlete
 * matters more than squeezing a fresh one.
 */
export const REZONE_PROVISIONAL = {
  lowOnRed: +0.03,
  modOnRed: -0.05,
  lowOnGreen: -0.03,
  modOnGreen: +0.04,
} as const;

/**
 * Effort — one word to author a conditioning block, resolving to BOTH a heart
 * rate zone and an RPE target so lifting and conditioning share one vocabulary.
 *
 * The cues are the talk test, the accepted field proxy for these boundaries.
 * PROVISIONAL — the talk-test-to-zone correspondence is established in
 * direction; the exact RPE numbers are our convention for lining the two scales
 * up, not a published mapping.
 */
export const CON_EFFORTS: Record<
  EffortKey,
  { key: EffortKey; name: string; zone: ZoneKey; rpe: [number, number]; center: number; cue: string }
> = {
  easy: { key: 'easy', name: 'Easy', zone: 'low', rpe: [3, 4], center: 3.5, cue: 'full sentences' },
  medium: { key: 'medium', name: 'Medium', zone: 'mod', rpe: [5, 7], center: 6, cue: 'short sentences' },
  hard: { key: 'hard', name: 'Hard', zone: 'high', rpe: [8, 9.5], center: 8.5, cue: 'a few words at a time' },
};

export const CON_EFFORT_KEYS: EffortKey[] = ['easy', 'medium', 'hard'];

/** Blocks authored before effort existed stored only a zone. Read them back. */
export const ZONE_TO_EFFORT: Record<ZoneKey, EffortKey> = { low: 'easy', mod: 'medium', high: 'hard' };

export const ZONE_NAMES: Record<ZoneKey, string> = {
  low: 'Recovery',
  mod: 'Conditioning',
  high: 'Overload',
};

/**
 * Heart-rate recovery window. HRR is read 60s after the session peak, with a
 * 6s tolerance either side so a dropped sample doesn't void the measurement.
 */
export const HRR_WINDOW_SEC = 60;
export const HRR_TOLERANCE_SEC = 6;

/** Cap on stored trace points. Bin width grows to fit rather than clamping. */
export const CON_MAX_POINTS = 2700;

/**
 * How many standalone conditioning records to keep. Progression reads its
 * history through this list, so the cap must never be the thing deciding
 * whether an athlete progresses.
 */
export const CON_RETENTION = 200;

/** Formats that carry earned progression. `free` and `custom` do not. */
export const PROGRESSED_FORMATS: CondFmtKey[] = ['steady', 'intervals', 'tempo'];

export const LS_KEY = 'hybrid-engine-v1';
export const COACH_LS_KEY = 'hybrid-coach-v1';

/**
 * Fields the logger owns. A planned set arriving from the coach carrying any of
 * these means a publish could overwrite logged work, so the emit boundary
 * rejects it outright rather than stripping it quietly.
 */
export const FORBIDDEN_SET_KEYS = ['aVal', 'aVal2', 'felt', 'done', 'note'] as const;
