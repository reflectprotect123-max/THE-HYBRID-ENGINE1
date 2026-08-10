import { useState, type FormEvent } from 'react';
import { useSync } from '../cloud/sync';

/*
 * Replaces CoachAccess's old `<Navigate to="/" replace />` fallback. Signing
 * in here uses the exact same signIn() Settings.tsx's CloudCard already
 * calls — one account, one door in a second place, not a second account.
 * No signUp control: account creation stays Settings-only.
 */
export function CoachSignIn() {
  const { signIn } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    try {
      setMsg((await signIn(email, password)) || '');
    } catch {
      // signIn REJECTING is not the same as it returning an error string, and
      // an unhandled rejection here would leave the form silent as well as
      // stuck. Say something rather than nothing.
      setMsg('Sign-in failed. Check your connection and try again.');
    } finally {
      // A REJECTED signIn is not a returned error string, and without this the
      // button would sit on "Signing in…" forever with no way to retry.
      setWorking(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-3 text-text">
      <form onSubmit={submit} className="w-full max-w-[320px] rounded-lg border border-line2 bg-panel3 p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-gold-line/70 bg-gold-wash text-sm font-black text-gold2">A</div>
          <div>
            <p className="text-[9px] uppercase tracking-[.2em] text-gold">ARC</p>
            <p className="text-sm font-semibold leading-tight">Coach workspace</p>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">Sign in with your account to continue.</p>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          required
          autoComplete="email"
          placeholder="email"
          aria-label="email"
          className="mb-2 w-full rounded-md border border-line2 bg-well px-2 py-2 text-sm text-text outline-none focus:border-gold-line"
        />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          required
          autoComplete="current-password"
          placeholder="password"
          aria-label="password"
          className="mb-2 w-full rounded-md border border-line2 bg-well px-2 py-2 text-sm text-text outline-none focus:border-gold-line"
        />
        {msg ? <p className="mb-2 text-xs text-warn" role="alert">{msg}</p> : null}
        <button
          type="submit"
          disabled={working}
          className="w-full rounded-md border border-gold-line bg-gold-wash px-2 py-2 text-sm font-semibold text-gold2 disabled:opacity-50"
        >
          {working ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
