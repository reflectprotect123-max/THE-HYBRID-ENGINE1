import { describe, it, expect, vi } from 'vitest';
import { isBarcodeDetectorSupported, detectBarcode } from './barcodeScanner';

describe('barcodeScanner', () => {
  it('reports unsupported when BarcodeDetector is absent', () => {
    delete (globalThis as any).BarcodeDetector;
    expect(isBarcodeDetectorSupported()).toBe(false);
  });

  it('reports supported when BarcodeDetector is present', () => {
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn();
    expect(isBarcodeDetectorSupported()).toBe(true);
  });

  it('returns the first detected barcode value', async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: '012345678905' }]);
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn().mockImplementation(() => ({ detect }));

    const value = await detectBarcode({} as any);
    expect(value).toBe('012345678905');
  });

  it('returns null when nothing is detected', async () => {
    const detect = vi.fn().mockResolvedValue([]);
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn().mockImplementation(() => ({ detect }));

    const value = await detectBarcode({} as any);
    expect(value).toBeNull();
  });
});
