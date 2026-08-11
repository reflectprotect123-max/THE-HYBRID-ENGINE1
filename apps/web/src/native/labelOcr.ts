import { createWorker } from 'tesseract.js';
import type { OcrLine } from '@hybrid/nutrition-core';

/*
 * The seam between tesseract.js's text recogniser and the label parser.
 *
 * `@hybrid/nutrition-core`'s `parseLabelLines` was written for exactly this
 * moment and is fixed by its fixtures, so NOTHING here changes the parser.
 * This file's whole job is to turn what `tesseract.js` resolves into what the
 * parser's `OcrLine[]` means, and to refuse the pieces that cannot be turned
 * into it honestly — the same rule mobile's `native/labelOcr.ts` (ML Kit)
 * applies to its own recogniser's output.
 *
 * THE SHAPES DO NOT LINE UP, in the same three ways mobile's file documents:
 *
 *  1. NESTING. tesseract.js returns a page of blocks, each holding
 *     paragraphs, each holding lines. The parser wants one flat list, because
 *     it groups by vertical position itself. Flattening is not a loss — a
 *     two-column FSANZ panel can put a label in one block's reading order and
 *     its value in another's, so handing the parser every line and letting it
 *     re-group by y is what puts each value back beside its own label.
 *
 *  2. GEOMETRY. tesseract.js gives `{x0, y0, x1, y1}` — already four edges,
 *     unlike ML Kit's origin-and-size — so no arithmetic is needed here, only
 *     a rename to the parser's `{left, top, right, bottom}`.
 *
 *  3. THE BOX CAN BE ABSENT OR DEGENERATE. A line with no bounding box, a
 *     non-finite edge, or a zero-area box is DROPPED rather than trusted —
 *     the same rule mobile's `toOcrLine` obeys, and for the same reason: a
 *     wrong macro is worse than a missing one, and a single zero-height line
 *     would collapse the parser's row-tolerance anchor.
 *
 * BLOCKS OUTPUT IS OPT-IN. tesseract.js's top-level `recognize()` convenience
 * function cannot request it (it forwards no `output` argument to the
 * worker), so this file uses `createWorker` + `worker.recognize(image, {},
 * { blocks: true })` directly, and terminates the worker itself. Using the
 * top-level function would silently recognise text with no bounding boxes at
 * all, which `parseLabelLines` cannot use.
 */

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

interface TesseractBbox {
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}

interface TesseractLine {
  text?: string;
  bbox?: TesseractBbox | null;
}

interface TesseractParagraph {
  lines?: TesseractLine[] | null;
}

interface TesseractBlock {
  paragraphs?: TesseractParagraph[] | null;
}

/** One tesseract.js line as one `OcrLine`, or null when it cannot be placed. */
function toOcrLine(line: TesseractLine | null | undefined): OcrLine | null {
  if (!line) return null;
  const text = typeof line.text === 'string' ? line.text.trim() : '';
  if (!text) return null;
  const box = line.bbox;
  if (!box) return null;
  const { x0, y0, x1, y1 } = box;
  if (!finite(x0) || !finite(y0) || !finite(x1) || !finite(y1)) return null;
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { text, left: x0, top: y0, right: x1, bottom: y1 };
}

/** Every recognised line in a page, flattened out of blocks and paragraphs. */
function toOcrLines(blocks: TesseractBlock[] | null | undefined): OcrLine[] {
  if (!Array.isArray(blocks)) return [];
  const lines: OcrLine[] = [];
  for (const block of blocks) {
    if (!Array.isArray(block?.paragraphs)) continue;
    for (const paragraph of block.paragraphs) {
      if (!Array.isArray(paragraph?.lines)) continue;
      for (const line of paragraph.lines) {
        const mapped = toOcrLine(line);
        if (mapped) lines.push(mapped);
      }
    }
  }
  return lines;
}

/**
 * Recognise a photographed nutrition panel entirely on-device (tesseract.js
 * runs as WASM in a Web Worker; nothing is uploaded).
 *
 * A fresh worker per call, terminated in `finally`, mirrors the recogniser's
 * own recommended usage for one-off jobs and keeps this file free of
 * cross-call worker state a test would otherwise have to reset.
 */
export async function recognizeLabel(imageSource: Blob | ImageBitmap): Promise<OcrLine[]> {
  const worker = await createWorker('eng');
  try {
    const result = await worker.recognize(imageSource as never, {}, { blocks: true });
    const blocks = (result.data as { blocks?: TesseractBlock[] | null }).blocks;
    return toOcrLines(blocks);
  } finally {
    await worker.terminate();
  }
}

export type { OcrLine };
