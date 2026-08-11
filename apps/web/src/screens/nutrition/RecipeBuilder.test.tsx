// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CachedFood } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { RecipeBuilder } from './RecipeBuilder';

/*
 * RecipeBuilder: name + servings + ingredient list built from the shared
 * FoodSearch ingredient lookup, with a live per-serving macro preview and a
 * save that resolves the recipe through `@hybrid/nutrition-core` and writes
 * it as a `Recipe`, exactly as mobile's `RecipeBuilderScreen.tsx` does.
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

describe('RecipeBuilder', () => {
  it('adding an ingredient via the shared lookup appends a scaled-macro preview row', async () => {
    const search = vi.fn().mockResolvedValue([oats]);
    render(
      <NutritionProvider>
        <RecipeBuilder search={search} />
      </NutritionProvider>,
    );
    fireEvent.change(screen.getByLabelText(/search an ingredient/i), { target: { value: 'oats' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('oats'));
    await waitFor(() => expect(screen.getByRole('button', { name: /add rolled oats/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add rolled oats/i }));

    await waitFor(() => expect(screen.getAllByText('Rolled Oats').length).toBeGreaterThan(0));
    // Per-serving preview should now show macros instead of the empty-state hint.
    await waitFor(() => expect(screen.queryByText(/add an ingredient to see the macros/i)).not.toBeInTheDocument());
  });

  it('changing servings count rescales the per-serving preview', async () => {
    const search = vi.fn().mockResolvedValue([oats]);
    render(
      <NutritionProvider>
        <RecipeBuilder search={search} />
      </NutritionProvider>,
    );
    fireEvent.change(screen.getByLabelText(/search an ingredient/i), { target: { value: 'oats' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /add rolled oats/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add rolled oats/i }));
    await waitFor(() => expect(screen.getAllByText('Rolled Oats').length).toBeGreaterThan(0));

    const before = screen.getByTestId('per-serving-macros').textContent;
    fireEvent.change(screen.getByLabelText(/servings it makes/i), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByTestId('per-serving-macros').textContent).not.toBe(before));
  });

  it('save calls upsertCachedFood with a per-serving-resolved shape from resolveRecipePerServing', async () => {
    const search = vi.fn().mockResolvedValue([oats]);
    render(
      <NutritionProvider>
        <RecipeBuilder search={search} />
      </NutritionProvider>,
    );
    fireEvent.change(screen.getByLabelText(/recipe name/i), { target: { value: 'Overnight oats' } });
    fireEvent.change(screen.getByLabelText(/search an ingredient/i), { target: { value: 'oats' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /add rolled oats/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add rolled oats/i }));
    await waitFor(() => expect(screen.getAllByText('Rolled Oats').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /save recipe/i }));

    await waitFor(() => {
      const raw = localStorage.getItem(NUTRITION_LS_KEY);
      expect(raw).toBeTruthy();
      const db = JSON.parse(raw as string);
      expect(db.recipes).toHaveLength(1);
      expect(db.recipes[0].name).toBe('Overnight oats');
      expect(db.recipes[0].items).toHaveLength(1);
      expect(db.recipes[0].items[0].foodId).toBe('food-oats');
      // The ingredient is cached onto the device the moment it joins the recipe.
      expect(db.foodCache.some((f: CachedFood) => f.id === 'food-oats')).toBe(true);
    });
  });
});
