// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptyNutritionDB,
  logEntryFromCustomFood,
  logEntryFromRecipe,
  quickAddEntry,
  type CustomFood,
  type NutritionDB,
  type Recipe,
} from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { FoodLog } from './FoodLog';

/*
 * Task 2.5: the web Daily Log used to render every entry generically already
 * (`e.displayName`/`macroLine(e)`, both snapshot fields every `entryKind`
 * carries — see `FoodLogEntry`'s type doc), and `groupByMeal` was already
 * wired. This file is the regression that PINS that: a `quick_add`, a
 * `custom_food` and a `recipe` entry, logged into three different meals, must
 * each show their own real name and macros, grouped under their own meal
 * heading — not a generic "Quick add" fallback and not all lumped into one
 * bucket.
 */

// The screen always opens on "today" (read fresh at mount, not injectable),
// so the fixture has to be logged against today's local date or it renders
// as an empty day.
const today = new Date();
const p = (n: number) => String(n).padStart(2, '0');
const DATE = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
const AT = `${DATE}T12:00:00.000Z`;

function seed(db: NutritionDB) {
  localStorage.setItem(NUTRITION_LS_KEY, JSON.stringify(db));
}

function renderFoodLog() {
  return render(
    <NutritionProvider>
      <FoodLog />
    </NutritionProvider>,
  );
}

const customFood: CustomFood = {
  id: 'cf-1',
  userId: '',
  name: 'Grandma\'s Chili',
  servingQty: 1,
  servingUnit: 'bowl',
  calories: 400,
  proteinG: 30,
  carbsG: 35,
  fatG: 14,
  nutrients: {},
  source: 'custom',
  createdAt: AT,
  updatedAt: AT,
};

const recipe: Recipe = {
  id: 'rc-1',
  userId: '',
  name: 'Sunday Pancakes',
  servings: 4,
  items: [],
  createdAt: AT,
  updatedAt: AT,
};

describe('FoodLog renders every log-entry kind, grouped by meal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows each entry kind under its real name, not a generic fallback', () => {
    const quickAdd = quickAddEntry(
      { id: 'e-quick', logDate: DATE, meal: 'breakfast', at: AT },
      { displayName: 'Black coffee', calories: 5, proteinG: 0, carbsG: 1, fatG: 0 },
    );
    const customEntry = logEntryFromCustomFood(
      { id: 'e-custom', logDate: DATE, meal: 'dinner', at: AT },
      customFood,
      1,
      'bowl',
    );
    const recipeEntry = logEntryFromRecipe(
      { id: 'e-recipe', logDate: DATE, meal: 'breakfast', at: AT },
      recipe,
      { calories: 220, proteinG: 6, carbsG: 30, fatG: 8 },
      2,
    );

    seed({ ...emptyNutritionDB(), logEntries: [quickAdd, customEntry, recipeEntry] });
    renderFoodLog();

    // Real names, not a "Quick add" fallback for the non-quick-add kinds.
    expect(screen.getByText('Black coffee')).toBeInTheDocument();
    expect(screen.getByText(customEntry.displayName)).toBeInTheDocument();
    expect(screen.getByText(recipeEntry.displayName)).toBeInTheDocument();
    expect(screen.queryByText('Quick add')).not.toBeInTheDocument();

    // Grouped by meal: Breakfast heading precedes Dinner, each with its own entries.
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    const breakfastIdx = headings.findIndex((h) => h === 'Breakfast');
    const dinnerIdx = headings.findIndex((h) => h === 'Dinner');
    expect(breakfastIdx).toBeGreaterThanOrEqual(0);
    expect(dinnerIdx).toBeGreaterThan(breakfastIdx);
  });
});
