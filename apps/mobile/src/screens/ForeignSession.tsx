import { useDb } from '../store/db';
import { disciplineOf, setDiscipline } from '../discipline';
import { T, Tap } from '../ui';

/**
 * The way back to a live session in another world.
 *
 * `splitActiveSession` routes a session the current world cannot show into
 * `foreignActiveSession` precisely so this notice can offer the way back —
 * without it, switching worlds mid-session silently abandons the logged work
 * to `expireStaleSessions`, which flips it to `incomplete` after the date
 * rolls over.
 *
 * It lives in its own file because it must render in EVERY world. It was
 * defined inside the training Home screen, and the nutrition navigator
 * registers no Home — so an athlete who started a session, switched to
 * Nutrition to log dinner and left the app there was never told, on any of the
 * five nutrition tabs, that a session was still open. The one world where the
 * athlete cannot see the session for themselves was the one world with no
 * notice.
 *
 * The destination comes from the SESSION's own kind, not from "the other
 * training world" — from Nutrition there is no other training world to infer.
 */
export function ForeignSessionNotice() {
  const { foreignActiveSession } = useDb();
  if (!foreignActiveSession) return null;
  const target = disciplineOf(foreignActiveSession.kind);
  const name = target === 'conditioning' ? 'Conditioning' : 'Strength';
  return (
    <Tap
      box={{ h: 48 }}
      onPress={() => setDiscipline(target)}
      accessibilityLabel={`A session is in progress in ${name} — switch to it`}
      className="mt-2 flex-row items-center justify-between rounded-md border border-gold-line bg-gold-wash px-2 py-1.5"
    >
      <T className="text-4 text-text">Session in progress in {name}</T>
      <T className="text-4 text-muted">Switch →</T>
    </Tap>
  );
}
