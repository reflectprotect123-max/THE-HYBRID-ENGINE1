import { useDb } from '../store/db';

/**
 * The one thing the athlete must be told immediately.
 *
 * A failed write leaves the app looking perfectly healthy: `update` has already
 * committed to memory, so the stage draws the tick, the progress bar moves, and
 * every set logged from here on vanishes on the next reload. Settings carries
 * the same warning, but nobody opens Settings mid-workout — this sits above
 * every screen, including the full-screen logger and plan editor, which are
 * outside the shell.
 */
export function SaveAlert() {
  const { saveFailed } = useDb();
  if (!saveFailed) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-40 mx-auto w-full max-w-[560px] border-b border-[color:var(--color-bad)]/40 bg-[color:var(--color-bad)]/15 px-2 py-1 pt-[calc(8px+env(safe-area-inset-top))] text-3 font-[650] text-bad backdrop-blur"
    >
      Not saved — this device&apos;s storage is full. Nothing logged from here will survive a reload. Export a backup
      from Settings, or free some space.
    </div>
  );
}
