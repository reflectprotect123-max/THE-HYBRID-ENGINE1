// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoachAccess } from './CoachShell';

let mockUserId: string | null = null;

vi.mock('../cloud/sync', () => ({
  useSync: () => ({ user: mockUserId ? { id: mockUserId } : null, signIn: vi.fn() }),
}));

vi.mock('./guard', () => ({
  coachAllowed: (userId: string | null | undefined) => userId === 'allowed-id',
}));

describe('CoachAccess', () => {
  it('renders the sign-in screen, not a redirect, when denied', () => {
    mockUserId = null;
    render(<CoachAccess><p>Coach content</p></CoachAccess>);
    expect(screen.queryByText('Coach content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders children when allowed', () => {
    mockUserId = 'allowed-id';
    render(<CoachAccess><p>Coach content</p></CoachAccess>);
    expect(screen.getByText('Coach content')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
