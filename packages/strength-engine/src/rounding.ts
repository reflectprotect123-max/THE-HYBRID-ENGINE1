import type { Equipment } from './exercise';

export function roundLoadToEquipment(value: number, equipment: Equipment | null): number {
  // A non-finite load is a malformed input, never a roundable one: NaN makes
  // every rack comparison false, so the filter/reduce path would silently
  // answer with the lightest plate on the rack. Throw at the boundary instead.
  if (!Number.isFinite(value)) {
    throw new Error(`roundLoadToEquipment requires a finite load, got: ${value}`);
  }
  if (!equipment) return value;
  // 'none' means exactly that — no rack snap, no increment math. It used to
  // fall into the 'down' branches and floor anyway.
  if (equipment.rounding === 'none') return value;
  if (equipment.rackValuesKg?.length) {
    if (equipment.rounding === 'nearest') {
      return equipment.rackValuesKg.reduce((closest, v) =>
        Math.abs(v - value) < Math.abs(closest - value) ? v : closest
      );
    }
    // For 'down', snap to the highest value <= input, or lowest if none qualify
    const below = equipment.rackValuesKg.filter(v => v <= value);
    if (below.length) {
      return Math.max(...below);
    }
    return equipment.rackValuesKg[0];
  }
  // A zero or negative increment cannot step anywhere — division by it yields
  // NaN or a sign flip. Treat it like the absent increment above (the file's
  // existing forgiving style) rather than throwing on stored equipment data.
  if (equipment.incrementKg == null || equipment.incrementKg <= 0) return value;
  const steps = equipment.rounding === 'nearest'
    ? Math.round(value / equipment.incrementKg)
    : Math.floor(value / equipment.incrementKg);
  return Number((steps * equipment.incrementKg).toFixed(6));
}
