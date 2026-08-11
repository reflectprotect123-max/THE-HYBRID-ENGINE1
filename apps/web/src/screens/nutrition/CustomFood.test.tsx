// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { CustomFood } from './CustomFood';

/*
 * CustomFood: name + brand + serving size/unit + four macros, saved straight
 * onto `NutritionDB.customFoods` — the create half of mobile's
 * `CustomFoodScreen.tsx`, opened with no props exactly as `Food.tsx` opens it.
 */

beforeEach(() => {
  localStorage.clear();
});

describe('CustomFood', () => {
  it('filling the form and saving writes a custom food with the entered shape', async () => {
    render(
      <NutritionProvider>
        <CustomFood />
      </NutritionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Food name'), { target: { value: 'Rolled Oats' } });
    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Woolworths' } });
    fireEvent.change(screen.getByLabelText('Serving size'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'unit g' }));
    fireEvent.change(screen.getByLabelText('Calories'), { target: { value: '389' } });
    fireEvent.change(screen.getByLabelText('Protein g'), { target: { value: '16.9' } });
    fireEvent.change(screen.getByLabelText('Carbs g'), { target: { value: '66.3' } });
    fireEvent.change(screen.getByLabelText('Fat g'), { target: { value: '6.9' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save food' }));

    await waitFor(() => {
      const raw = localStorage.getItem(NUTRITION_LS_KEY);
      expect(raw).toBeTruthy();
      const db = JSON.parse(raw as string);
      expect(db.customFoods).toHaveLength(1);
      const food = db.customFoods[0];
      expect(food.name).toBe('Rolled Oats');
      expect(food.brand).toBe('Woolworths');
      expect(food.servingQty).toBe(100);
      expect(food.servingUnit).toBe('g');
      expect(food.calories).toBe(389);
      expect(food.proteinG).toBe(16.9);
      expect(food.carbsG).toBe(66.3);
      expect(food.fatG).toBe(6.9);
      expect(food.source).toBe('user_custom');
      expect(food.deletedAt).toBeNull();
    });

    expect(screen.getByText(/Rolled Oats saved/i)).toBeInTheDocument();
    // The form clears after a save, so a second food isn't typed on top of it.
    expect((screen.getByLabelText('Food name') as HTMLInputElement).value).toBe('');
  });

  it('a missing name shows a validation message and saves nothing', () => {
    render(
      <NutritionProvider>
        <CustomFood />
      </NutritionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Serving size'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save food' }));

    expect(screen.getByText(/give the food a name/i)).toBeInTheDocument();
    expect(localStorage.getItem(NUTRITION_LS_KEY)).toBeFalsy();
  });

  it('a missing serving size shows a validation message and saves nothing', () => {
    render(
      <NutritionProvider>
        <CustomFood />
      </NutritionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Food name'), { target: { value: 'Rolled Oats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save food' }));

    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
    expect(localStorage.getItem(NUTRITION_LS_KEY)).toBeFalsy();
  });
});
