import { freshSessionBlocks, uid, type Session, type Workout } from '@hybrid/engine';

/** A fresh live session minted from a workout — the ONE place Start happens,
 *  shared by Home's CTA and Training's list so the two cannot diverge. */
export function sessionFrom(w: Workout, date: string): Session {
  const blocks = freshSessionBlocks(w.blocks);
  const at = Date.now();
  return {
    id: uid(),
    // Carried forward from the workout rather than left for sanitizeDB to infer
    // from block contents on the next load — a session IS whatever kind its
    // workout is, and nothing else at runtime writes this field.
    kind: w.kind,
    date,
    name: w.name || 'Session',
    status: 'active',
    blocks,
    startedAt: at,
    /* The first block is entered the moment the session opens — the logger
       lands on block 0 — so its segment starts here rather than waiting for a
       `goToBlock` that never comes for a one-block session. See
       `Session.blockLog`. */
    ...(blocks[0]?.id ? { blockLog: [{ id: blocks[0].id, at }] } : {}),
    updatedAt: at,
    workoutId: w.id,
  };
}

export type DayTarget =
  | { kind: 'recap'; id: string }
  | { kind: 'today' }
  | { kind: 'preview'; date: string; workoutId?: string };

export function resolveDayTarget(dateKey: string, today: string, workoutId?: string, sessionId?: string): DayTarget {
  if (sessionId) return { kind: 'recap', id: sessionId };
  if (dateKey === today) return { kind: 'today' };
  return { kind: 'preview', date: dateKey, workoutId };
}
