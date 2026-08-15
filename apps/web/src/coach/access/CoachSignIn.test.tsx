// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CoachSignIn } from './CoachSignIn';

const signIn = vi.fn();

vi.mock('../../cloud/sync', () => ({
  useSync: () => ({ user: null, authReady: true, signIn }),
}));

describe('CoachSignIn', () => {
  it('calls signIn with the entered email and password on submit', async () => {
    signIn.mockResolvedValueOnce(null);
    render(<CoachSignIn />);
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await Promise.resolve();
    expect(signIn).toHaveBeenCalledWith('coach@example.com', 'hunter2');
  });

  it('shows the error message signIn returns, on a failed attempt', async () => {
    signIn.mockResolvedValueOnce('Invalid email or password.');
    render(<CoachSignIn />);
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });

  it('releases the button when signIn REJECTS rather than returning an error', async () => {
    signIn.mockRejectedValueOnce(new Error('network down'));
    render(<CoachSignIn />);
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'hunter2' } });
    const button = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveTextContent(/^Sign in$/);
  });

  it('requires both fields, so an empty submit never reaches the network', () => {
    render(<CoachSignIn />);
    expect(screen.getByLabelText('email')).toBeRequired();
    expect(screen.getByLabelText('password')).toBeRequired();
  });

  it('has no sign-up control — account creation stays on Settings', () => {
    render(<CoachSignIn />);
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });
});
