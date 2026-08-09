// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CoachLibrary } from './CoachLibrary';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';
import { PROGRAM_TEMPLATE_FIXTURES } from './mock-fixtures';

/*
 * Bug: with zero published program templates — the real state for every
 * account today, since nothing has ever published one — both places
 * "Prepare assignment" can render (the sidebar's "ARC recommends" panel and
 * the main list's detail panel) are gated on `selected`, which is undefined
 * whenever `templates` is empty. The screen renders a fully interactive
 * configuration form (training system, experience, sessions, assign-to,
 * dates) that leads nowhere, with no message explaining why. This test
 * covers the fix: an explicit empty state with a way forward.
 */

async function renderLibrary(repository: FakeCoachWorkspaceRepository) {
  const result = renderCoachScreen(
    <MemoryRouter initialEntries={['/coach/library']}>
      <CoachLibrary />
    </MemoryRouter>,
    { repository },
  );
  await act(async () => {});
  return result;
}

describe('CoachLibrary', () => {
  it('shows an empty state with a way forward when no templates are published, instead of a dead-end form', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.templates = [];
    await renderLibrary(repo);

    // The configuration controls are still there...
    expect(screen.getByText('Training system')).toBeInTheDocument();
    // ...but no "Prepare assignment" action exists anywhere, because nothing
    // is selected. Without the fix, this is a silent dead end.
    expect(screen.queryByRole('button', { name: /prepare/i })).not.toBeInTheDocument();

    // The fix: an explicit message, not silence.
    expect(screen.getByText(/no.*templates.*published/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /session builder|build/i })).toHaveAttribute('href', '/coach/author');
  });

  it('still shows the empty state for a domain with zero templates, even when the other domain has some', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.templates = PROGRAM_TEMPLATE_FIXTURES.filter((t) => t.domain === 'strength');
    await renderLibrary(repo);

    // Switch to Conditioning, which this fixture set has none of.
    await act(async () => {
      screen.getAllByRole('button', { name: /^conditioning$/i })[0].click();
    });

    expect(screen.getByText(/no.*templates.*published/i)).toBeInTheDocument();
  });

  it('renders the normal recommend + prepare flow once a published template exists', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.templates = PROGRAM_TEMPLATE_FIXTURES.filter((t) => t.domain === 'strength' && t.status === 'published');
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    await renderLibrary(repo);

    expect(screen.getByText('ARC recommends')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /prepare/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no.*templates.*published/i)).not.toBeInTheDocument();
  });
});
