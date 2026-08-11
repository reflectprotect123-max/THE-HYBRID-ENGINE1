// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CachedFood } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { BarcodeScanner } from './BarcodeScanner';

/*
 * BarcodeScanner: camera feed → interval `detectBarcode` polling →
 * `lookupBarcode` → log sheet / not-found / lookup-failed fallback, ported
 * from mobile's `BarcodeScannerScreen`. The camera and detector are exercised
 * through injected `requestStream`/`detect`/`lookup` props (as
 * `LabelReader.test.tsx` injects `recognize`/`requestStream`) — there is no
 * real camera or `BarcodeDetector` in jsdom.
 */

const food = (overrides: Partial<CachedFood> = {}): CachedFood => ({
  id: 'f1',
  name: 'Rolled Oats',
  brand: 'Uncle Toby',
  barcode: '012345678905',
  servingQty: 100,
  servingUnit: 'g',
  calories: 379,
  proteinG: 13.5,
  carbsG: 61.9,
  fatG: 6.9,
  nutritionBasisQty: 100,
  nutritionBasisUnit: 'g',
  servingSizeText: null,
  source: 'catalogue',
  externalId: null,
  nutrients: {},
  servings: [],
  cachedAt: new Date().toISOString(),
  ...overrides,
});

const track = { stop: vi.fn() };
const requestStream = vi.fn().mockResolvedValue({ getTracks: () => [track] } as unknown as MediaStream);

beforeEach(() => {
  localStorage.clear();
  track.stop.mockClear();
  requestStream.mockClear();
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 100 });
});

describe('BarcodeScanner', () => {
  it('an unsupported browser shows a fallback message instead of requesting the camera', () => {
    render(
      <NutritionProvider>
        <BarcodeScanner requestStream={requestStream} />
      </NutritionProvider>,
    );

    expect(screen.getByText("Barcode scanning isn't available")).toBeInTheDocument();
    expect(requestStream).not.toHaveBeenCalled();
  });

  it('a detected barcode looks it up and, on a match, logs through the same entry write as search', async () => {
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn();
    const detect = vi.fn().mockResolvedValue('012345678905');
    const lookup = vi.fn().mockResolvedValue(food());

    render(
      <NutritionProvider>
        <BarcodeScanner requestStream={requestStream} detect={detect} lookup={lookup} />
      </NutritionProvider>,
    );

    await waitFor(() => expect(requestStream).toHaveBeenCalled());

    await waitFor(() => expect(lookup).toHaveBeenCalledWith('012345678905'), { timeout: 2000 });
    expect(await screen.findByText('Rolled Oats')).toBeInTheDocument();
    // The camera is stopped once a result is on screen.
    expect(track.stop).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add to log' }));

    await waitFor(() => {
      const raw = localStorage.getItem(NUTRITION_LS_KEY);
      expect(raw).toBeTruthy();
      const db = JSON.parse(raw as string);
      expect(db.logEntries).toHaveLength(1);
      expect(db.logEntries[0].displayName).toBe('Rolled Oats');
      expect(db.foodCache.map((f: CachedFood) => f.id)).toContain('f1');
    });
  });

  it('a barcode with no catalogue match shows the not-in-catalogue fallback, not a crash', async () => {
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn();
    const detect = vi.fn().mockResolvedValue('999999999999');
    const lookup = vi.fn().mockResolvedValue(null);

    render(
      <NutritionProvider>
        <BarcodeScanner requestStream={requestStream} detect={detect} lookup={lookup} />
      </NutritionProvider>,
    );

    await waitFor(() => expect(requestStream).toHaveBeenCalled());

    expect(await screen.findByText('Not in the catalogue', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText('999999999999')).toBeInTheDocument();
  });

  it('a lookup failure is reported as unreachable, distinct from a genuine miss', async () => {
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn();
    const detect = vi.fn().mockResolvedValue('111111111111');
    const lookup = vi.fn().mockRejectedValue(new Error('network down'));

    render(
      <NutritionProvider>
        <BarcodeScanner requestStream={requestStream} detect={detect} lookup={lookup} />
      </NutritionProvider>,
    );

    await waitFor(() => expect(requestStream).toHaveBeenCalled());

    expect(await screen.findByText('Could not check that barcode', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('a denied camera permission shows a fallback, not a dead end', async () => {
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn();
    const deniedStream = vi.fn().mockRejectedValue(new Error('denied'));

    render(
      <NutritionProvider>
        <BarcodeScanner requestStream={deniedStream} />
      </NutritionProvider>,
    );

    expect(await screen.findByText('Camera access is off')).toBeInTheDocument();
  });
});
