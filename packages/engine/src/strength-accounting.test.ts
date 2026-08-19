import { describe, expect, it } from 'vitest';
import type { StrengthBlock } from '@hybrid/strength-engine';
import { hasLoggedWork, hasStrengthPrescription } from './session';
import { expireStaleSessions } from './db';
import { sessionProgress } from './logger';
import type { AnySet, Block, Session } from './types';

/*
 * Strength session accounting under Phase A of the strength rebuild
 * (docs/superpowers/specs/2026-08-17-strength-rebuild-design.md).
 *
 * The block as stored in EngineDB is PRESCRIPTION only — `StrengthBlockItem`s
 * of `PrescribedSet`s, no performed-state — because performed sets live
 * server-side in Phase A's model. So the honest local semantics are:
 *
 *   - a strength block counts toward session EXISTENCE: `expireStaleSessions`
 *     must never bin a strength day as untrained, because the device cannot
 *     see whether it was trained;
 *   - it contributes NO per-set progress, no logged-work claim and no felt
 *     RPE until Phase C defines on-device strength logging.
 *
 * These cases pin both halves, so neither can silently regress into either
 * "strength sessions vanish overnight" or "a bare prescription reads as a
 * trained day".
 */

const strengthBlock = (items = 1): StrengthBlock => ({
  id: 'sb-1',
  kind: 'strength',
  heading: 'Main lift',
  items: Array.from({ length: items }, (_, i) => ({
    id: `item-${i + 1}`,
    kind: 'strength' as const,
    exerciseId: 'sq',
    groupingKey: null,
    sets: [{ id: `set-${i + 1}`, ordinal: 1, isOptional: false, isAmrap: false, targets: [{ metricKey: 'reps' as const, literalValue: 5 }] }],
  })),
});

const session = (blocks: Block<AnySet>[], extra: Partial<Session> = {}): Session =>
  ({ id: 's', date: '2026-08-01', status: 'active', blocks, ...extra }) as unknown as Session;

describe('hasStrengthPrescription', () => {
  it('is true for a session carrying a strength block with items', () => {
    expect(hasStrengthPrescription(session([strengthBlock()]))).toBe(true);
  });

  it('is false for an itemless strength block — an empty shell prescribes nothing', () => {
    expect(hasStrengthPrescription(session([strengthBlock(0)]))).toBe(false);
  });

  it('is false for cond/text-only sessions and for null', () => {
    const run = { id: 'c', kind: 'conditioning', condFmt: 'steady' } as unknown as Block<AnySet>;
    const metcon = { id: 't', kind: 'text', done: true } as unknown as Block<AnySet>;
    expect(hasStrengthPrescription(session([run, metcon]))).toBe(false);
    expect(hasStrengthPrescription(null)).toBe(false);
  });

  it('does NOT make hasLoggedWork claim a trained day — prescription is not logging', () => {
    expect(hasLoggedWork(session([strengthBlock()]))).toBe(false);
  });
});

describe('expireStaleSessions and strength existence', () => {
  const today = '2026-08-19';

  it('promotes a stale strength-only session to incomplete instead of binning it', () => {
    const s = session([strengthBlock()], { startedAt: 1000 });
    const { sessions, changed } = expireStaleSessions([s], today, 5000);
    expect(changed).toBe(true);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('incomplete');
    // Same completedAt fallback the logged-work branch already uses.
    expect(sessions[0].completedAt).toBe(1000);
  });

  it('still drops a stale session with no logged work and no strength prescription', () => {
    const s = session([strengthBlock(0)]);
    const { sessions, changed } = expireStaleSessions([s], today, 5000);
    expect(changed).toBe(true);
    expect(sessions).toHaveLength(0);
  });

  it('leaves today\'s active strength session alone', () => {
    const s = session([strengthBlock()], { date: today });
    const { sessions, changed } = expireStaleSessions([s], today, 5000);
    expect(changed).toBe(false);
    expect(sessions[0].status).toBe('active');
  });
});

describe('sessionProgress and strength blocks', () => {
  it('a strength block contributes neither done nor total — no unfillable meter segment', () => {
    expect(sessionProgress(session([strengthBlock()]))).toEqual({ done: 0, total: 0, pct: 0 });
  });

  it('a mixed session still reaches 100% on its loggable blocks alone', () => {
    const run = { id: 'c', kind: 'conditioning', condFmt: 'steady', condResult: { fmt: 'steady' } } as unknown as Block<AnySet>;
    expect(sessionProgress(session([strengthBlock(), run]))).toEqual({ done: 1, total: 1, pct: 100 });
  });
});
