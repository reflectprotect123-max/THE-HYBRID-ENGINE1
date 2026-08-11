// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { Strength } from './Strength';

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Strength /></MemoryRouter>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('Strength pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('says the queue is empty rather than showing the mockup lifts', () => {
    // A fresh DB has no proposals. "Back squat 100 → 102.5" is mockup
    // furniture; shipping it would invent a decision the coach never made.
    renderPillar();
    expect(screen.queryByText(/Back squat/)).not.toBeInTheDocument();
    expect(screen.getByText(/no .*(proposal|decision)/i)).toBeInTheDocument();
  });
});
