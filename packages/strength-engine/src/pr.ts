export function detectPr(newSet: { exerciseId: string; reps: number; loadKg: number }, priorBest: number | null): boolean {
  return priorBest == null || newSet.loadKg > priorBest;
}
