// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { NutritionProvider } from '../../store/nutrition';
import { Nutrition } from './Nutrition';

function renderPillar() {
  return render(
    <DbProvider>
      <NutritionProvider>
        <MemoryRouter><Nutrition /></MemoryRouter>
      </NutritionProvider>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('Nutrition pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('reports unlogged days as unlogged, not as zero-calorie days', () => {
    renderPillar();
    expect(screen.getByText(/0 of 7|unlogged|no days logged/i)).toBeInTheDocument();
  });

  it('states absent weigh-in data rather than a fake trend', () => {
    renderPillar();
    expect(screen.getByText(/no weigh-ins recorded/i)).toBeInTheDocument();
  });

  it('states an absent macro target rather than a fabricated 0g bar', () => {
    renderPillar();
    expect(screen.getAllByText(/no target set/i).length).toBe(3);
  });
});
