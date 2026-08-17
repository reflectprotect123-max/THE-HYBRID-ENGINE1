import type { CondBlock, CondFmtKey, EffortKey, ZoneKey } from './types';

/*
 * THE Hybrid System — emit contract (coach → athlete).
 *
 * The ONE boundary between the coach app and the athlete app. It builds
 * athlete-shape workouts and pins the athlete's enums and field names, so a
 * future rename fails the contract test loudly instead of silently shipping
 * broken sessions to athletes.
 *
 * The athlete's LOGGER — never the coach — writes the actual-result set fields
 * (aVal, aVal2, felt, done, note). emit MUST never write those; `assert` throws
 * if it sees one, so a target can never masquerade as a logged result.
 */

export const COND_FORMATS: CondFmtKey[] = ['steady', 'intervals', 'tempo', 'custom', 'free'];
export const ZONES: ZoneKey[] = ['low', 'mod', 'high'];

/** Effort names and the zone each one holds. Both are emitted so a reader that
    knows only about zones keeps working. */
export const EFFORTS: Record<EffortKey, ZoneKey> = { easy: 'low', medium: 'mod', hard: 'high' };

export const LB_TO_KG = 0.45359237;

/* Reached through globalThis because the engine targets browser, React Native
   and Node, and only some of those declare `crypto` as a global binding. */
function eid(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* falls through to the timestamp form */
  }
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const s = (v: unknown): string => (v == null ? '' : String(v));

/* `newSet`/`ExOpts`/`newEx`/`BlockOpts`/`newBlock` were deleted whole on
   17 August 2026 with the rest of strength — they built PlannedSet/
   Exercise/StrengthBlock content, none of which callers ever reached
   through this contract (nothing called them but `emit.test.ts`). */

/** Takes an effort (easy/medium/hard) and emits BOTH it and the zone it holds.
    Passing a bare zone still works, for plans authored before effort existed. */
export function newCondBlock(
  heading: string,
  condFmt: string,
  effortOrZone?: string,
  minutes?: number | string,
): CondBlock {
  const fmt: CondFmtKey = (COND_FORMATS as string[]).includes(condFmt)
    ? (condFmt as CondFmtKey)
    : 'intervals';
  let effort: EffortKey = 'medium';
  let zone: ZoneKey = 'mod';
  const k = String(effortOrZone || '').toLowerCase();

  if (k in EFFORTS) {
    effort = k as EffortKey;
    zone = EFFORTS[effort];
  } else if ((ZONES as string[]).includes(k)) {
    zone = k as ZoneKey;
    (Object.keys(EFFORTS) as EffortKey[]).forEach((e) => {
      if (EFFORTS[e] === zone) effort = e;
    });
  }

  return {
    id: eid(),
    kind: 'conditioning',
    heading: s(heading) || 'Conditioning',
    condFmt: fmt,
    effort,
    targetZone: zone,
    minutes: s(minutes),
  };
}

/*
 * WHAT THIS FILE NO LONGER DOES, and what to restore if the need returns.
 *
 * `newWorkout`, `measureToMode`, `lbToKg` and `assertWorkout` were deleted on
 * 15 August 2026 with the rest of the unreferenced engine surface. All four
 * belonged to a coach IMPORT path — a coach editor with ~19 measure columns
 * feeding athlete-shape workouts through a validator — and that path was never
 * built. Nothing called any of them.
 *
 * `assertWorkout` is the one worth naming, because deleting a validator reads
 * worse than it is. It threw on an out-of-whitelist enum and on any set
 * carrying a LOGGER-owned field (`aVal`, `aVal2`, `felt`, `done`, `note`) — the
 * rule stated in the header above, which is that a coach's target must never be
 * able to masquerade as a logged result. That rule still holds and is still
 * written down here; what is gone is an unused function that enforced it on a
 * path with no traffic. If coach-published workouts ever need validating on the
 * way in, restore it from git rather than writing a second one.
 */
