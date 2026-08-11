// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DbProvider } from '../store/db';
import { SyncProvider } from '../cloud/sync';
import { WhoopProvider } from '../cloud/whoop';
import { Concept2Provider } from '../cloud/concept2';
import { NutritionProvider } from '../store/nutrition';
import { __resetDisciplineForTest, currentDiscipline } from '../discipline';
import { Settings } from './Settings';

/*
 * The training-world Settings screen used to have no way INTO the nutrition
 * world at all — `setDiscipline('nutrition')` was called nowhere in web,
 * which left the entire nutrition route tree unreachable from any UI action.
 * This proves the `WorldSwitch` rendered here (see `WorldSwitch.tsx`) closes
 * that gap, mirroring how `WorldSwitch.test.tsx` proves the reverse direction
 * from the nutrition world's own Settings.
 */

function renderSettings() {
  localStorage.setItem(LS_KEY, JSON.stringify({ workouts: [], sessions: [], settings: {} } as EngineDB));
  return render(
    <DbProvider>
      <NutritionProvider>
        <SyncProvider>
          <WhoopProvider>
            <Concept2Provider>
              <Settings />
            </Concept2Provider>
          </WhoopProvider>
        </SyncProvider>
      </NutritionProvider>
    </DbProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetDisciplineForTest();
});

describe('Settings world switch', () => {
  it('reaches the nutrition world by clicking the world switch', () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /nutrition/i }));

    expect(currentDiscipline()).toBe('nutrition');
  });
});
