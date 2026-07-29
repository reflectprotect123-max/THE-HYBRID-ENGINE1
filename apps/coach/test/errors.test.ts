import { describe, expect, it, vi } from 'vitest';
import { humanizeError } from '../src/errors';

describe('humanizeError', () => {
  it('maps network failures', () => {
    expect(humanizeError(new TypeError('Failed to fetch'))).toBe(
      "Can't reach the server — check your connection and try again.",
    );
  });
  it('maps Supabase auth strings', () => {
    expect(humanizeError({ message: 'Invalid login credentials' })).toBe(
      "That email and password don't match. Check them and try again.",
    );
    expect(humanizeError(new Error('Email not confirmed'))).toBe(
      'Confirm your email first — the link is in your inbox.',
    );
    expect(humanizeError(new Error('User already registered'))).toBe(
      'That email already has an account — sign in instead.',
    );
  });
  it('never leaks an emit contract string', () => {
    const out = humanizeError(new Error('emit: set 2/0/1 carries logger field "feltRpe"'));
    expect(out).not.toContain('emit:');
    expect(out).toBe("This session isn't sendable yet — reopen it in the builder and check each block.");
  });
  it('maps JSON noise and falls back on anything else', () => {
    expect(humanizeError(new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`))).toBe(
      'The server sent back something unexpected — try again in a minute.',
    );
    expect(humanizeError({})).toBe('Something went wrong. Try again, or check your connection.');
    expect(humanizeError(undefined)).toBe('Something went wrong. Try again, or check your connection.');
  });
  it('logs the raw error to the console, never the UI', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    humanizeError(new Error('PGRST301 something obscure'), 'publish');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
