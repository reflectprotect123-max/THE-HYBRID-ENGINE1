import { useNavigate } from 'react-router-dom';
import { useSync } from '../../cloud/sync';

/*
 * Signing in successfully and still being refused is a different answer from
 * being signed out, and CoachSignIn cannot say it: the form would simply
 * re-render with no error, since nothing about the sign-in failed. This screen
 * says the real thing and — because it renders OUTSIDE the athlete Shell, so
 * there is no nav bar underneath it — carries its own two ways out.
 */
export function CoachNotAuthorized() {
  const { user, signOut } = useSync();
  const navigate = useNavigate();

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-3 text-text">
      <div className="w-full max-w-[320px] rounded-lg border border-line2 bg-panel3 p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-gold-line/70 bg-gold-wash text-sm font-black text-gold2">A</div>
          <div>
            <p className="text-[9px] uppercase tracking-[.2em] text-gold">ARC</p>
            <p className="text-sm font-semibold leading-tight">Coach workspace</p>
          </div>
        </div>
        <p className="mb-2 text-xs text-muted">
          This account is not authorised for the coach workspace.
        </p>
        {user?.email ? (
          <p className="mb-3 truncate text-xs text-dim" title={user.email}>
            Signed in as {user.email}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void signOut()}
          className="mb-2 w-full rounded-md border border-gold-line bg-gold-wash px-2 py-2 text-sm font-semibold text-gold2"
        >
          Sign out
        </button>
        <button
          type="button"
          onClick={() => navigate('/training')}
          className="w-full rounded-md border border-line2 bg-well px-2 py-2 text-sm text-text"
        >
          Go to the athlete app
        </button>
      </div>
    </main>
  );
}
