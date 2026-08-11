// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NutritionBottomNav } from './NutritionBottomNav';

describe('NutritionBottomNav', () => {
  it('renders all five nutrition tabs', () => {
    render(<MemoryRouter><NutritionBottomNav /></MemoryRouter>);
    expect(screen.getByText('Log')).toBeInTheDocument();
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.getByText('Coach')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('marks the current route active', () => {
    render(
      <MemoryRouter initialEntries={['/nutrition/weight']}>
        <NutritionBottomNav />
      </MemoryRouter>,
    );
    expect(screen.getByText('Weight').closest('a')).toHaveAttribute('aria-current', 'page');
  });
});
