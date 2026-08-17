// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { Strength } from './Strength';
import { CoachWorkspaceProvider } from '../data/CoachWorkspaceContext';
import { FakeCoachWorkspaceRepository } from '../testing/coach-test-harness';

/*
 * The strength pillar's lift-trend and progression-queue behavior went with
 * the strength engine (CLAUDE.md, 15 August 2026). All that's left to prove
 * is that the route still renders a placeholder and offers a way back.
 */
function renderPillar() {
  return render(
    <CoachWorkspaceProvider repository={new FakeCoachWorkspaceRepository()}>
      <DbProvider>
        <MemoryRouter><Strength /></MemoryRouter>
      </DbProvider>,
    </CoachWorkspaceProvider>
  );
}

beforeEach(() => localStorage.clear());

describe('Strength pillar', () => {
  it('offers a way back to the Command Center', async () => {
    renderPillar();
    await act(async () => {});
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('says strength is being rebuilt', async () => {
    renderPillar();
    await act(async () => {});
    expect(screen.getByText(/Strength is being rebuilt/i)).toBeInTheDocument();
  });
});
