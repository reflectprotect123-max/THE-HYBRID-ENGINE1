import { describe, expect, it } from 'vitest';
import { resolveSession, DEFAULT_POLICY } from '@hybrid/auto-coach';
import {
  buildFixtureSnapshot,
  buildFixtureWorkout,
} from './simulateFixtures';

describe('buildFixtureWorkout', () => {
  it('builds a minimal single-block strength example', () => {
    const w = buildFixtureWorkout('strength');
    expect(w.kind).toBe('strength');
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].exercises).toHaveLength(1);
    expect(w.blocks[0].exercises![0].sets).toHaveLength(3);
  });

  it('builds a minimal single-block conditioning example', () => {
    const w = buildFixtureWorkout('conditioning');
    expect(w.kind).toBe('conditioning');
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].kind).toBe('conditioning');
  });
});

describe('buildFixtureSnapshot', () => {
  it('none preset carries no constraints and a clear illness status', () => {
    const s = buildFixtureSnapshot('none', '2026-08-06');
    expect(s.constraints).toEqual([]);
    expect(s.illness.status).toBe('clear');
  });

  it('hard presets produce a hard constraint the resolver must treat as safety_stop', () => {
    for (const preset of ['pain_hold_active', 'illness_flag_active'] as const) {
      const s = buildFixtureSnapshot(preset, '2026-08-06');
      expect(s.constraints).toHaveLength(1);
      expect(s.constraints[0].hard).toBe(true);
      expect(s.constraints[0].code).toBe(preset);

      const r = resolveSession({ workout: buildFixtureWorkout('strength'), policy: DEFAULT_POLICY, state: s });
      expect(r.state).toBe('safety_stop');
      expect(r.autoApplyAllowed).toBe(false);
    }
  });

  it('soft presets produce a soft constraint the resolver may act on', () => {
    for (const preset of ['low_readiness', 'time_limited'] as const) {
      const s = buildFixtureSnapshot(preset, '2026-08-06');
      expect(s.constraints).toHaveLength(1);
      expect(s.constraints[0].hard).toBe(false);
      expect(s.constraints[0].code).toBe(preset);
    }
  });

  it('illness_flag_active sets illness status to active, not merely a constraint', () => {
    const s = buildFixtureSnapshot('illness_flag_active', '2026-08-06');
    expect(s.illness.status).toBe('active');
  });

  it('low_readiness lowers the readiness band consistently with its own constraint', () => {
    const s = buildFixtureSnapshot('low_readiness', '2026-08-06');
    expect(s.readiness.band).toBe('low');
  });
});
