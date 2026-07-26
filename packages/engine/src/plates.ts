/**
 * What to actually put on the bar.
 *
 * Greedy from the heaviest plate, then a second pass one increment up, and
 * whichever total lands closer to the target wins — so a 61kg prescription on
 * 2.5s resolves to 60 rather than silently failing to be loadable. `delta`
 * reports the miss honestly instead of pretending the target was hit, because
 * an athlete adding 1kg of imaginary load every session is a slow-motion
 * measurement error.
 */
export interface PlateResult {
  perSide: number[];
  loadable: boolean;
  delta: number;
  achievableKg: number;
}

export function plateBreakdown(totalKg: number, bar: number, plates: number[]): PlateResult {
  const total = Number(totalKg);
  const b = Number(bar);
  const av = (Array.isArray(plates) ? plates : [])
    .map(Number)
    .filter((p) => p > 0)
    .sort((x, y) => y - x);

  if (!(total > 0) || !(b >= 0) || !av.length) {
    return { perSide: [], loadable: false, delta: 0, achievableKg: b || 0 };
  }

  const perTarget = (total - b) / 2;
  if (perTarget <= 0) {
    const ach = b;
    return {
      perSide: [],
      loadable: Math.abs(total - b) < 1e-9,
      delta: Number((ach - total).toFixed(2)),
      achievableKg: ach,
    };
  }

  const greedy = (t: number): number[] => {
    const out: number[] = [];
    let rem = t;
    for (const p of av) {
      while (rem >= p - 1e-9) {
        out.push(p);
        rem = Number((rem - p).toFixed(4));
      }
    }
    return out;
  };

  const loFront = greedy(perTarget);
  const loPer = loFront.reduce((a, c) => a + c, 0);
  const step = av[av.length - 1]; // smallest plate
  const hiPer = loPer + step; // next loadable increment per side
  const loTot = b + loPer * 2;
  const hiTot = b + hiPer * 2;
  const pickHi = Math.abs(hiTot - total) < Math.abs(loTot - total) - 1e-9;
  const per = pickHi ? greedy(hiPer) : loFront;
  const ach = pickHi ? hiTot : loTot;

  return {
    perSide: per,
    loadable: Math.abs(ach - total) < 1e-9,
    delta: Number((ach - total).toFixed(2)),
    achievableKg: Number(ach.toFixed(2)),
  };
}
