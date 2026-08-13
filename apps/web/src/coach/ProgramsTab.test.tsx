// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ProgramTemplate } from './contracts';
import { ProgramsTab } from './ProgramsTab';

const base = {
  category: 'Full body',
  level: 'developing',
  weeks: 8,
  summary: 'Three balanced sessions.',
  progression: { kind: 'strength', stages: ['Volume base', 'Rep quality'], increaseAuthority: 'coach-approval-only' },
  status: 'published',
  source: 'coach-template',
} as const;

/*
 * `p1` deliberately carries NO sessions and `p2` carries two. Both branches
 * are then covered by construction — and the empty one is the branch that
 * matters most, because every real program is in that state until phase 2
 * relaxes `coach_workout_drafts`' `unique (template_id)`. An implementer who
 * "fixes" p1 to make a test greener deletes the only guard on the common case.
 */
const templates = [
  { ...base, id: 'p1', domain: 'strength', name: 'Build · Full Body', sessionsPerWeek: 3, sessions: [] },
  {
    ...base,
    id: 'p2',
    domain: 'strength',
    name: 'Foundation',
    sessionsPerWeek: 2,
    sessions: [
      { id: 'w1', name: 'Day 1 · Squat', blocks: [] },
      { id: 'w2', name: 'Day 2 · Press', blocks: [] },
    ],
  },
  { ...base, id: 'p3', domain: 'conditioning', name: 'Run · Steady', sessionsPerWeek: 2, sessions: [] },
] as unknown as ProgramTemplate[];

const clients = [{ id: 'c1', name: 'Alex Morgan' }];

function renderTab(over: Partial<React.ComponentProps<typeof ProgramsTab>> = {}) {
  const props = { templates, loading: false, error: '', onAssign: vi.fn(), clients, ...over };
  render(<ProgramsTab {...props} />);
  return props;
}

describe('ProgramsTab', () => {
  it('lists the programs for the selected training system', () => {
    renderTab();
    expect(screen.getByText('Build · Full Body')).toBeInTheDocument();
    expect(screen.queryByText('Run · Steady')).not.toBeInTheDocument();
  });

  it('switches training system', () => {
    renderTab();
    fireEvent.click(screen.getByRole('tab', { name: /conditioning/i }));
    expect(screen.getByText('Run · Steady')).toBeInTheDocument();
    expect(screen.queryByText('Build · Full Body')).not.toBeInTheDocument();
  });

  it('shows each row its dose and level', () => {
    renderTab();
    expect(screen.getByText(/3× · 8 weeks/)).toBeInTheDocument();
  });

  /*
   * The screen must never credit ARC with a choice the coach made. Before this
   * stage, CoachLibrary fell back to a recommender while the panel was
   * hardcoded to "ARC recommends", so picking a program yourself made the app
   * claim it had recommended your own pick.
   */
  it('never claims to have recommended anything', () => {
    renderTab();
    expect(screen.queryByText(/ARC recommends/i)).not.toBeInTheDocument();
  });

  it('opens a program to show its real sessions', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Foundation/ }));
    expect(screen.getByText('Day 1 · Squat')).toBeInTheDocument();
    expect(screen.getByText('Day 2 · Press')).toBeInTheDocument();
  });

  it('says so when a program records no sessions, rather than showing a blank', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    expect(screen.getByText(/no sessions recorded for this program yet/i)).toBeInTheDocument();
  });

  it('shows the progression stages on the opened program', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    expect(screen.getByText('Volume base')).toBeInTheDocument();
  });

  it('keeps the list closed until a program is chosen', () => {
    renderTab();
    expect(screen.queryByText(/no sessions recorded/i)).not.toBeInTheDocument();
  });

  it('distinguishes a load failure from an empty library', () => {
    renderTab({ templates: [], error: 'The Library could not be loaded.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByText(/no .* programs published yet/i)).not.toBeInTheDocument();
  });

  it('says an empty library is empty', () => {
    renderTab({ templates: [] });
    expect(screen.getByText(/no strength programs published yet/i)).toBeInTheDocument();
  });
});

/*
 * `saveAssignmentDraft` is the app's only program-assignment path, and it has
 * had NO caller since the sidebar configurator was deleted on 11 August. These
 * tests are the guard on the path this stage puts back — not a formality.
 */
describe('ProgramsTab — assigning', () => {
  it('assigns the opened program to a chosen client', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    fireEvent.change(screen.getByLabelText(/assign to/i), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/preferred start/i), { target: { value: '2026-08-17' } });
    fireEvent.click(screen.getByRole('button', { name: /^Mon$/ }));
    fireEvent.click(screen.getByRole('button', { name: /prepare assignment/i }));

    expect(props.onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      'c1',
      '2026-08-17',
      expect.arrayContaining([1]),
    );
  });

  it('refuses to assign with no preferred day, and says why', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    fireEvent.change(screen.getByLabelText(/assign to/i), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: /prepare assignment/i }));
    expect(props.onAssign).not.toHaveBeenCalled();
    expect(screen.getByText(/choose at least one preferred training day/i)).toBeInTheDocument();
  });

  /*
   * The Coordinator owns placement. Preferred days are an INPUT — the deleted
   * screen said so and the replacement must keep saying so, or the coach
   * reasonably reads the day they picked as the day it will happen.
   */
  it('says preferred days are inputs, not placements', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    expect(screen.getByText(/not resolved calendar positions/i)).toBeInTheDocument();
  });
});
