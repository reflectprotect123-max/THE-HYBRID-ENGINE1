import { describe, expect, it } from 'vitest';
import { sanitizeDB } from './db';
import { hasLoggedWork, isText, newTextBlock, sessionVolume } from './session';
import { sessionProgress, ssGroups } from './logger';
import type { Session, TextBlock } from './types';

/*
 * A block that is just words.
 *
 * A metcon — "AMRAP 12: 10 burpees, 15 KB swings, 200m run" — is one
 * prescription that does not decompose into sets of a movement without lying
 * about it. Every number forced out of it would be fiction, so this block
 * records exactly one thing: whether you did it.
 */
const withText = (over: Partial<TextBlock> = {}): Session =>
  ({
    id: 's',
    date: '2026-01-02',
    status: 'active',
    blocks: [{ ...newTextBlock(), body: 'AMRAP 12\n10 burpees', ...over }],
  }) as unknown as Session;

describe('text blocks', () => {
  it('a fresh one is recognisable and carries no exercises', () => {
    const b = newTextBlock();
    expect(isText(b)).toBe(true);
    expect((b as { exercises?: unknown }).exercises).toBeUndefined();
  });

  it('contributes nothing to tonnage, because it has nothing to measure', () => {
    expect(sessionVolume(withText({ done: true }))).toBe(0);
  });

  it('does NOT count as trained until it is ticked', () => {
    // Written-but-not-done is a plan, and a plan is not training.
    expect(hasLoggedWork(withText())).toBe(false);
  });

  it('counts as trained once ticked', () => {
    // Without this the day reads as untrained and expireStaleSessions bins it.
    expect(hasLoggedWork(withText({ done: true }))).toBe(true);
  });

  it('survives sanitize WITHOUT being given a phantom exercise', () => {
    // The strength path injects an empty exercise into any block that has none,
    // which would render a blank movement under every metcon.
    const db = sanitizeDB({ sessions: [withText()], workouts: [], settings: {} });
    const b = db.sessions[0].blocks[0];
    expect(isText(b)).toBe(true);
    expect((b as { exercises?: unknown }).exercises).toBeUndefined();
  });

  it('keeps its body and heading through sanitize', () => {
    const db = sanitizeDB({ sessions: [withText({ heading: 'Chipper' })], workouts: [], settings: {} });
    const b = db.sessions[0].blocks[0] as TextBlock;
    expect(b.heading).toBe('Chipper');
    expect(b.body).toContain('AMRAP 12');
  });

  it('has no superset chains to compute', () => {
    expect(ssGroups(withText().blocks[0])).toEqual([]);
  });

  it('a ticked metcon counts as done, and a metcon-only session can reach 100%', () => {
    const s: Session = {
      id: 's',
      date: '2026-01-01',
      status: 'active',
      blocks: [{ id: 'b', kind: 'text', heading: 'Metcon', body: 'AMRAP 12', done: true } as TextBlock],
    };
    expect(sessionProgress(s)).toEqual({ done: 1, total: 1, pct: 100 });
  });
});
