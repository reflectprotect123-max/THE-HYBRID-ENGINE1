/*
 * How a macro is typed in and how it is printed back out — shared by the phone
 * app's nutrition world and the web food log.
 *
 * Lifted out of `apps/mobile/src/screens/nutrition/fields.tsx` in Phase 4, where
 * these five functions were already pure and already the single definition FOR
 * MOBILE. Web logs food into the same slice, so the definitions have to be the
 * same ones: two implementations of `macro()` is two answers to what a typed
 * "-30" means, and the athlete would have logged a different number depending on
 * which device was in their hand.
 */

/**
 * A typed number, whatever decimal mark the keyboard produced.
 *
 * `Number("3,2")` is `NaN`, and every caller here turns `NaN` into 0 or null —
 * so on a comma-decimal locale a correctly typed 3.2 g of protein was stored
 * as 0 and displayed as 0, reading as success. The label parser already
 * accepts a comma decimal deliberately, which made the round trip worse: the
 * reader hands over "3.2", and re-typing it the way the athlete's keyboard
 * writes it zeroed it.
 *
 * A comma is treated as the decimal mark only when it is the ONLY one and is
 * not a thousands group — "1,234" is 1234, "3,2" is 3.2. Nothing else is
 * guessed.
 */
const typedNumber = (s: string): number => {
  const t = s.trim();
  const normalised = /^-?\d+,\d+$/.test(t) && !/^-?\d{1,3},\d{3}$/.test(t)
    ? t.replace(',', '.')
    : t.replace(/,(?=\d{3}(\D|$))/g, '');
  return Number(normalised);
};

/**
 * A typed number, or 0.
 *
 * Negative and non-finite go to 0 rather than through: the sanitizer clamps
 * them on the next load anyway, and a `NaN` written now is a total that reads
 * `NaN kcal` until then.
 */
export const macro = (s: string): number => {
  const n = typedNumber(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A quantity that something will be DIVIDED by, or null when it isn't one. */
export const positiveQty = (s: string): number | null => {
  const n = typedNumber(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const round = (n: number): string => String(Math.round(n));

/** Macros as the app writes them everywhere: rounded, in one line. */
export const macroLine = (m: { calories: number; proteinG: number; carbsG: number; fatG: number }): string =>
  `${round(m.calories)} kcal · ${round(m.proteinG)}P ${round(m.carbsG)}C ${round(m.fatG)}F`;

export const titleCase = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
