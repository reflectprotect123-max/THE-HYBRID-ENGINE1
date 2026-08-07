/*
 * Numeric primitives chosen for bit-for-bit parity with the Python reference
 * (`adaptive_engine.py` in `reflectprotect123-max/thehybridsystem`), not for
 * convenience. Both languages use IEEE-754 doubles, so the two engines can
 * agree exactly — but only if the *order and kind* of every rounding matches.
 *
 * Two places where the naive JS translation silently diverges:
 *
 *   1. `statistics.fmean` sums with `math.fsum` (exact, correctly rounded),
 *      not with a left-to-right `sum`. A naive `reduce((a, b) => a + b)`
 *      differs in the last ulp on ordinary intake data, which then multiplies
 *      through `kcal_per_kg = 7700` into a visible calorie difference.
 *   2. `round(x, 1)` is round-half-EVEN on the exact binary value of the
 *      double. `Math.round(x * 10) / 10` is half-up *and* scales through a
 *      lossy multiply; `toFixed` is half-up. `macro_targets` divides by 4, so
 *      exact `.x25`/`.x75` ties are routine, not theoretical.
 */

/**
 * Shewchuk exact summation — the algorithm CPython's `math.fsum` implements,
 * including its half-even correction on the final partial. Ported faithfully
 * because an "accurate enough" variant defeats the point of the parity gate.
 */
export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  let count = 0;

  for (const value of values) {
    let x = value;
    let index = 0;
    for (let j = 0; j < count; j += 1) {
      let y = partials[j] as number;
      if (Math.abs(x) < Math.abs(y)) {
        const swap = x;
        x = y;
        y = swap;
      }
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) {
        partials[index] = lo;
        index += 1;
      }
      x = hi;
    }
    partials[index] = x;
    count = index + 1;
  }

  if (count === 0) {
    return 0;
  }

  // Sum the partials from the top, stopping as soon as the running total stops
  // being exact; then apply CPython's round-half-even fixup for the tie case.
  let n = count - 1;
  let hi = partials[n] as number;
  let lo = 0;
  while (n > 0) {
    n -= 1;
    const x = hi;
    const y = partials[n] as number;
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) {
      break;
    }
  }
  if (n > 0 && ((lo < 0 && (partials[n - 1] as number) < 0) || (lo > 0 && (partials[n - 1] as number) > 0))) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) {
      hi = x;
    }
  }
  return hi;
}

/** `statistics.fmean`: `fsum(data) / n`. Throws on empty input, as Python does. */
export function fmean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('fmean requires at least one data point');
  }
  return fsum(values) / values.length;
}

/** Python's plain builtin `sum`: left-to-right, deliberately NOT compensated. */
export function naiveSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

const bits = new DataView(new ArrayBuffer(8));

/**
 * Python's `round(value, digits)`: round the EXACT value of the double to
 * `digits` decimal places, ties to even, then take the nearest double to that
 * decimal. Done in BigInt so no intermediate float scaling can perturb the
 * digit being decided, and parsed back via `Number(string)` so the decimal to
 * double step is the spec's correctly-rounded conversion.
 */
export function pyRound(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }
  const negative = value < 0;
  bits.setFloat64(0, Math.abs(value));
  const high = bits.getUint32(0);
  const low = bits.getUint32(4);
  const rawExponent = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);

  // exact magnitude = mantissa * 2 ** exponent
  const mantissa = rawExponent === 0 ? fraction : fraction | (1n << 52n);
  const exponent = rawExponent === 0 ? -1074 : rawExponent - 1075;

  // Rewrite as an exact decimal numerator over 10 ** fractionDigits: a
  // negative binary exponent contributes exactly that many decimal digits,
  // because 2**-k == 5**k / 10**k.
  let numerator: bigint;
  let fractionDigits: number;
  if (exponent >= 0) {
    numerator = mantissa << BigInt(exponent);
    fractionDigits = 0;
  } else {
    numerator = mantissa * 5n ** BigInt(-exponent);
    fractionDigits = -exponent;
  }

  let scaled: bigint;
  if (fractionDigits <= digits) {
    scaled = numerator * 10n ** BigInt(digits - fractionDigits);
  } else {
    const divisor = 10n ** BigInt(fractionDigits - digits);
    const quotient = numerator / divisor;
    const remainder = (numerator % divisor) * 2n;
    const roundUp = remainder > divisor || (remainder === divisor && (quotient & 1n) === 1n);
    scaled = roundUp ? quotient + 1n : quotient;
  }

  return Number((negative ? '-' : '') + decimalString(scaled, digits));
}

function decimalString(scaled: bigint, digits: number): string {
  if (digits <= 0) {
    return scaled.toString();
  }
  const padded = scaled.toString().padStart(digits + 1, '0');
  return `${padded.slice(0, padded.length - digits)}.${padded.slice(padded.length - digits)}`;
}

/** `max(low, min(high, value))` — the reference's clamp, argument order kept. */
export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
