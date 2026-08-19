export type E1rmFormula = 'epley' | 'brzycki';

/** Brzycki's denominator is (37 - reps): at 37 it divides by zero and beyond
 * it flips sign. Reps are clamped to this documented ceiling instead of
 * silently switching formula — callers record `formula: 'brzycki'` as
 * provenance (WorkingMaxEvent.formula), and an Epley number filed under a
 * Brzycki label would be a lie about how the estimate was made. */
export const BRZYCKI_MAX_REPS = 36;

export function e1rm(loadKg: number, reps: number, formula: E1rmFormula = 'epley'): number {
  if (reps <= 0) throw new Error('e1rm requires reps > 0');
  if (reps === 1) return loadKg;
  if (formula === 'brzycki') {
    const r = Math.min(reps, BRZYCKI_MAX_REPS);
    return loadKg * (36 / (37 - r));
  }
  return loadKg * (1 + reps / 30);
}
