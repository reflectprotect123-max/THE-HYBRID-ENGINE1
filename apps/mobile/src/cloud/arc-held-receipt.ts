import type { SupabaseClient } from '@supabase/supabase-js';
import { storage } from '../store/storage';

/*
 * The ATHLETE -> COACH half of a held session.
 *
 * When the safety layer stops a coach's session, two people need to know. The
 * athlete is told on the card that computed it. This is the other direction,
 * and the design doc says why it is not optional: "a coach who cannot tell
 * 'held for injury' from 'ignored me' will distrust the whole system within a
 * week."
 *
 * IT REUSES `push_autocoach_receipt` RATHER THAN INVENTING A PATH. That RPC is
 * already athlete-authenticated, org-scoped, and validates `operations`
 * element by element and `reason_codes` against closed vocabularies —
 * 20260814_arc_held_session_receipt.sql widened its action list by exactly one
 * value to admit a hold, because every line of reasoning in that sanitiser
 * applies unchanged here and a second copy is the one that drifts.
 *
 * WHAT TRAVELS, AND WHAT DOES NOT
 *
 * `operations` is EMPTY. Nothing was modified — the session was stopped, which
 * is a different fact from auto-coach trimming one, and sending the operations
 * of a resolution that was never applied would say the opposite.
 *
 * NO SESSION NAME. The receipt carries `workoutId`, and the coach resolves it
 * against the week they themselves published. That keeps the boundary this
 * receipt tier has held since it was written: block and set level content
 * never crosses, and a name is not smuggled through a field that exists for an
 * id.
 *
 * ONLY THE SAFETY CODES. `resolution.reasonCodes` can carry readiness and load
 * signals too, and those are not this athlete's coach's business on a safety
 * report — the bench renders a hold as a medical fact, so anything that is not
 * a safety flag is filtered out here rather than left for the reader to
 * ignore. A resolution that is `safety_stop` with no safety code is not sent
 * at all; the server would accept it and the bench would correctly drop it,
 * which is a round trip that proves nothing.
 */

/** The two the receipt exists to carry. Both have been in the RPC's closed
 *  vocabulary since 8 August; neither needed inventing. */
const SAFETY_CODES = new Set(['pain_hold_active', 'illness_flag_active']);

const PUSHED_HOLDS_KEY = 'hybrid-arc-pushed-holds-v1';

function loadPushed(): Set<string> {
  try {
    const raw = JSON.parse(storage.getItem(PUSHED_HOLDS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePushed(ids: Set<string>): void {
  try {
    // Capped like every other id set in this directory, for the same reason:
    // a long-lived account must not fill storage with bookkeeping.
    storage.setItem(PUSHED_HOLDS_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* Worst case the same hold is pushed again, and `push_autocoach_receipt`
       is idempotent on (org, athlete, client_entry_id) — so the server-side
       result is identical. */
  }
}

/** Test seam: the storage port under jest is the in-memory shim, so a suite
 *  has to be able to put it back. */
export function resetHeldReceiptsForTests(): void {
  try {
    storage.removeItem(PUSHED_HOLDS_KEY);
  } catch {
    /* nothing to clear */
  }
}

export interface HeldSessionReport {
  /** The coach-authored session's own id — never its name. */
  workoutId: string;
  /** The day it was held, `YYYY-MM-DD`. */
  sessionDate: string;
  /** Straight from `resolveSession`; filtered to safety codes before sending. */
  reasonCodes: readonly string[];
}

/** Stable per session per day, so a re-render, a re-mount or a second sync on
 *  the same afternoon replays rather than filing a second hold. */
export const heldEntryId = (r: HeldSessionReport): string => `held:${r.sessionDate}:${r.workoutId}`;

/** The safety codes on a resolution, in the RPC's vocabulary. Empty when the
 *  stop was not a safety one, which is the signal not to send. */
export function safetyCodesOf(reasonCodes: readonly string[]): string[] {
  return [...new Set(reasonCodes.filter((c) => SAFETY_CODES.has(c)))];
}

/**
 * Best-effort, silent, and never blocking. An athlete with no coach has no
 * organisation and every call refuses — that must not surface as an error on a
 * training screen, exactly like every other ARC read on this device.
 *
 * Returns the number actually sent, for the tests and for telemetry later.
 */
export async function pushHeldSessions(
  client: SupabaseClient,
  orgId: string,
  reports: readonly HeldSessionReport[],
): Promise<number> {
  if (!orgId || reports.length === 0) return 0;
  const pushed = loadPushed();
  let sent = 0;

  for (const report of reports) {
    const codes = safetyCodesOf(report.reasonCodes);
    // A safety_stop with no safety code is not a hold this receipt can
    // describe. The bench drops it too, so sending it is a round trip that
    // proves nothing — and the two layers agreeing on that independently is
    // deliberate, not duplication.
    if (codes.length === 0) continue;

    const id = heldEntryId(report);
    if (pushed.has(id)) continue;

    try {
      const { error } = await client.rpc('push_autocoach_receipt', {
        p_organization_id: orgId,
        p_client_entry_id: id,
        p_occurred_at: new Date().toISOString(),
        p_session_date: report.sessionDate,
        p_workout_id: report.workoutId,
        p_action: 'held',
        p_was_forked: false,
        p_operations: [],
        p_reason_codes: codes,
      });
      if (error) continue;
      // Marked only on a CONFIRMED write. Marking optimistically would lose a
      // hold permanently on one network blip, and a lost hold is a coach
      // seeing "ignored me" for a session that was stopped for injury —
      // exactly the outcome this whole step exists to prevent.
      pushed.add(id);
      sent += 1;
    } catch {
      /* Best-effort. The next reconcile tries again because the id was never
         marked. */
    }
  }

  if (sent > 0) savePushed(pushed);
  return sent;
}
