import { freshSessionBlocks, uid, type Session, type Workout } from '@hybrid/engine';

/** A fresh live session minted from a workout — the ONE place Start happens,
 *  shared by Home's CTA and Training's list so the two cannot diverge. */
export function sessionFrom(w: Workout, date: string): Session {
  return {
    id: uid(),
    date,
    name: w.name || 'Session',
    status: 'active',
    blocks: freshSessionBlocks(w.blocks),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    workoutId: w.id,
  };
}
