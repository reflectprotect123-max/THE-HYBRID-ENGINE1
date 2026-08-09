import { render, fireEvent, screen } from '@testing-library/react-native';
import type { AutoCoachResolution } from '@hybrid/auto-coach';

jest.mock('@hybrid/auto-coach', () => ({
  ...jest.requireActual('@hybrid/auto-coach'),
  resolveSession: jest.fn(),
}));

import { resolveSession } from '@hybrid/auto-coach';
import { useDb } from '../store/db';
import { SessionReceipt } from './SessionReceipt';
import { resetPendingProposalForTests, getPendingProposal } from './pendingProposal';
import { resetLedgerForTests, getLedgerEntries } from './ledger';
import { resetPolicyForTests } from './policy';

jest.mock('../store/db', () => ({ useDb: jest.fn() }));

const mockResolveSession = resolveSession as jest.Mock;
const mockUseDb = useDb as jest.Mock;

const TODAY_WORKOUT = {
  id: 'w-1',
  name: 'Push Day',
  kind: 'strength' as const,
  blocks: [],
  dates: [new Date().toISOString().slice(0, 10)],
  updatedAt: 1000,
};

function baseResolution(over: Partial<AutoCoachResolution> = {}): AutoCoachResolution {
  return {
    schemaVersion: 1,
    state: 'advisory',
    originalWorkoutId: 'w-1',
    resolvedWorkout: { ...TODAY_WORKOUT },
    operations: [{ type: 'cap_intensity', before: '225', after: '205' } as never],
    signals: [{ text: 'Low HRV', quality: 'known' } as never],
    inferences: ['Capping intensity today'],
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    requiresConfirmation: true,
    autoApplyAllowed: false,
    athleteMessage: 'Capping intensity today.',
    ...over,
  };
}

let updateSpy: jest.Mock;

beforeEach(() => {
  resetPendingProposalForTests();
  resetLedgerForTests();
  resetPolicyForTests();
  updateSpy = jest.fn();
  mockUseDb.mockReturnValue({
    workouts: [TODAY_WORKOUT],
    update: updateSpy,
    athleteState: {},
  });
  mockResolveSession.mockReturnValue(baseResolution());
});

describe('mobile SessionReceipt', () => {
  it('renders nothing when there is no workout today', () => {
    mockUseDb.mockReturnValue({ workouts: [], update: updateSpy, athleteState: {} });
    const { toJSON } = render(<SessionReceipt />);
    expect(toJSON()).toBeNull();
  });

  it('auto-proposes an eligible resolution and shows Approve/Decline', () => {
    render(<SessionReceipt />);
    expect(getPendingProposal()?.status).toBe('pending');
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('Approve applies the frozen proposal and records the ledger entry', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Approve'));
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(getLedgerEntries()).toHaveLength(1);
    expect(getLedgerEntries()[0].action).toBe('applied');
    expect(getPendingProposal()?.status).toBe('approved');
  });

  it('Decline records declined without mutating the workout', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Decline'));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(getPendingProposal()?.status).toBe('declined');
  });

  it('withdraws a pending proposal when a fresh resolve turns safety_stop', () => {
    const { rerender } = render(<SessionReceipt />);
    expect(getPendingProposal()?.status).toBe('pending');
    mockResolveSession.mockReturnValue(baseResolution({ state: 'safety_stop' }));
    mockUseDb.mockReturnValue({ workouts: [TODAY_WORKOUT], update: updateSpy, athleteState: {} });
    rerender(<SessionReceipt />);
    expect(getPendingProposal()).toBeNull();
  });

  it('does not show Approve/Decline once a proposal is already decided', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Decline'));
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
  });
});
