// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CoachAccess } from './CoachAccess';

let mockUserId: string | null = null;
let mockAuthReady = true;

vi.mock('../cloud/sync', () => ({
  useSync: () => ({
    user: mockUserId ? { id: mockUserId, email: 'someone@example.com' } : null,
    authReady: mockAuthReady,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('./guard', () => ({
  coachAllowed: (userId: string | null | undefined) => userId === 'allowed-id',
}));

// The unscoped dashboard build is the default here; the scoped-build branch of
// CoachAccess is a build-time constant, covered by the product module's own
// tests rather than re-mocked per case.
const mount = (children = <p>Coach content</p>) =>
  render(<MemoryRouter><CoachAccess>{children}</CoachAccess></MemoryRouter>);

describe('CoachAccess', () => {
  it('renders the sign-in screen, not a redirect, when denied', () => {
    mockUserId = null;
    mockAuthReady = true;
    mount();
    expect(screen.queryByText('Coach content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders children when allowed', () => {
    mockUserId = 'allowed-id';
    mockAuthReady = true;
    mount();
    expect(screen.getByText('Coach content')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('decides nothing while the stored session is still being restored', () => {
    // The allowed coach's own cold load: `user` is null here purely because
    // getSession has not resolved yet. Showing the sign-in form would be a
    // flash of the wrong answer.
    mockUserId = null;
    mockAuthReady = false;
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('offers a way out when signed in but not on the allowlist', () => {
    mockUserId = 'some-other-id';
    mockAuthReady = true;
    mount();
    expect(screen.queryByText('Coach content')).not.toBeInTheDocument();
    // Not the sign-in form again: signing in worked, so it would show no error
    // and leave the account stuck with no nav and no sign-out.
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not authorised/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /athlete app/i })).toBeInTheDocument();
  });
});
