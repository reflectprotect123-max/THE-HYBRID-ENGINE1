// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NutritionProvider } from '../../store/nutrition';
import { NutritionSettings } from './NutritionSettings';

/*
 * Ported from mobile's `NutritionSettingsScreen`
 * (`apps/mobile/src/screens/nutrition/NutritionSettings.tsx`): a SEPARATE
 * screen from the training Settings, with `WorldSwitch` as the way out and a
 * live-entries/days summary of the athlete's own food log.
 */

beforeEach(() => {
  localStorage.clear();
});

describe('NutritionSettings', () => {
  it('renders the world switch back to training', () => {
    render(
      <NutritionProvider>
        <NutritionSettings />
      </NutritionProvider>,
    );

    expect(screen.getByRole('button', { name: /training/i })).toBeInTheDocument();
  });

  it('renders the food data summary, counting only live log entries', () => {
    localStorage.setItem(
      'hybrid-nutrition-v1',
      JSON.stringify({
        version: 1,
        logEntries: [
          { id: 'a', entryKind: 'quick_add', logDate: '2026-08-01', deletedAt: null },
          { id: 'b', entryKind: 'quick_add', logDate: '2026-08-01', deletedAt: null },
          { id: 'c', entryKind: 'quick_add', logDate: '2026-08-02', deletedAt: '2026-08-03T00:00:00.000Z' },
        ],
        weightEntries: [],
        customFoods: [],
        recipes: [],
        cachedFoods: [],
        updatedAt: 0,
      }),
    );

    render(
      <NutritionProvider>
        <NutritionSettings />
      </NutritionProvider>,
    );

    expect(screen.getByText(/2 entries across 1 day/)).toBeInTheDocument();
  });
});
