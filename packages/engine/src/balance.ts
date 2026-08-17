import { isCond } from './session';
import type { CondResult, Session, Settings } from './types';

/*
 * `loadBalance` — the strength-vs-conditioning trade-off readout — was
 * deleted whole on 17 August 2026 with the rest of strength: it existed
 * to compare `sessionVolume`/`bestE1rmByLift` against conditioning load,
 * and there is no more strength side to compare. `condEfforts` stays; it
 * is conditioning's own effort list, read by `conditioning.ts` and both
 * apps' conditioning screens, with no strength dependency.
 */

/**
 * Every conditioning effort, from both places they live.
 *
 * A conditioning block inside a session stores its result on the block; a
 * standalone run stores it in `settings.conditioning`. Both count as training,
 * and a readout that saw only one of them would be wrong by however you happen
 * to log.
 *
 * `settings.conditioning` arriving as a non-array is truthy, and spreading it
 * throws — the same corrupt-blob shape both Progress screens already guard.
 */
export function condEfforts(sessions: Session[], settings: Settings = {}): CondResult[] {
  const inline = (sessions || []).flatMap((s) =>
    (s.blocks || []).filter(isCond).map((b) => b.condResult).filter(Boolean) as CondResult[],
  );
  const standalone = Array.isArray(settings.conditioning) ? (settings.conditioning as CondResult[]) : [];
  return [...standalone, ...inline].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}
