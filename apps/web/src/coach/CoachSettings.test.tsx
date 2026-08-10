// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CoachSettings } from './CoachSettings';
import { FakeCoachWorkspaceRepository, renderCoachScreen } from './coach-test-harness';
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
    expect(screen.getByRole('checkbox', { name: /Priority notifications/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Programming' }));
    expect(screen.getByRole('checkbox', { name: /Strength library/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Conditioning library/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Beginner foundations/ })).not.toBeChecked();
  });

  it('saves the current form state through the repository and shows the success message', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    await renderSettings(repo);

    fireEvent.change(screen.getByDisplayValue('Monday'), { target: { value: 'Sunday' } });
    fireEvent.change(screen.getByDisplayValue('Kilograms'), { target: { value: 'Pounds' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Priority notifications/ }));

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
  });

  it('shows the load-failure message and keeps defaults when getSettings rejects', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.getSettings = async () => {
      throw new Error('simulated getSettings failure');
    };
    await renderSettings(repo);

    expect(screen.getByRole('status')).toHaveTextContent('Saved settings could not be loaded. Defaults are shown.');
    expect(screen.getByDisplayValue('Monday')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kilograms')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Priority notifications/ })).toBeChecked();
  });
});
