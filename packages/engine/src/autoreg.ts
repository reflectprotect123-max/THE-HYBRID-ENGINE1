import { AUTOREG, MAX_KG } from './constants';
import type { AnySet } from './types';

/**
 * A target beginning with W is a warm-up set: "W" alone (work up as you like)
 * or "W10" (a warm-up of ten).
 *
 * It rides in `t` rather than a new key because a planned set's shape is
 * contractual — two suites assert it is exactly {t, rpe} — and `t` is already
 * free text parsed by pattern, the way `max` carries meaning.
 *
 * A warm-up is real work the athlete performs, so it still counts toward the
 * session's progress. What it must never do is move the working weight or enter
 * the record as if it were a working set.
 */
export function isWarmup(st: Pick<AnySet, 't'> | null | undefined): boolean {
  return /^\s*w/i.test((st && st.t) || '');
}

/**
 * The RPE this set is judged against. A target may be a range ("7-9") or a
 * list; the centre is their mean. With no target, fall back to the global.
 */
export function rpeCenterOf(st: Pick<AnySet, 'rpe'> | null | undefined): number {
  const ns = String((st && st.rpe) || '').match(/\d+(?:\.\d+)?/g);
  if (ns && ns.length) return ns.reduce((a, x) => a + Number(x), 0) / ns.length;
  return AUTOREG.targetRpeCenter;
}

/**
 * Plain-language verdict for a rated set, judged relative to that set's OWN
 * target RPE rather than an absolute scale — so "right on target" means what it
 * says whether the target was 7 or 9. The bands reproduce the old absolute
 * wording at the default 8.5 centre.
 */
export function verdictForRpe(rpe: number, center?: number | null): string {
  const d = rpe - (center == null ? AUTOREG.targetRpeCenter : center);
  if (rpe >= 10) return 'max effort'; // a 10 is a 10, whatever the target was
  if (d <= -3.5) return 'way too light';
  if (d <= -2) return 'too light';
  if (d <= -1) return 'easy';
  if (d < 0) return 'a touch under target';
  if (d <= 0.5) return 'right on target';
  if (d <= 1) return 'grindy';
  return 'max effort';
}


/**
 * A load written into the target as a percentage of the athlete's e1RM:
 * "5 @80%" is five reps at eighty percent.
 *
 * It rides in `t`, behind an `@`, for the same reason `W` does — a planned
 * set's shape is contractual and two suites assert it is exactly `{t, rpe}`,
 * so a third field is not available. The `@` is required rather than optional:
 * a bare "80%" in a rep target would be read as a rep count by `repFloorOf`,
 * which takes the first number it finds, and a rep floor of eighty would score
 * every set as a miss and drive the weight into the floor.
 *
 * Reps are still written FIRST for the same reason. "5 @80%" parses as five
 * reps; "@80%" alone has no rep target and no floor, which is legal and means
 * exactly what it says.
 *
 * Above 200% is refused as a typo rather than honoured — nobody prescribes
 * three times their one-rep max, and "1000%" from a slipped keypress would
 * otherwise resolve to a real number and put it in front of someone.
 */
export function loadPctOf(t: string | undefined): number | null {
  const m = String(t || '').match(/@\s*(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const pct = Number(m[1]);
  return pct > 0 && pct <= 200 ? pct : null;
}

/**
 * A load written into the target as ABSOLUTE kilos: "5 @100kg" is five reps at
 * a hundred kilos.
 *
 * The sibling of `loadPctOf` and it rides in `t` for the identical reason: a
 * planned set's shape is contractual, two suites assert it is exactly
 * `{t, rpe}`, and there is no third field to put a load in. `@` is required,
 * reps are written first, and `withoutLoad` strips this chunk before either
 * rep parser sees the string.
 *
 * WHY BOTH EXIST, rather than converting one into the other. A percentage is
 * relative to an e1RM the app estimates and re-estimates; kilos are what the
 * coach actually wrote on the plan. Converting a coach's 100kg into a
 * percentage at authoring time would silently re-price it every time the
 * athlete's estimate moved, which is precisely what a coach writing an
 * absolute number is refusing.
 *
 * Above `MAX_KG` is refused as a typo rather than honoured, mirroring
 * `loadPctOf`'s ceiling: nothing loadable on a barbell goes there, and a
 * slipped keypress would otherwise put a real number in front of someone.
 */
export function loadKgOf(t: string | undefined): number | null {
  const m = String(t || '').match(/@\s*(\d+(?:\.\d+)?)\s*kg/i);
  if (!m) return null;
  const kg = Number(m[1]);
  return kg > 0 && kg <= MAX_KG ? kg : null;
}

/**
 * The rep floor a target implies. "5" → 5; "8-10" → 8; "max"/"" → 0 (no floor,
 * so nothing can be "missed").
 *
 * The FIRST number written, not the smallest one present: a coach who writes
 * "10-8" means ten and accepts eight, and taking the minimum there would score
 * a set that missed by two reps as having made it — which adds load.
 */
export function repFloorOf(t: string | undefined): number {
  const m = withoutLoad(t).match(/(\d+)/);
  return m ? +m[1] : 0;
}

/**
 * The target with any `@N%` load chunk taken out, so the rep parsers below only
 * ever see reps.
 *
 * Both of them take the FIRST number they find, so "@80%" alone would read as a
 * rep floor of eighty — scoring every set as a missed one and walking the
 * weight down. Stripping is safe by construction: `@` never appeared in a rep
 * target before `loadPctOf` gave it a meaning.
 */
function withoutLoad(t: string | undefined): string {
  // BOTH load forms, or the one that is not stripped becomes a rep count.
  // "@100kg" alone would otherwise read as a rep floor of one hundred, score
  // every set as a miss, and walk the weight into the floor — the same trap
  // `loadPctOf` documents for a bare percentage.
  return String(t || '').replace(/@\s*\d+(?:\.\d+)?\s*(?:%|kg)/gi, ' ');
}

/**
 * The rep target to offer back. The TOP of a range, because a range is written
 * as the ambition with the floor after it — the athlete aims at 10 of "8-10".
 * "5" → "5"; "max"/"" → "" (nothing to suggest).
 */
export function repTopOf(t: string | undefined): string {
  const s = withoutLoad(t);
  const r = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (r) return r[2];
  const m = s.match(/(\d+)/);
  return m ? m[1] : '';
}
