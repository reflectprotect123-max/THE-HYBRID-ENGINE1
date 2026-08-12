import type { Workout } from '@hybrid/engine';

/**
 * The sessions a program version's body carries.
 *
 * `program_template_versions.body` is jsonb the migration documents as "the
 * engine-shaped body: sessions per week, weeks, progression model, blocks",
 * and `arc-athlete-sync.ts` records that it is "unconstrained, coach-written".
 * So this is the one place that decides what counts as a session, and it never
 * throws: a Library that crashes on a single malformed template shows the
 * coach nothing at all, which is worse than showing that one program as empty.
 *
 * A session needs an id to be addressable. Missing blocks make an EMPTY
 * session, not a broken one — a named shell is a real thing a coach creates
 * before filling it, and dropping it would hide work that exists.
 */
export function sessionsFromBody(body: unknown): Workout[] {
  if (!body || typeof body !== 'object') return [];
  const raw = (body as { sessions?: unknown }).sessions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .filter((s) => typeof s.id === 'string' && (s.id as string).length > 0)
    .map((s) => ({
      ...(s as unknown as Workout),
      blocks: Array.isArray(s.blocks) ? (s.blocks as Workout['blocks']) : [],
    }));
}
