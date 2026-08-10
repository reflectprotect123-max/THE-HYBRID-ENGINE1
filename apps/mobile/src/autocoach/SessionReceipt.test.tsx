import { act, render, fireEvent, screen } from '@testing-library/react-native';
import type { AutoCoachResolution } from '@hybrid/auto-coach';
import { ymd } from '@hybrid/engine';

jest.mock('@hybrid/auto-coach', () => ({
  ...jest.requireActual('@hybrid/auto-coach'),
  resolveSession: jest.fn(),
}));

import { resolveSession } from '@hybrid/auto-coach';
import { useDb } from '../store/db';
import { approvalAllowed, SessionReceipt } from './SessionReceipt';
import { getPendingProposal, pendingKey, resetPendingProposalForTests } from './pendingProposal';
import { resetLedgerForTests, getLedgerEntries } from './ledger';
import { resetPolicyForTests, updatePolicy } from './policy';
import { recordConsent, resetConsentForTests } from './consent';

jest.mock('../store/db', () => ({ useDb: jest.fn() }));

const mockResolveSession = resolveSession as jest.Mock;
const mockUseDb = useDb as jest.Mock;

const TODAY = ymd(new Date());

const TODAY_WORKOUT = {
  id: 'w-1',
  name: 'Push Day',
  kind: 'strength' as const,
  blocks: [],
  dates: [TODAY],
  updatedAt: 1000,
};

const COND_WORKOUT = {
  id: 'w-cond',
  name: 'Zone 2',
  kind: 'conditioning' as const,
  blocks: [],
  dates: [TODAY],
  updatedAt: 1000,
};

const KEY_STRENGTH = pendingKey(TODAY, 'w-1');
const KEY_COND = pendingKey(TODAY, 'w-cond');

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
/** What the store contains for the NEXT update() call. */
let storeWorkouts: { id: string }[];

/** The store contract mobile's real `update` has: the callback runs against a
 *  draft of whatever is in the store AT CALL TIME, and returning false
 *  abandons the whole write. The draft is read through a getter so a test can
 *  make the target disappear between render and press. */
function updateFrom(workouts: () => { id: string }[]): jest.Mock {
  return jest.fn((fn: (draft: { workouts: { id: string }[] }) => void | false) => {
    fn({ workouts: workouts().map((w) => ({ ...w })) });
  });
}

/** Out of shadow, with proposals consent on record — the only combination in
 *  which Approve exists at all. */
function consentedAndLive(): void {
  updatePolicy((p) => ({ ...p, mode: 'assisted' }));
  recordConsent('proposals', true);
}

beforeEach(() => {
  resetPendingProposalForTests();
  resetLedgerForTests();
  resetPolicyForTests();
  resetConsentForTests();
  storeWorkouts = [TODAY_WORKOUT];
  updateSpy = updateFrom(() => storeWorkouts);
  mockUseDb.mockReturnValue({
    workouts: [TODAY_WORKOUT],
    update: updateSpy,
    athleteState: {},
  });
  mockResolveSession.mockReturnValue(baseResolution());
});

describe('mobile SessionReceipt', () => {
  beforeEach(consentedAndLive);

  it('renders nothing when there is no workout today', () => {
    mockUseDb.mockReturnValue({ workouts: [], update: updateSpy, athleteState: {} });
    const { toJSON } = render(<SessionReceipt />);
    expect(toJSON()).toBeNull();
  });

  it('auto-proposes an eligible resolution and shows Approve/Decline', () => {
    render(<SessionReceipt />);
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('pending');
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('Approve applies the frozen proposal and records the ledger entry', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Approve'));
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(getLedgerEntries()).toHaveLength(1);
    expect(getLedgerEntries()[0].action).toBe('applied');
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('approved');
  });

  it('Decline records declined without mutating the workout', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Decline'));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('declined');
  });

  it('withdraws a pending proposal when a fresh resolve turns safety_stop', () => {
    const { rerender } = render(<SessionReceipt />);
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('pending');
    mockResolveSession.mockReturnValue(baseResolution({ state: 'safety_stop' }));
    mockUseDb.mockReturnValue({ workouts: [TODAY_WORKOUT], update: updateSpy, athleteState: {} });
    rerender(<SessionReceipt />);
    expect(getPendingProposal(KEY_STRENGTH)).toBeNull();
  });

  it('does not show Approve/Decline once a proposal is already decided', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Decline'));
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
  });
});

/*
 * docs/RISK_REGISTER.md R2. Shadow mode's own copy — here and in
 * ModeSwitcher — promises "shown, never applied". Before this, Approve was
 * offered whenever a proposal existed, so a fresh install (shadow mode, no
 * consent, no comprehension check) could still write a change into the store.
 */
describe('mobile SessionReceipt — the approve gate needs mode AND consent', () => {
  it('approvalAllowed is false in shadow mode and false without proposals consent', () => {
    expect(approvalAllowed('shadow', true)).toBe(false);
    expect(approvalAllowed('shadow', false)).toBe(false);
    expect(approvalAllowed('assisted', false)).toBe(false);
    expect(approvalAllowed('auto_daily', false)).toBe(false);
    expect(approvalAllowed('assisted', true)).toBe(true);
    expect(approvalAllowed('auto_daily', true)).toBe(true);
  });

  it('a fresh install — shadow mode, no consent — offers no Approve at all', () => {
    render(<SessionReceipt />);
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(getLedgerEntries()).toHaveLength(0);
  });

  it('live mode with no consent on record still offers no Approve', () => {
    updatePolicy((p) => ({ ...p, mode: 'assisted' }));
    render(<SessionReceipt />);
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.getByText(/Approving needs your consent/)).toBeTruthy();
  });

  it('consent on record but still in shadow offers no Approve', () => {
    recordConsent('proposals', true);
    render(<SessionReceipt />);
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.getByText(/Shadow mode/)).toBeTruthy();
  });

  it('Approve appears and works once mode is live AND consent is recorded', () => {
    const { rerender } = render(<SessionReceipt />);
    expect(screen.queryByText('Approve')).toBeNull();

    act(consentedAndLive);
    rerender(<SessionReceipt />);

    fireEvent.press(screen.getByText('Approve'));
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('approved');
  });

  it('the handler itself refuses, not just the button — revoking consent between render and press applies nothing', () => {
    consentedAndLive();
    render(<SessionReceipt />);
    const approve = screen.getByText('Approve');

    // Consent is revoked in Settings; this render's button is still mounted
    // and its closure still thinks it may apply. The handler re-reads the
    // live stores, so nothing reaches the store.
    act(() => recordConsent('proposals', false));
    fireEvent.press(approve);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(getLedgerEntries()).toHaveLength(0);
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('pending');
  });
});

/*
 * `update` abandons the whole write when the draft callback returns false —
 * the target workout was deleted from Home, or a sync tombstone landed,
 * between the receipt rendering and the tap. Recording the apply anyway
 * claimed "Applied — undo available" for a change that was never written and
 * burned the day's proposal.
 */
describe('mobile SessionReceipt — an aborted store write is not recorded as applied', () => {
  beforeEach(consentedAndLive);

  it('records nothing and leaves the proposal retryable when the target is gone', () => {
    render(<SessionReceipt />);
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('pending');

    // The workout is deleted (Home's ✕, or a sync tombstone) between the
    // receipt rendering and the press: the draft callback finds no target and
    // returns false, so `update` abandons the whole write.
    storeWorkouts = [];

    fireEvent.press(screen.getByText('Approve'));

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(getLedgerEntries()).toHaveLength(0);
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('pending');
    expect(screen.getByText(/no longer there/)).toBeTruthy();
  });
});

/*
 * The merged app's two worlds on one date. `useDb().workouts` is scoped by
 * `trainingScope(world)`, so switching worlds re-renders this same component
 * against a different workout — but the proposal and ledger records used to
 * be keyed on the date alone, so one world's decision consumed the other's.
 */
describe('mobile SessionReceipt — same-day strength and conditioning are separate decisions', () => {
  beforeEach(consentedAndLive);

  const inWorld = (w: typeof TODAY_WORKOUT | typeof COND_WORKOUT, update: jest.Mock) =>
    mockUseDb.mockReturnValue({ workouts: [w], update, athleteState: {} });

  it('each world raises its own proposal', () => {
    const { rerender } = render(<SessionReceipt />);
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('pending');

    inWorld(COND_WORKOUT, updateFrom(() => [COND_WORKOUT]));
    rerender(<SessionReceipt />);

    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('pending');
    expect(getPendingProposal(KEY_COND)?.status).toBe('pending');
  });

  it('declining strength leaves conditioning still decidable', () => {
    const { rerender } = render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Decline'));
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('declined');

    const condUpdate = updateFrom(() => [COND_WORKOUT]);
    inWorld(COND_WORKOUT, condUpdate);
    rerender(<SessionReceipt />);

    expect(screen.getByText('Approve')).toBeTruthy();
    fireEvent.press(screen.getByText('Approve'));
    expect(condUpdate).toHaveBeenCalledTimes(1);
    expect(getPendingProposal(KEY_COND)?.status).toBe('approved');
    expect(getPendingProposal(KEY_STRENGTH)?.status).toBe('declined');
  });

  it('approving strength does not make conditioning look already-applied', () => {
    const { rerender } = render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Approve'));
    expect(getLedgerEntries()).toHaveLength(1);

    inWorld(COND_WORKOUT, updateFrom(() => [COND_WORKOUT]));
    rerender(<SessionReceipt />);

    // Conditioning's own receipt: still a live proposal, not somebody else's
    // "Applied — undo available".
    expect(screen.queryByText(/Applied/)).toBeNull();
    expect(screen.getByText('Approve')).toBeTruthy();
  });
});
