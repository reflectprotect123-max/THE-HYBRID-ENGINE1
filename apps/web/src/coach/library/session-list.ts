import type { Workout } from '@hybrid/engine';
import { INSTRUCTIONS_HEADING } from './day-workout';

/**
 * The coach's authored sessions — Stage 3c's "Sessions", as data.
 *
 * 3c specified Sessions as a Library TAB. The owner deleted the Library's tabs
 * on 11 August 2026, so what the spec was actually for survives and the tab
 * does not: the Calendar's "Add from library" needs a list of sessions to pull
 * from, and that list is this. Per 3c's own rule — "One editor: Sessions opens
 * the day builder, it does not grow its own" — picking one seeds the day
 * builder rather than opening anything new.
 *
 * Derived from `EngineDB.workouts`, which is where the day builder, the
 * Planner and the guided builder all write. A separate coach-only session
 * store would be a second answer to "what has this coach written".
 */
export interface SessionSummary {
  id: string;
  name: string;
  /** Absent on a workout with no blocks — the engine does not guess a kind and neither does this. */
  kind?: 'strength' | 'conditioning';
  /** Blocks the athlete would actually see, excluding the coach-instructions note. */
  blockCount: number;
  updatedAt?: number;
  /** The dates this session is already scheduled on, if any. */
  dates: readonly string[];
}

function isInstructions(block: { kind?: string; heading?: string }): boolean {
  return block.kind === 'text' && block.heading === INSTRUCTIONS_HEADING;
}

/**
 * Every session worth offering, newest first.
 *
 * A workout with NO blocks is excluded: the guided builder creates an empty
 * shell up front and deletes it again if you abandon the flow
 * (`GuidedBuilder.tsx`'s `abandon`), so an empty workout is usually a
 * half-open editor rather than a session, and offering it to paste onto a day
 * would paste nothing. Sample data is excluded for the same reason it is
 * everywhere else — it is not the coach's work.
 */
export function authoredSessions(workouts: readonly Workout[]): SessionSummary[] {
  return workouts
    .filter((w) => !w.sample)
    .map((w) => ({
      id: w.id,
      name: w.name?.trim() || 'Untitled session',
      kind: w.kind,
      blockCount: (w.blocks ?? []).filter((b) => !isInstructions(b)).length,
      updatedAt: w.updatedAt,
      dates: w.dates ?? [],
    }))
    .filter((s) => s.blockCount > 0)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** Case-insensitive name search. An empty query filters nothing. */
export function filterSessions(sessions: readonly SessionSummary[], query: string): SessionSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sessions];
  return sessions.filter((s) => s.name.toLowerCase().includes(q));
}
