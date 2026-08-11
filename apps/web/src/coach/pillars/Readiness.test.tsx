// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { Readiness } from './Readiness';

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Readiness /></MemoryRouter>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('Readiness pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('asks for a WHOOP connection instead of inventing a recovery score', () => {
    // A fresh DB has no WHOOP data. The mockup shows 87%; showing that
    // number here would be a fabricated vital sign.
    renderPillar();
    expect(screen.getByRole('link', { name: /Connect WHOOP/i })).toBeInTheDocument();
    expect(screen.queryByText('87')).not.toBeInTheDocument();
  });
});
