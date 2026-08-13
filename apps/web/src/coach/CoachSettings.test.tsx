// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CoachSettings } from './CoachSettings';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';
import type { CoachWorkspaceSettings } from './contracts';

/**
 * `CoachSettings` loads persisted preferences through
 * `repository.getSettings()` in a mount effect before any control reflects
 * them, the same async-settle shape as every other coach-bench screen —
 * `act(async () => {})` flushes that load (and the provider's own client
 * resolution) before assertions run, matching `CoachNutrition.test.tsx`.
 */
async function renderSettings(repository: FakeCoachWorkspaceRepository = new FakeCoachWorkspaceRepository()) {
  const result = renderCoachScreen(<CoachSettings />, { repository });
  await act(async () => {});
  return result;
}

function savedSettingsFixture(over: Partial<CoachWorkspaceSettings> = {}): CoachWorkspaceSettings {
  return {
    weekStartsOn: 'sunday',
    defaultLoadUnit: 'lb',
    priorityNotifications: false,
    visibleLibraries: { strength: false, conditioning: true, beginnerFoundations: false },
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('CoachSettings', () => {
  it('renders all five section tabs with Workspace active by default', async () => {
    await renderSettings();

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const tabs = within(nav).getAllByRole('button');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Workspace',
      'Programming',
      'Decisions & safety',
      'Coaches & access',
      'Data & sync',
    ]);

    expect(within(nav).getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Programming' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 2, name: 'Workspace' })).toBeInTheDocument();
  });

  it('switches the visible section when a different tab is clicked', async () => {
    await renderSettings();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });

    expect(screen.queryByText('Strength library')).not.toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'Programming' }));
    expect(screen.getByText('Strength library')).toBeInTheDocument();
    expect(screen.getByText('Conditioning library')).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Programming' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Training week begins')).not.toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: 'Decisions & safety' }));
    expect(screen.getByText('Progression increases')).toBeInTheDocument();
    expect(screen.getByText('Coach approval required')).toBeInTheDocument();
    expect(screen.queryByText('Strength library')).not.toBeInTheDocument();
  });

  it('loads saved settings on mount and populates the workspace and library controls', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.settings = savedSettingsFixture();
    await renderSettings(repo);

    expect(screen.getByDisplayValue('Sunday')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pounds')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Priority notifications/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Programming' }));
    expect(screen.getByRole('switch', { name: /Strength library/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /Conditioning library/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Beginner foundations/ })).not.toBeChecked();
  });

  it('saves the current form state through the repository and shows the success message', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    await renderSettings(repo);

    fireEvent.change(screen.getByDisplayValue('Monday'), { target: { value: 'Sunday' } });
    fireEvent.change(screen.getByDisplayValue('Kilograms'), { target: { value: 'Pounds' } });
    fireEvent.click(screen.getByRole('switch', { name: /Priority notifications/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

    expect(repo.settings).toEqual({
      weekStartsOn: 'sunday',
      defaultLoadUnit: 'lb',
      priorityNotifications: false,
      visibleLibraries: { strength: true, conditioning: true, beginnerFoundations: true },
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Workspace preferences saved in the replaceable demo repository.',
    );
    // The success voice: `.st-save-note` is the only class in the stylesheet
    // painted with `--color-ok`.
    expect(screen.getByRole('status')).toHaveClass('st-save-note');
  });

  /*
   * The honesty rows, per the spec's "Settings says where the data actually
   * lives" amendment (13 August 2026). This screen used to assert the OPPOSITE
   * of the truth — a "local demonstration" over "synthetic fixtures only" —
   * while the workspace sat on eight RLS-owned Supabase tables.
   *
   * The multi-client row is COUNTED rather than written, and these two cases
   * are what stops the count regressing into a written claim: a real roster is
   * reported as what it holds, and a roster that is merely a fixture set says
   * so instead of passing itself off as clients.
   */
  it('counts the multi-client row from the roster rather than asserting it', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [
      rosterClient({ id: 'a', name: 'Alex Morgan', source: 'engine-local' }),
      rosterClient({ id: 'b', name: 'Riley Roster', source: 'roster-summary' }),
      rosterClient({ id: 'c', name: 'Fixture Fiona', source: 'synthetic-fixture' }),
    ];
    await renderSettings(repo);

    fireEvent.click(screen.getByRole('button', { name: 'Data & sync' }));
    expect(screen.getByText('3 athletes · 1 fixture')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic fixtures only')).not.toBeInTheDocument();
    expect(screen.queryByText('Local demonstration')).not.toBeInTheDocument();
  });

  it('says so when every athlete on the roster is a fixture', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'c', name: 'Fixture Fiona', source: 'synthetic-fixture' })];
    await renderSettings(repo);

    fireEvent.click(screen.getByRole('button', { name: 'Data & sync' }));
    expect(screen.getByText('1 athlete · all fixtures')).toBeInTheDocument();
  });

  /*
   * The three Decisions & safety rows are the ONE set this stage does not
   * touch: they describe the live auto-coach policy, and CLAUDE.md is explicit
   * that pain and illness are safety flags rather than ordinary readiness
   * penalties. Pinned by text so a future restyle cannot quietly soften them.
   */
  it('leaves the three safety rows saying exactly what they said', async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Decisions & safety' }));
    expect(screen.getByText('Coach approval required')).toBeInTheDocument();
    expect(screen.getByText('Hold and human review')).toBeInTheDocument();
    expect(screen.getByText('Unknown · never inferred clear')).toBeInTheDocument();
  });

  it('shows the load-failure message and keeps defaults when getSettings rejects', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.getSettings = async () => {
      throw new Error('simulated getSettings failure');
    };
    await renderSettings(repo);

    expect(screen.getByRole('status')).toHaveTextContent('Saved settings could not be loaded. Defaults are shown.');
    // A failure must NOT wear the success colour. `.st-save-note` is declared
    // after `.st-warning` in the stylesheet, so putting both on one element
    // would have shipped a red-meaning message in green ink.
    expect(screen.getByRole('status')).toHaveClass('st-warning');
    expect(screen.getByRole('status')).not.toHaveClass('st-save-note');
    expect(screen.getByDisplayValue('Monday')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kilograms')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Priority notifications/ })).toBeChecked();
  });
});
