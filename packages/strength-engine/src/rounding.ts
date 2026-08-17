import type { Equipment } from './exercise';

export function roundToIncrement(value: number, equipment: Equipment | null): number {
  if (!equipment) return value;
  if (equipment.rackValuesKg?.length) {
    if (equipment.rounding === 'nearest') {
      return equipment.rackValuesKg.reduce((closest, v) =>
        Math.abs(v - value) < Math.abs(closest - value) ? v : closest
      );
    }
    // For 'down' or 'none', snap to the highest value <= input, or lowest if none qualify
    const below = equipment.rackValuesKg.filter(v => v <= value);
    if (below.length) {
      return Math.max(...below);
    }
    return equipment.rackValuesKg[0];
  }
  if (equipment.incrementKg == null) return value;
  const steps = equipment.rounding === 'nearest'
    ? Math.round(value / equipment.incrementKg)
    : Math.floor(value / equipment.incrementKg);
  return Number((steps * equipment.incrementKg).toFixed(6));
}
