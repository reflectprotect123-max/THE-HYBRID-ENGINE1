// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NutritionProvider } from '../../store/nutrition';
import { Food } from './Food';

/*
 * `Food` renders the `search` pane by default, and Task 2.6's `FoodSearch`
 * (the real screen behind that pane, replacing the earlier placeholder) reads
 * the nutrition slice via `useNutrition` — so every render here needs a
 * `NutritionProvider`, exactly as `App.tsx` supplies one in production.
 */

describe('Food composer screen', () => {
  it('defaults to the search sub-view', () => {
    render(
      <NutritionProvider>
        <Food />
      </NutritionProvider>,
    );
    expect(screen.getByRole('tab', { name: /search/i, selected: true })).toBeInTheDocument();
  });

  it('switches to the custom-food sub-view on tap', () => {
    render(
      <NutritionProvider>
        <Food />
      </NutritionProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: /custom food/i }));
    expect(screen.getByRole('tab', { name: /custom food/i, selected: true })).toBeInTheDocument();
  });

  it('lists every pane mobile\'s Food composer switches between', () => {
    render(
      <NutritionProvider>
        <Food />
      </NutritionProvider>,
    );
    for (const name of [/search/i, /quick add/i, /custom food/i, /recipe/i, /scan barcode/i, /read label/i]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });
});
