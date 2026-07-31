import { AUTOREG } from './constants';
import { roundToIncrement } from './num';
import type { AnySet, SetAdjustment } from './types';

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
 * Move the next set's load from how the last one actually went.
 *
 * Tuchscherer/Helms basis: one RPE point below target is worth roughly
 * `pctPerRpePoint` of load. Missing the rep floor is treated as harder than a
 * 10 (`missedFloorRpe`), so a missed set always brings the weight down even if
 * the athlete rated the effort modestly.
 */
export function computeSetAdjustment(
  reps: number,
  rpe: number,
  low: number,
  weight: number,
  center: number,
): SetAdjustment {
  const missed = low > 0 && reps < low;
  const eff = missed ? AUTOREG.missedFloorRpe : rpe;
  const raw = weight * (1 + ((center - eff) * AUTOREG.pctPerRpePoint) / 100);
  // When the set hit its target exactly (eff === center, so the multiplier is
  // 1 and `raw` IS the weight), holding is the right answer — rounding a
  // manually-entered non-plate load (101 → 100) otherwise banked a "−1 kg"
  // change and painted a perfect set red. A missed set has eff = 10.5 > center,
  // so raw < weight and this never fires for it.
  let newWeight = raw === weight ? weight : roundToIncrement(raw, AUTOREG.plateIncrement);
  // A missed set's RAW adjustment is always below `weight` (see above), but
  // rounding to the nearest plate increment can round a non-multiple `weight`
  // UP past it — e.g. 24.9 kg rounds to 25. That would recommend more load
  // right after a failed set. Missed sets only ever move down, so once
  // rounded, step back one increment rather than let the round trip upward.
  if (missed && newWeight > weight) newWeight -= AUTOREG.plateIncrement;
  const delta = Math.round((newWeight - weight) * 100) / 100;
  return {
    delta,
    newWeight,
    verdict: missed ? 'missed the rep floor' : verdictForRpe(rpe, center),
    cls: delta < 0 ? 'bad' : 'good',
  };
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
  const m = String(t || '').match(/(\d+)/);
  return m ? +m[1] : 0;
}

/**
 * The rep target to offer back. The TOP of a range, because a range is written
 * as the ambition with the floor after it — the athlete aims at 10 of "8-10".
 * "5" → "5"; "max"/"" → "" (nothing to suggest).
 */
export function repTopOf(t: string | undefined): string {
  const s = String(t || '');
  const r = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (r) return r[2];
  const m = s.match(/(\d+)/);
  return m ? m[1] : '';
}
