export type E1rmFormula = 'epley' | 'brzycki';

export function e1rm(loadKg: number, reps: number, formula: E1rmFormula = 'epley'): number {
  if (reps <= 0) throw new Error('e1rm requires reps > 0');
  if (reps === 1) return loadKg;
  if (formula === 'brzycki' && reps < 37) {
    return loadKg * (36 / (37 - reps));
  }
  return loadKg * (1 + reps / 30);
}
