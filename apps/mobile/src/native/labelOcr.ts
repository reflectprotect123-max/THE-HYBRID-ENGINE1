import { type OcrLine } from '@hybrid/nutrition-core';

/*
 * The seam between ML Kit's text recogniser and the label parser.
 *
 * `@hybrid/nutrition-core`'s `parseLabelLines` was written for exactly this
 * moment and is fixed by its fixtures, so NOTHING here changes the parser. This
 * file's whole job is to turn what `expo-mlkit-ocr` resolves into what the
 * parser's `OcrLine[]` means, and to refuse the pieces that cannot be turned
 * into it honestly.
 *
 * THE TWO SHAPES DO NOT LINE UP, in three ways:
 *
 *  1. NESTING. ML Kit returns blocks, each holding lines. The parser wants one
 *     flat list, because it groups by vertical position itself. Flattening is
 *     not a loss — it is the point. On a two-column FSANZ panel ML Kit
 *     frequently makes the label column one block and the value column
 *     another, so a block's own reading order pairs "Protein" with "Fat", not
 *     with "3.2 g". Handing the parser every line and letting it re-group by y
 *     is what puts each value back beside its own label.
 *
 *  2. GEOMETRY. ML Kit gives `{x, y, width, height}` — an origin and a size.
 *     The parser wants `{left, top, right, bottom}` — four edges. That is the
 *     arithmetic below, and it is the only arithmetic in this file.
 *
 *  3. THE BOX CAN BE ABSENT. The module's TypeScript declares `boundingBox`
 *     as always present, and its Android source does not honour that: when
 *     ML Kit hands back a null `Rect` the Kotlin resolves `"boundingBox" to
 *     emptyMap()`, so JS receives `{}` with no x, y, width or height. Trusting
 *     the type here would read those as `undefined`, then as `NaN` edges, or —
 *     worse, if they were coerced to zero — as a line sitting at the top-left
 *     corner of the photo, which the parser would group into its topmost row
 *     and could read a value out of. An unplaceable line is DROPPED. That is
 *     the same rule the parser itself obeys: a wrong macro is worse than a
 *     missing one.
 */

/** ML Kit's rectangle: an origin and a size, in image pixels. */
export interface MlkitBoundingBox {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface MlkitTextLine {
  text?: string;
  boundingBox?: MlkitBoundingBox | null;
}

export interface MlkitTextBlock {
  text?: string;
  boundingBox?: MlkitBoundingBox | null;
  lines?: MlkitTextLine[] | null;
}

/**
 * What `recognizeText` resolves to.
 *
 * Declared structurally rather than imported from `expo-mlkit-ocr` on purpose:
 * that import pulls `requireNativeModule('ExpoMlkitOcr')`, which throws at
 * IMPORT time on any build without the native module in it. Keeping the type
 * local means this file, its tests and everything that imports it stay loadable
 * with no native module present. Every field is optional because this is a
 * value that crossed the native bridge, not one this codebase constructed.
 */
export interface MlkitRecognitionResult {
  text?: string;
  blocks?: MlkitTextBlock[] | null;
}

/** Takes a local image URI, resolves the recognised text. */
export type LabelRecogniser = (uri: string) => Promise<MlkitRecognitionResult>;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * One ML Kit line as one `OcrLine`, or null when it cannot be placed.
 *
 * Rejected: no text (or only whitespace); any missing or non-finite edge; and a
 * degenerate box with no height. The height rule is not fussiness — the
 * parser's row tolerance is anchored to the SMALLEST line height it is given,
 * so a single zero-height box collapses that anchor to the 12px floor and, on a
 * photo thousands of pixels tall, stops the real macro rows grouping at all.
 * One junk box would silently turn a good scan into an empty one.
 */
function toOcrLine(line: MlkitTextLine | null | undefined): OcrLine | null {
  if (!line) return null;
  const text = typeof line.text === 'string' ? line.text.trim() : '';
  if (!text) return null;
  const box = line.boundingBox;
  if (!box) return null;
  const { x, y, width, height } = box;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { text, left: x, top: y, right: x + width, bottom: y + height };
}

/**
 * Every recognised line in a result, flattened and re-expressed as edges.
 *
 * Order is left exactly as ML Kit gave it. The parser sorts by vertical centre
 * before it reads anything, so imposing an order here would be a second,
 * weaker sort in front of the real one — and the parser's own comment says why
 * it does not trust OCR order in the first place.
 *
 * A block whose `lines` array is absent or empty contributes nothing, even when
 * the block itself carries text. A block's `text` is its lines joined with
 * newlines, so feeding it in as a single line would hand the parser a "row"
 * containing a label from one line and a number from another — precisely the
 * mis-pairing the positional entry point exists to prevent.
 */
export function toOcrLines(result: MlkitRecognitionResult | null | undefined): OcrLine[] {
  const blocks = result?.blocks;
  if (!Array.isArray(blocks)) return [];
  const lines: OcrLine[] = [];
  for (const block of blocks) {
    if (!Array.isArray(block?.lines)) continue;
    for (const line of block.lines) {
      const mapped = toOcrLine(line);
      if (mapped) lines.push(mapped);
    }
  }
  return lines;
}

/**
 * The real recogniser, loaded only when a photo has actually been taken.
 *
 * `expo-mlkit-ocr` resolves its native module at import time, so a static
 * import would make a missing native module — an old runtime-3 APK, Expo Go,
 * a JS-only test — a hard failure of the whole Food tab rather than of one
 * button. The dynamic import keeps that blast radius to this call, where the
 * screen already has an unreadable-scan path to fall into.
 */
export const recogniseLabel: LabelRecogniser = async (uri) => {
  const mod = (await import('expo-mlkit-ocr')) as { recognizeText: LabelRecogniser };
  return mod.recognizeText(uri);
};
