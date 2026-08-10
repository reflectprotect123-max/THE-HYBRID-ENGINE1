/*
 * Reading an Australian nutrition information panel into macros.
 *
 * Ported from MacroTrack's `domain/NutritionLabelParser.kt` and its 12 JUnit
 * fixtures. The Kotlin original was deliberately written with ZERO Android or
 * ML-Kit imports so it could be unit-tested against plain fixtures; that
 * property is the whole reason this file survives the camera decision. The
 * OCR engine is a native module this workspace cannot currently build (see
 * `screens/nutrition/LabelScanner.tsx`), but the parse is pure, and the parse
 * is the part that took the fixtures to get right.
 *
 * TWO ENTRY POINTS, ONE READER.
 *
 *  - `parseLabelLines` takes positioned lines, as an OCR pass produces them.
 *    Nothing in this repo calls it yet; it is what a future camera hands in,
 *    and it is tested so that day is a wiring job rather than a rewrite.
 *  - `parseLabelText` takes the panel as plain text, as a human types or
 *    pastes it. This is what ships now.
 *
 * Both reduce to rows of CELLS and run the same reader, so the manual path
 * cannot drift from the camera path.
 *
 * THE RULE THE WHOLE FILE OBEYS: a field this cannot read is left null. It is
 * never guessed, never carried over from a neighbouring row, never defaulted.
 * A wrong macro is worse than a blank one, because a blank one gets typed and
 * a wrong one gets eaten.
 */

/** One recognized line of text and its bounding box, in image pixels. */
export interface OcrLine {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * What the values read from the panel are FOR.
 *
 * An FSANZ panel is two columns — "per serving" then "per 100 g" — and the
 * reader takes the leftmost value cell. On a panel that prints only the
 * 100 g column, that same leftmost cell is a per-100g figure, and storing it
 * as a serving's macros would be wrong by however large the serving is. So
 * the basis is reported rather than assumed, and the caller decides.
 */
export type LabelBasis = 'per_serving' | 'per_100' | 'unknown';

export interface ParsedNutritionLabel {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  /** From a "Serving size" line, when the panel states one. */
  servingQty: number | null;
  servingUnit: string | null;
  /** What the macros above are measured against — see `LabelBasis`. */
  basis: LabelBasis;
  /**
   * True when at least one macro came from a "less than 1 g" row and was read
   * as 0. The caller must say so; silently rounding down is the kind of quiet
   * inaccuracy this parser exists to avoid.
   */
  roundedDown: boolean;
}

const EMPTY: ParsedNutritionLabel = {
  calories: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  servingQty: null,
  servingUnit: null,
  basis: 'unknown',
  roundedDown: false,
};

/** Nothing was recognized — the caller should say so rather than show zeroes. */
export function isEmptyLabel(p: ParsedNutritionLabel): boolean {
  return (
    p.calories == null && p.proteinG == null && p.carbsG == null && p.fatG == null && p.servingQty == null && p.servingUnit == null
  );
}

/**
 * Kilojoules per kilocalorie.
 *
 * The same constant the AUSNUT/OFF import pipeline uses (`seed_common.py`'s
 * `KJ_PER_KCAL`), kept identical on purpose: a food read off a label and the
 * same food read out of the catalogue must not differ by a rounding choice.
 */
const KJ_PER_KCAL = 4.184;

/* ---------- the reader, shared by both entry points ---------- */

/** A row of the panel, left to right. Cell 0 is the label, cell 1 the value. */
type Row = string[];

/**
 * Where a label ends and its value begins on ONE cell holding both.
 *
 * A person copying a panel types "Protein 3.2 g", not two aligned columns, so
 * the split cannot be "two or more spaces" the way an aligned paste would
 * allow. The split is instead at the first digit that begins a number, which
 * is unambiguous here because no macro NAME contains a digit — "per 100g" is
 * a heading, not a macro row, and never reaches the reader as a label.
 *
 * This lives with the READER, not with the typed entry point, because OCR
 * produces exactly the same shape: ML Kit merges a row's label and its value
 * onto one baseline routinely. Both doors need it, so both doors use this.
 */
const LABEL_VALUE_SPLIT = /^([^\d<]*?)\s*((?:<|less\s+than\b).*|\d.*)$/i;

/**
 * A label cell that carries its own value.
 *
 * ML Kit groups "words on one baseline", so on a tightly-set panel a row's
 * label and its per-serving figure come back as ONE line — "Protein 3.2 g" —
 * while the per-100 figure sits in its own line beside it. Matching the label
 * and then reading cell 1 takes the per-100 number and reports it as a
 * serving's worth: a 3x overstatement printed with full confidence, which is
 * this file's worst failure mode.
 *
 * So a label cell is checked for its own number FIRST, and when it has one
 * that number is the value — the cell beside it is the NEXT column, not this
 * row's value, and is ignored. The same helper is what lets a merged line with
 * no second cell at all parse in the camera path, which used to be skipped
 * entirely while the identical text typed by hand read fine.
 *
 * The split is `LABEL_VALUE_SPLIT`, the one the typed path already used — one
 * rule for both doors rather than two that can drift.
 */
function splitLabelCell(cell: string): { label: string; value: string } | null {
  const m = LABEL_VALUE_SPLIT.exec(cell.trim());
  if (!m) return null;
  const label = m[1].trim();
  /* Nothing before the number: this is a bare value cell, not a merged row. */
  if (!label) return null;
  return { label, value: m[2].trim() };
}

/**
 * How many VALUE columns the panel's own headings say it prints.
 *
 * The reader takes the leftmost value cell, which is only the per-serving
 * figure if the per-serving column was actually captured. A single faint or
 * clipped cell — a "<1 g" that did not OCR, a slightly cropped left column —
 * leaves the per-100 figure as the only survivor, and taking it silently
 * promotes a wrong-but-plausible number into a "per serving" reading.
 *
 * Counting the headings gives the row an expectation to be checked against: a
 * two-column panel must hand the reader two value cells before cell 1 can be
 * trusted as the per-serving one. A row that cannot cover its own columns is
 * left null, which is the rule the whole file obeys.
 */
function valueColumnCount(texts: readonly string[]): number {
  const joined = texts.map(norm).join(' | ');
  let columns = 0;
  if (/per\s*serv/.test(joined)) columns += 1;
  if (/per\s*100\s*(?:g|ml)/.test(joined)) columns += 1;
  return Math.max(1, columns);
}

function readRows(rows: readonly Row[], texts: readonly string[]): ParsedNutritionLabel {
  let calories: number | null = null;
  let proteinG: number | null = null;
  let fatG: number | null = null;
  let carbsG: number | null = null;
  let roundedDown = false;

  const columns = valueColumnCount(texts);

  for (const row of rows) {
    const cell = row[0];
    if (cell == null) continue;
    const merged = splitLabelCell(cell);
    const label = merged ? merged.label : cell;
    /* A merged cell is self-contained and fully resolved. Otherwise cell 1 is
       only this row's value when the row carries as many value cells as the
       headings promise. */
    const value = merged ? merged.value : row.length - 1 >= columns ? row[1] : undefined;
    if (value == null) continue;
    /* First match wins per macro. The total row is printed above its own
       sub-rows on every FSANZ panel, so the first "fat" row that is not the
       saturated one is the total — and once a total is read, a later row can
       no longer overwrite it. */
    if (calories == null && isEnergyLabel(label)) {
      calories = parseEnergyKcal(value);
    } else if (proteinG == null && isProteinLabel(label)) {
      const n = parseMacroCell(value);
      proteinG = n.value;
      roundedDown = roundedDown || n.roundedDown;
    } else if (fatG == null && isFatTotalLabel(label)) {
      const n = parseMacroCell(value);
      fatG = n.value;
      roundedDown = roundedDown || n.roundedDown;
    } else if (carbsG == null && isCarbTotalLabel(label)) {
      const n = parseMacroCell(value);
      carbsG = n.value;
      roundedDown = roundedDown || n.roundedDown;
    }
  }

  return {
    calories,
    proteinG,
    carbsG,
    fatG,
    servingQty: null,
    servingUnit: null,
    basis: 'unknown',
    roundedDown,
  };
}

/* ---------- row labels ---------- */

const norm = (s: string): string => s.trim().toLowerCase();

const isEnergyLabel = (t: string): boolean => norm(t).startsWith('energy');
const isProteinLabel = (t: string): boolean => norm(t).startsWith('protein');

/**
 * "Fat" but not "saturated fat".
 *
 * Both the dash convention ("- saturated") and the comma convention
 * ("Fat, saturated") appear on real AU labels, and both start with something
 * this has to tell apart from the total. Excluding the word rather than
 * matching an exact string is what covers both, plus "Fat — saturated" and
 * whatever else a printer does with the dash.
 */
function isFatTotalLabel(t: string): boolean {
  const n = norm(t);
  return n.startsWith('fat') && !n.includes('saturat');
}

/** The same guard, against the sugars sub-row. */
function isCarbTotalLabel(t: string): boolean {
  const n = norm(t);
  return n.startsWith('carbohydrate') && !n.includes('sugar');
}

/* ---------- numbers ---------- */

/**
 * A decimal, in either separator.
 *
 * Australian labels print "3.2 g", but OCR reads a full stop as a comma often
 * enough — and enough European imports are stocked here printing "3,2 g" —
 * that refusing the comma form loses real rows. The comma is only taken as a
 * decimal point when exactly one or two digits follow it, so a thousands
 * separator ("1,234 kJ") is not silently turned into 1.234.
 */
const DECIMAL = String.raw`\d+(?:[.,]\d+)?`;

const NUMBER = new RegExp(`(${DECIMAL})(?![\\d])`);

/**
 * A matched numeric token, or null when its shape is not one a panel prints.
 *
 * The fractional part is captured WHOLE and then refused if it is longer than
 * two digits, rather than the regex allowing only `\d{1,2}` there. With the
 * bounded form the engine simply backtracked past the fraction: "3.256 g"
 * failed to match ".256", dropped the optional group and matched "3" — the
 * label's own protein figure silently truncated to a plausible wrong number.
 * Refusing an unreadable form is the policy; guessing at one is not.
 */
const toNumber = (raw: string): number | null => {
  const text = raw.replace(',', '.');
  const fraction = text.split('.')[1];
  if (fraction != null && fraction.length > 2) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/**
 * Drop a thousands separator before anything reads it as a decimal point or
 * as the end of a number.
 *
 * The lookahead is `\d{3}(?!\d)` and NOT `\d{3}\b`: on a label the digits are
 * followed immediately by their unit — "1,733kJ" — and `\b` never fires
 * between "3" and "k" because both are word characters. With the boundary
 * form the comma survived, the decimal branch then matched ",73", and
 * 1,733 kJ was read as 733 kJ: energy understated by more than half, on a
 * figure that still looked plausible.
 *
 * BOTH separators, because Australian panels print both. A SPACE-grouped
 * "1 733 kJ" is the SI convention and appears on real packets; handling only
 * the comma left exactly the same defect standing — the reader took the
 * digits after the space and called it 733 kJ. A thin/non-breaking space is
 * included: OCR of a printed panel returns U+00A0 and U+202F routinely, and
 * they are invisible in a diff.
 *
 * Only groups of exactly three digits are joined, so "Serves 4 220 g packs"
 * is untouched and a genuine two-number sequence is not silently fused.
 */
const stripThousands = (text: string): string =>
  text.replace(/(\d)[,    ](?=\d{3}(?!\d))/g, '$1');

const firstNumber = (text: string): number | null => {
  const m = NUMBER.exec(stripThousands(text));
  return m ? toNumber(m[1]) : null;
};

/**
 * "Less than 1 g", in the forms a panel and an OCR pass produce.
 *
 * FSANZ permits a quantity below 1 g to be declared as "LESS THAN 1 g"
 * instead of a figure, so on some panels this is the only thing printed in
 * the cell. Read as 0 — the closest true statement the label supports — and
 * flagged, because it errs low by up to 1 g and the athlete is entitled to
 * know which number the panel refused to give.
 */
const LESS_THAN = /^\s*(?:<|less\s+than\b)/i;

function parseMacroCell(cell: string): { value: number | null; roundedDown: boolean } {
  if (LESS_THAN.test(cell)) return { value: 0, roundedDown: true };
  return { value: firstNumber(cell), roundedDown: false };
}

/**
 * Energy, preferring calories and converting kilojoules when that is all
 * there is.
 *
 * kJ is the AU default and the figure printed largest; "124Cal (520kJ)" is
 * the common dual form. Taking Cal when present and converting otherwise
 * means a kJ-only panel — the majority here — still yields calories rather
 * than nothing.
 */
function parseEnergyKcal(cell: string): number | null {
  const lower = stripThousands(cell.toLowerCase());
  const cal = new RegExp(`(${DECIMAL})\\s*(?:kcal|cal)\\b`).exec(lower);
  if (cal) return toNumber(cal[1]);
  const kj = new RegExp(`(${DECIMAL})\\s*kj\\b`).exec(lower);
  if (!kj) return null;
  const v = toNumber(kj[1]);
  return v == null ? null : v / KJ_PER_KCAL;
}

/* ---------- serving size ---------- */

const SERVING_SIZE = new RegExp(`(${DECIMAL})\\s*(kg|mg|ml|g|l)\\b`, 'i');

/**
 * The serving denominator, from the panel's own "Serving size" line.
 *
 * The parenthesised part wins when it holds a MASS OR VOLUME: "Serving size:
 * 2 biscuits (30g)" has two numbers in it and only the second is one. It does
 * not win merely for existing — a drink label flips the pattern, printing
 * "250 mL (1 cup)", and letting the bracket win there threw away the only
 * usable figure on the line and returned no serving size at all.
 *
 * So the bracket is tried first and, when it holds nothing measurable, the
 * text OUTSIDE the brackets is read instead — with the bracket removed rather
 * than the whole line scanned, so "2 biscuits (1 cup)" still yields nothing
 * instead of finding a number in the part already rejected.
 */
function parseServingSize(texts: readonly string[]): { qty: number; unit: string } | null {
  const line = texts.find((t) => norm(t).includes('serving size'));
  if (!line) return null;
  const paren = /\(([^)]*)\)/.exec(line);
  const outside = line.replace(/\([^)]*\)/g, ' ');
  const m = (paren ? SERVING_SIZE.exec(stripThousands(paren[1])) : null) ?? SERVING_SIZE.exec(stripThousands(outside));
  if (!m) return null;
  const qty = toNumber(m[1]);
  return qty == null ? null : { qty, unit: m[2].toLowerCase() };
}

/* ---------- basis ---------- */

/**
 * Which column the reader just took.
 *
 * The reader always takes the leftmost value cell. On the standard two-column
 * panel that is the per-serving column, which is what MacroTrack chose and
 * what an athlete logging one serving wants. On a panel printing only
 * "per 100 g", the leftmost cell is a per-100g figure — detectable because
 * the 100 g heading appears with no serving heading anywhere.
 *
 * ORDER MATTERS, and it used to be wrong. "Servings per package" is printed on
 * EVERY FSANZ panel, including ones with only a per-100 column, and it was
 * treated as evidence of a per-serving column ahead of the per-100 heading —
 * so a per-100-only panel was classified `per_serving` and its macros stored
 * as one serving's worth. That is exactly the failure `basis` was added to
 * prevent. "Per serving" is a real column heading and still decides first; the
 * package line is now only a last resort, used when no per-100 heading was
 * read at all.
 */
function detectBasis(texts: readonly string[]): LabelBasis {
  const joined = texts.map(norm).join(' | ');
  if (/per\s*serv/.test(joined)) return 'per_serving';
  if (/per\s*100\s*(?:g|ml)/.test(joined)) return 'per_100';
  if (/servings?\s*per\s*pack/.test(joined)) return 'per_serving';
  return 'unknown';
}

/* ---------- entry point: positioned OCR lines ---------- */

/**
 * A row's worth of vertical slop, scaled to the panel's own line height.
 *
 * A fixed pixel tolerance only makes sense at one photo resolution, and a
 * still of a label can be thousands of pixels tall. The MINIMUM line height
 * is the anchor, not the median: a photo picks up as much unrelated, much
 * taller text (a brand name, an ingredients list) as there are lines in the
 * macro table, and once those are half the lines a median-based tolerance
 * grows wide enough to chain-merge separate macro rows into one and read a
 * value from the wrong row. The table's own text is the smallest, most
 * tightly set text on the panel, so the minimum stays tied to the table.
 */
const MIN_ROW_TOLERANCE_PX = 12;

function rowTolerance(lines: readonly OcrLine[]): number {
  if (!lines.length) return MIN_ROW_TOLERANCE_PX;
  const minHeight = Math.min(...lines.map((l) => l.bottom - l.top));
  return Math.max(MIN_ROW_TOLERANCE_PX, minHeight * 0.5);
}

const centre = (l: OcrLine): number => (l.top + l.bottom) / 2;

/**
 * Parse positioned OCR lines.
 *
 * Grouped by vertical position FIRST, then read left to right within a row.
 * OCR does not promise to return lines in reading order, and pairing a label
 * with a value by text order alone silently reads the wrong number.
 *
 * A row may come back as a single merged cell — ML Kit groups words on one
 * baseline, so "Protein 3.2 g" is one line, not two. The reader splits such a
 * cell itself, with the same rule the typed path uses; this path no longer
 * skips those rows as unreadable.
 */
export function parseLabelLines(lines: readonly OcrLine[]): ParsedNutritionLabel {
  if (!lines.length) return EMPTY;
  const tolerance = rowTolerance(lines);
  const sorted = [...lines].sort((a, b) => centre(a) - centre(b));
  const grouped: OcrLine[][] = [];
  for (const line of sorted) {
    const current = grouped[grouped.length - 1];
    const rowCentre = current ? current.reduce((s, l) => s + centre(l), 0) / current.length : null;
    if (current && rowCentre != null && Math.abs(centre(line) - rowCentre) <= tolerance) current.push(line);
    else grouped.push([line]);
  }
  const rows = grouped.map((row) => [...row].sort((a, b) => a.left - b.left).map((l) => l.text));
  const texts = lines.map((l) => l.text);
  return finish(readRows(rows, texts), texts);
}

/* ---------- entry point: typed or pasted text ---------- */

/**
 * Parse a nutrition panel typed or pasted as plain text.
 *
 * Tabs and runs of two or more spaces are treated as column breaks, so a paste
 * that preserved the panel's columns keeps them. A line with no such break is
 * handed to the reader as ONE cell and split there, by the same
 * `LABEL_VALUE_SPLIT` the camera path now uses for a merged OCR line — the
 * splitting lives in one place so the two doors cannot drift.
 */
export function parseLabelText(text: string): ParsedNutritionLabel {
  const texts = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!texts.length) return EMPTY;
  const rows: Row[] = texts.map((line) => line.split(/\t+| {2,}/).map((c) => c.trim()).filter(Boolean));
  return finish(readRows(rows, texts), texts);
}

/** Serving size and basis are read from whole lines, not from table cells. */
function finish(read: ParsedNutritionLabel, texts: readonly string[]): ParsedNutritionLabel {
  const serving = parseServingSize(texts);
  return {
    ...read,
    servingQty: serving?.qty ?? null,
    servingUnit: serving?.unit ?? null,
    basis: detectBasis(texts),
  };
}
