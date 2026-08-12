import { render, fireEvent, screen } from '@testing-library/react-native';
import { ModeSwitcher } from './ModeSwitcher';
import { resetConsentForTests, getConsent } from './consent';
import { resetPolicyForTests, getPolicy } from './policy';

beforeEach(() => {
  resetConsentForTests();
  resetPolicyForTests();
});

describe('mobile ModeSwitcher', () => {
  it('shows Shadow as the current mode initially', () => {
    render(<ModeSwitcher />);
    expect(screen.getByText('Shadow')).toBeTruthy();
  });

  it('starting the quiz and answering everything correctly advances to Assisted', () => {
    render(<ModeSwitcher />);
    fireEvent.press(screen.getByText('Turn on Assisted'));
    fireEvent.press(screen.getByText('Continue'));
    // Answer each statement per COMPREHENSION_STATEMENTS' known correct values
    const trueButtons = screen.getAllByText('True');
    const falseButtons = screen.getAllByText('False');
    fireEvent.press(trueButtons[0]); // statement 0: correct=true
    fireEvent.press(falseButtons[1]); // statement 1: correct=false
    fireEvent.press(falseButtons[2]); // statement 2: correct=false
    fireEvent.press(falseButtons[3]); // statement 3: correct=false
    fireEvent.press(trueButtons[4]); // statement 4: correct=true
    fireEvent.press(screen.getByText('Submit'));
    expect(getPolicy().mode).toBe('assisted');
    expect(getConsent().proposalsConsent?.accepted).toBe(true);
  });

  it('a wrong quiz answer shows the retry message and does not advance mode', () => {
    render(<ModeSwitcher />);
    fireEvent.press(screen.getByText('Turn on Assisted'));
    fireEvent.press(screen.getByText('Continue'));
    const trueButtons = screen.getAllByText('True');
    // Answer all 5 as True (statements 1-3 are actually false, so this is wrong)
    for (let i = 0; i < 5; i++) fireEvent.press(screen.getAllByText('True')[i] ?? trueButtons[0]);
    fireEvent.press(screen.getByText('Submit'));
    expect(screen.getByText(/Not quite/)).toBeTruthy();
    expect(getPolicy().mode).toBe('shadow');
  });

  it('Cancel returns to idle without recording any consent', () => {
    render(<ModeSwitcher />);
    fireEvent.press(screen.getByText('Turn on Assisted'));
    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.getByText('Turn on Assisted')).toBeTruthy();
    expect(getConsent().proposalsConsent).toBeNull();
  });

  it('revoking proposals consent clamps mode back to shadow', () => {
    recordConsentHelper();
    render(<ModeSwitcher />);
    fireEvent.press(screen.getByText('Revoke reading & proposing'));
    expect(getPolicy().mode).toBe('shadow');
  });
});

function recordConsentHelper() {
  const { recordConsent } = jest.requireActual('./consent');
  const { updatePolicy } = jest.requireActual('./policy');
  recordConsent('proposals', true);
  updatePolicy((p: import('@hybrid/auto-coach').AutonomyPolicy) => ({ ...p, mode: 'assisted' }));
}
