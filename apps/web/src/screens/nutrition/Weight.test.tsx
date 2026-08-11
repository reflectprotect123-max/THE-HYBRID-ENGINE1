// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { Weight } from './Weight';

/*
 * Weight: numeric entry + trend, ported from mobile's `WeightScreen.tsx`.
 * Entries are written straight onto `NutritionDB.weightEntries` (there is no
 * `logEntryFrom*`-style builder for a weigh-in in `@hybrid/nutrition-core`,
 * so this screen builds the record literal itself, exactly as mobile's own
 * screen and this app's `CustomFood.tsx`/`RecipeBuilder.tsx` already do for
 * the record kinds that have no core builder). The trend numbers rendered
 * come straight from `trendSeries` in `@hybrid/nutrition-adapter` — nothing
 * here recomputes them.
 */

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Weight', () => {
  it('logging a weigh-in writes a WeightEntry onto NutritionDB.weightEntries', async () => {
    render(
      <NutritionProvider>
        <Weight />
      </NutritionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Weight kg'), { target: { value: '80.8' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'morning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));

    await waitFor(() => {
      const raw = localStorage.getItem(NUTRITION_LS_KEY);
      expect(raw).toBeTruthy();
      const db = JSON.parse(raw as string);
      expect(db.weightEntries).toHaveLength(1);
      const entry = db.weightEntries[0];
      expect(entry.weightKg).toBe(80.8);
      expect(entry.note).toBe('morning');
      expect(entry.source).toBe('manual');
      expect(entry.deletedAt).toBeNull();
    });

    // The form clears after a save, so a second weigh-in isn't typed on top of it.
    expect((screen.getByLabelText('Weight kg') as HTMLInputElement).value).toBe('');
  });

  it('a weight outside 20-500kg is rejected and writes nothing', () => {
    render(
      <NutritionProvider>
        <Weight />
      </NutritionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Weight kg'), { target: { value: '9001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));

    expect(screen.getByText(/enter a weight between 20 and 500 kg/i)).toBeInTheDocument();
    expect(localStorage.getItem(NUTRITION_LS_KEY)).toBeFalsy();
  });

  it('renders the trend list from trendSeries once weigh-ins exist', async () => {
    render(
      <NutritionProvider>
        <Weight />
      </NutritionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Weight kg'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));

    await waitFor(() => expect(screen.getByText(/kg trend/i)).toBeInTheDocument());
    // The history row for the just-logged weigh-in.
    expect(screen.getByText('80.0 kg')).toBeInTheDocument();
  });

  it('deleting a weigh-in stamps deletedAt instead of removing the record', async () => {
    render(
      <NutritionProvider>
        <Weight />
      </NutritionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Weight kg'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(screen.getByText('80.0 kg')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /delete the 80.0 kg weigh-in/i }));

    await waitFor(() => {
      const raw = localStorage.getItem(NUTRITION_LS_KEY);
      const db = JSON.parse(raw as string);
      expect(db.weightEntries).toHaveLength(1);
      expect(db.weightEntries[0].deletedAt).not.toBeNull();
    });
    expect(screen.queryByText('80.0 kg')).not.toBeInTheDocument();
  });
});
