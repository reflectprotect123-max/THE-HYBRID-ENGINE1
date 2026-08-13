import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { useSync } from '../cloud/sync';
import { ArcAssignmentCard } from './ArcAssignmentCard';

jest.mock('../cloud/sync', () => ({ useSync: jest.fn() }));

const mockUseSync = useSync as unknown as jest.Mock;

const ASSIGNMENT = {
  id: 'a-1',
  organizationId: 'org-1',
  preferredStartDate: '2026-08-17',
  preferredWeekdays: [1, 3],
  state: 'ready-for-coordinator' as const,
  templateVersionId: 'v-1',
};

function mount(over: Partial<ReturnType<typeof baseCtx>> = {}) {
  const ctx = { ...baseCtx(), ...over };
  mockUseSync.mockReturnValue(ctx);
  render(<ArcAssignmentCard />);
  return ctx;
}

function baseCtx() {
  return {
    pendingAssignments: [ASSIGNMENT] as readonly (typeof ASSIGNMENT)[],
    acceptAssignment: jest.fn().mockResolvedValue(undefined),
    declineAssignment: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ArcAssignmentCard', () => {
  it('renders nothing when the athlete has no coach', () => {
    mount({ pendingAssignments: [] });
    expect(screen.queryByText('From your coach')).toBeNull();
  });

  it('shows the assignment and its preferred start', () => {
    mount();
    expect(screen.getByText('From your coach')).toBeTruthy();
    expect(screen.getByText(/Preferred start 2026-08-17/)).toBeTruthy();
    expect(screen.getByText(/1 program/)).toBeTruthy();
  });

  it('Accept calls accept, not decline', async () => {
    const ctx = mount();
    fireEvent.press(screen.getByText('Accept'));
    await waitFor(() => expect(ctx.acceptAssignment).toHaveBeenCalledWith('a-1'));
    expect(ctx.declineAssignment).not.toHaveBeenCalled();
  });

  it('Decline calls decline, not accept', async () => {
    const ctx = mount();
    fireEvent.press(screen.getByText('Decline'));
    await waitFor(() => expect(ctx.declineAssignment).toHaveBeenCalledWith('a-1'));
    expect(ctx.acceptAssignment).not.toHaveBeenCalled();
  });

  it('says so, rather than silently swallowing, when the decision cannot be recorded', async () => {
    mount({ acceptAssignment: jest.fn().mockRejectedValue(new Error('nope')) });
    fireEvent.press(screen.getByText('Accept'));
    await waitFor(() =>
      expect(screen.getByText('That could not be recorded. Nothing has changed — try again.')).toBeTruthy(),
    );
  });

  it('does not promise the week — the Coordinator still arranges it', () => {
    mount();
    expect(screen.getByText(/Your week is still arranged for you/)).toBeTruthy();
  });
});
