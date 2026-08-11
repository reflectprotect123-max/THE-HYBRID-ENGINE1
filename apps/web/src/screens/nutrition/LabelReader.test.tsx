// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { LabelReader } from './LabelReader';

/*
 * LabelReader: capture → recognize → prefill macro form → manual-entry
 * fallback, ported from mobile's `LabelReaderScreen`. The camera path is
 * exercised through the injected `recognize`/`requestStream` props (as
 * `RecipeBuilder.test.tsx` injects `search`) — there is no real camera in
 * jsdom.
 */

beforeEach(() => {
  localStorage.clear();
});

describe('LabelReader', () => {
  it('typing a panel and using it pre-fills the save form, which writes a custom food', async () => {
    render(
      <NutritionProvider>
        <LabelReader />
      </NutritionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Nutrition panel text'), {
      target: { value: 'Serving size: 30g\nEnergy 520kJ\nProtein 3.2g\nFat, total 2.1g\nCarbohydrate 15.6g' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use these numbers' }));

    // Pre-filled from the parse, still editable.
    const calories = screen.getByLabelText('Calories') as HTMLInputElement;
    expect(Number(calories.value)).toBeCloseTo(124.3, 1);
    expect((screen.getByLabelText('Protein g') as HTMLInputElement).value).toBe('3.2');
    expect((screen.getByLabelText('Serving size') as HTMLInputElement).value).toBe('30');

    fireEvent.change(screen.getByLabelText('Food name'), { target: { value: 'Test Bar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save food' }));

    await waitFor(() => {
      const raw = localStorage.getItem(NUTRITION_LS_KEY);
      expect(raw).toBeTruthy();
      const db = JSON.parse(raw as string);
      expect(db.customFoods).toHaveLength(1);
      expect(db.customFoods[0].name).toBe('Test Bar');
      expect(db.customFoods[0].proteinG).toBe(3.2);
    });
  });

  it('the "Use these numbers" button stays disabled until the typed text parses to something', () => {
    render(
      <NutritionProvider>
        <LabelReader />
      </NutritionProvider>,
    );

    expect(screen.getByRole('button', { name: 'Use these numbers' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Nutrition panel text'), { target: { value: 'Protein 3.2g' } });

    expect(screen.getByRole('button', { name: 'Use these numbers' })).not.toBeDisabled();
  });

  it('a successful scan recognizes the panel and pre-fills the form via parseLabelLines', async () => {
    const recognize = vi.fn().mockResolvedValue([
      { text: 'Protein 3.2g', left: 0, top: 10, right: 100, bottom: 20 },
      { text: 'Fat, total 2.1g', left: 0, top: 30, right: 100, bottom: 40 },
      { text: 'Carbohydrate 15.6g', left: 0, top: 50, right: 100, bottom: 60 },
    ]);
    const track = { stop: vi.fn() };
    const requestStream = vi.fn().mockResolvedValue({ getTracks: () => [track] } as unknown as MediaStream);

    // Give the captured video element real dimensions so `captureFrame` can produce a frame.
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 100 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: 100 });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['x'])));

    render(
      <NutritionProvider>
        <LabelReader recognize={recognize} requestStream={requestStream} />
      </NutritionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Scan the panel' }));
    await waitFor(() => expect(requestStream).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: 'Read this panel' }));

    await waitFor(() => expect(recognize).toHaveBeenCalled());
    expect(await screen.findByLabelText('Protein g')).toHaveValue('3.2');
    expect(track.stop).toHaveBeenCalled();

    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('an empty recognizer result falls back to an unreadable state with a manual-entry escape, not a dead end', async () => {
    const recognize = vi.fn().mockResolvedValue([]);
    const track = { stop: vi.fn() };
    const requestStream = vi.fn().mockResolvedValue({ getTracks: () => [track] } as unknown as MediaStream);

    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 100 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: 100 });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['x'])));

    render(
      <NutritionProvider>
        <LabelReader recognize={recognize} requestStream={requestStream} />
      </NutritionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Scan the panel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Read this panel' }));

    expect(await screen.findByText('Could not read that panel')).toBeInTheDocument();
    // Manual entry is always offered, and it lands back at the typed fallback.
    fireEvent.click(screen.getByRole('button', { name: 'Type it instead' }));
    expect(screen.getByLabelText('Nutrition panel text')).toBeInTheDocument();

    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('a denied camera permission shows a fallback to typed entry, not a dead end', async () => {
    const requestStream = vi.fn().mockRejectedValue(new Error('denied'));

    render(
      <NutritionProvider>
        <LabelReader recognize={vi.fn()} requestStream={requestStream} />
      </NutritionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Scan the panel' }));

    expect(await screen.findByText('Camera access is off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Type it instead' }));
    expect(screen.getByLabelText('Nutrition panel text')).toBeInTheDocument();
  });
});
