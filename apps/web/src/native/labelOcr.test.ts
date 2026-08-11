import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Mocks `createWorker`, not the top-level `recognize()` convenience function.
 *
 * tesseract.js's `recognize()` cannot request bounding-box output — it
 * forwards no `output` argument to the worker, so blocks output stays off by
 * default and every line would come back with no box at all. This file's
 * implementation therefore drives `createWorker` + `worker.recognize(image,
 * {}, { blocks: true })` directly, so the test doubles that shape rather than
 * the convenience function.
 */
const recognizeMock = vi.fn();
const terminateMock = vi.fn().mockResolvedValue(undefined);
const createWorkerMock = vi.fn().mockResolvedValue({ recognize: recognizeMock, terminate: terminateMock });

vi.mock('tesseract.js', () => ({
  createWorker: (...args: unknown[]) => createWorkerMock(...args),
}));

import { recognizeLabel } from './labelOcr';

const page = (blocks: unknown) => ({ data: { blocks } });

beforeEach(() => {
  recognizeMock.mockReset();
  terminateMock.mockClear();
  createWorkerMock.mockClear();
});

describe('recognizeLabel', () => {
  it('flattens blocks/paragraphs/lines into OcrLine, dropping lines with no usable bounding box', async () => {
    recognizeMock.mockResolvedValue(
      page([
        {
          paragraphs: [
            {
              lines: [
                { text: 'Protein 20g', bbox: { x0: 0, y0: 10, x1: 100, y1: 20 } },
                { text: '', bbox: { x0: 0, y0: 30, x1: 50, y1: 40 } }, // blank text, dropped
                { text: 'No box', bbox: null }, // no bounding box, dropped
                { text: 'Zero area', bbox: { x0: 5, y0: 5, x1: 5, y1: 5 } }, // degenerate box, dropped
              ],
            },
          ],
        },
      ]),
    );

    const lines = await recognizeLabel(new Blob());

    expect(lines).toEqual([{ text: 'Protein 20g', left: 0, top: 10, right: 100, bottom: 20 }]);
  });

  it('returns nothing when the page has no blocks', async () => {
    recognizeMock.mockResolvedValue(page(null));

    const lines = await recognizeLabel(new Blob());

    expect(lines).toEqual([]);
  });

  it('always terminates the worker, even when recognition throws', async () => {
    recognizeMock.mockRejectedValue(new Error('boom'));

    await expect(recognizeLabel(new Blob())).rejects.toThrow('boom');

    expect(terminateMock).toHaveBeenCalledTimes(1);
  });
});
