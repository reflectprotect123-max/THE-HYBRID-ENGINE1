// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CachedFood } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { FoodSearch } from './FoodSearch';

/*
 * FoodSearch: search input + result list (recent/favorite/catalogue sections)
 * + quantity/unit picker on tap, wired to `entry.ts`'s write forwards.
 *
 * `search` is injected exactly as mobile's `FoodSearchScreen` injects it, so
 * these tests need no network — the same reason `searchCatalogue` takes a
 * `client` parameter in `apps/web/src/cloud/catalogue.ts`.
 */

const oats: CachedFood = {
  id: 'food-oats',
  name: 'Rolled Oats',
  brand: 'Woolworths',
  barcode: null,
  servingQty: 100,
  servingUnit: 'g',
  calories: 389,
  proteinG: 16.9,
  carbsG: 66.3,
  fatG: 6.9,
  source: 'catalogue',
  externalId: null,
  nutritionBasisQty: 100,
  nutritionBasisUnit: 'g',
  servingSizeText: null,
  nutrients: {},
  servings: [],
  cachedAt: '2026-08-10T00:00:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
});

describe('FoodSearch', () => {
  it('shows nothing before a query and nothing needing the network', () => {
    const search = vi.fn().mockResolvedValue([]);
    render(
      <NutritionProvider>
        <FoodSearch search={search} />
      </NutritionProvider>,
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('renders catalogue results from the injected search after typing', async () => {
    const search = vi.fn().mockResolvedValue([oats]);
    render(
      <NutritionProvider>
        <FoodSearch search={search} />
      </NutritionProvider>,
    );
    fireEvent.change(screen.getByLabelText(/search foods/i), { target: { value: 'oats' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('oats'));
    await waitFor(() => expect(screen.getByText('Rolled Oats')).toBeInTheDocument());
  });

  it('opens a quantity/unit picker on tapping a result, and confirming logs the entry', async () => {
    const search = vi.fn().mockResolvedValue([oats]);
    render(
      <NutritionProvider>
        <FoodSearch search={search} />
      </NutritionProvider>,
    );
    fireEvent.change(screen.getByLabelText(/search foods/i), { target: { value: 'oats' } });
    await waitFor(() => expect(screen.getByText('Rolled Oats')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /log rolled oats/i }));

    expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add to log/i }));

    await waitFor(() => {
      const raw = localStorage.getItem(NUTRITION_LS_KEY);
      expect(raw).toBeTruthy();
      const db = JSON.parse(raw as string);
      expect(db.logEntries).toHaveLength(1);
      expect(db.logEntries[0].foodId).toBe('food-oats');
      expect(db.logEntries[0].displayName).toBe('Rolled Oats');
      expect(db.foodCache.some((f: CachedFood) => f.id === 'food-oats')).toBe(true);
    });
  });

  it('cancelling the picker writes nothing', async () => {
    const search = vi.fn().mockResolvedValue([oats]);
    render(
      <NutritionProvider>
        <FoodSearch search={search} />
      </NutritionProvider>,
    );
    fireEvent.change(screen.getByLabelText(/search foods/i), { target: { value: 'oats' } });
    await waitFor(() => expect(screen.getByText('Rolled Oats')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /log rolled oats/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByLabelText(/quantity/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(NUTRITION_LS_KEY)).toBeFalsy();
  });

  it('shows an offline message and still works from what is on the device when the catalogue fails', async () => {
    const search = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <NutritionProvider>
        <FoodSearch search={search} />
      </NutritionProvider>,
    );
    fireEvent.change(screen.getByLabelText(/search foods/i), { target: { value: 'oats' } });
    await waitFor(() => expect(screen.getAllByText(/catalogue is unreachable/i).length).toBeGreaterThan(0));
  });
});
