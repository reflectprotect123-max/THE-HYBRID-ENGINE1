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
 *
 * `dataRecovered` is the boot-time counterpart: the stored blob could not be
 * read at all, so this render is starting from an EMPTY database rather than
 * whatever the athlete actually had. Silently showing a clean, empty app looks
 * identical to a fresh install — the athlete has no reason to suspect data is
 * missing until they go looking for history that is gone.
 */
export function SaveAlert() {
  const { saveFailed, dataRecovered } = useDb();
  if (!saveFailed && !dataRecovered) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-40 mx-auto w-full max-w-[560px] border-b border-[color:var(--color-bad)]/40 bg-[color:var(--color-bad)]/15 px-2 py-1 pt-[calc(8px+env(safe-area-inset-top))] text-3 font-[650] text-bad backdrop-blur"
    >
      {saveFailed
        ? "Not saved — this device's storage is full. Nothing logged from here will survive a reload. Export a backup from Settings, or free some space."
        : "This device's saved data couldn't be read and had to be reset. If you have a backup, restore it from Settings."}
    </div>
  );
}
