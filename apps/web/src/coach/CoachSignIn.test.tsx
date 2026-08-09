// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CoachSignIn } from './CoachSignIn';

const signIn = vi.fn();

vi.mock('../cloud/sync', () => ({
  useSync: () => ({ signIn }),
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

  it('has no sign-up control — account creation stays on Settings', () => {
    render(<CoachSignIn />);
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });
});
