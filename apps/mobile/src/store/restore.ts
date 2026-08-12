import { expireStaleSessions, sanitizeDB, type EngineDB } from '@hybrid/engine';

/*
 * The validating half of restore-from-paste (Settings' BackupCard).
 *
 * Reuses the boot path's own sanitizer rather than inventing a second
 * validator: whatever shape survives `sanitizeDB` is by definition a shape
 * the app can run on. The shape CHECK before it exists only to tell honest
 * garbage apart from a valid-but-empty database — sanitizeDB would happily
 * coerce `{}` into an empty DB, and "Restore" silently wiping a phone
 * because someone pasted the wrong clipboard is exactly the failure this
 * screen exists to prevent.
 */
export function parseBackup(
  text: string,
): { db: EngineDB; sessions: number; lastDate: string | null } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Never the parser's own message — "Unexpected token" is noise to the
    // person holding the phone.
    return { error: "That doesn't look like a Hybrid backup." };
  }
  const r = raw as Record<string, unknown> | null;
  const looksLikeBackup =
    !!r && typeof r === 'object' && !Array.isArray(r) && (Array.isArray(r.sessions) || Array.isArray(r.workouts));
  if (!looksLikeBackup) return { error: "That doesn't look like a Hybrid backup." };

  const db = sanitizeDB(raw);
  // The boot path expires yesterday's still-'active' sessions; a restore is
  // a boot in disguise, so it runs the same pass — otherwise an old backup
  // resurrects a phantom "In progress" card until the next real restart.
  // (It FILTERS rather than mutating: keep its returned array.)
  db.sessions = expireStaleSessions(db.sessions).sessions;
  let lastDate: string | null = null;
  for (const s of db.sessions) if (s.date && (!lastDate || s.date > lastDate)) lastDate = s.date;
  return { db, sessions: db.sessions.length, lastDate };
}
