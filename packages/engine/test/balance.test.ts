import { describe, expect, it } from 'vitest';
import { loadBalance } from '../src/balance';
import type { CondResult, Session, Settings } from '../src/types';

/*
 * The load-balance readout.
 *
 * Most of these are silence tests. The failure mode for a feature like this is
 * not being wrong once — it is having something to say every single time it
 * runs, which is how a readout becomes wallpaper. So the cases that must return
 * null outnumber the ones that must return a verdict, on purpose.
 */

const DAY = 864e5;
const NOW = Date.UTC(2026, 6, 27, 12);

function ymdOf(daysAgo: number): string {
  const d = new Date(NOW - daysAgo * DAY);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/** A finished lift session: one movement, one done set at `kg` × `reps`. */
function lift(daysAgo: number, name: string, kg: number, reps = 5): Session {
  return {
    id: `s${daysAgo}${name}`,
    date: ymdOf(daysAgo),
    status: 'completed',
    blocks: [
      {
        id: `b${daysAgo}${name}`,
        heading: 'Main',
        exercises: [
          {
            id: `e${daysAgo}${name}`,
            name,
            mode: 'reps_kg',
            sets: [{ t: String(reps), rpe: '8', done: true, aVal: String(kg), aVal2: String(reps) }],
          },
        ],
      },
    ],
  } as unknown as Session;
}

/** A standalone conditioning effort `daysAgo`, `min` minutes long. */
function run(daysAgo: number, min: number | null): CondResult {
  const r: CondResult = { id: `c${daysAgo}${min}`, startedAt: NOW - daysAgo * DAY };
  if (min != null) r.dur = min * 60;
  return r;
}

function read(sessions: Session[], conditioning: CondResult[] = [], weeks = 4) {
  const settings = { conditioning } as unknown as Settings;
  return loadBalance(sessions, settings, { weeks, now: NOW });
}

/** Two lifts present in both windows, moving by `delta` kg between them. */
function bothWindowLifts(delta: number): Session[] {
  return [
    lift(40, 'Back squat', 100),
    lift(40, 'Bench press', 80),
    lift(10, 'Back squat', 100 + delta),
    lift(10, 'Bench press', 80 + delta),
  ];
}

describe('loadBalance — is one side costing the other', () => {
  describe('stays silent rather than inventing a story', () => {
    it('says nothing with no training at all', () => {
      expect(read([], [])).toBeNull();
    });

    it('says nothing when there is barely any conditioning to compare', () => {
      // One run across eight weeks is not a hybrid question.
      expect(read(bothWindowLifts(5), [run(10, 30)])).toBeNull();
    });

    it('says nothing when only ONE lift appears in both windows', () => {
      // The same rule the 8-week delta uses: a single movement is an anecdote,
      // and a mean of one is just that number wearing a hat.
      const sessions = [lift(40, 'Back squat', 100), lift(10, 'Back squat', 110), lift(10, 'Bench press', 80)];
      expect(read(sessions, [run(35, 30), run(12, 30)])).toBeNull();
    });

    it('says nothing when the lifts are all NEW, however much conditioning there is', () => {
      const sessions = [lift(10, 'Back squat', 100), lift(10, 'Bench press', 80)];
      expect(read(sessions, [run(40, 30), run(35, 30), run(12, 40), run(8, 40)])).toBeNull();
    });

    it('ignores a session still in progress', () => {
      const live = { ...lift(1, 'Back squat', 200), status: 'active' } as Session;
      const r = read([...bothWindowLifts(4), live], [run(35, 30), run(10, 30)]);
      // The live 200kg squat must not land in the recent window as a PR: the
      // delta is +4kg on the bar at 5 reps, which is 4×(1+5/30) of e1RM. A
      // number anywhere near the 100kg the live set would have added is the
      // failure this guards.
      expect(r?.lift.delta).toBeCloseTo(4 * (7 / 6), 5);
    });
  });

  describe('the verdict', () => {
    it('calls out conditioning climbing while the lifts sit still', () => {
      // The case this whole module exists for: 60 min/week becomes 150, the
      // squat and bench have not moved, and nothing on any other screen would
      // have told you.
      const r = read(bothWindowLifts(0), [run(40, 30), run(35, 30), run(12, 75), run(8, 75)]);
      expect(r?.verdict).toBe('interference');
      expect(r?.title).toBe('Conditioning up, lifts flat');
    });

    it('calls it out when the lifts are going BACKWARDS too', () => {
      const r = read(bothWindowLifts(-6), [run(40, 30), run(35, 30), run(12, 75), run(8, 75)]);
      expect(r?.verdict).toBe('interference');
    });

    it('says so when both sides are moving', () => {
      const r = read(bothWindowLifts(6), [run(40, 30), run(35, 30), run(12, 75), run(8, 75)]);
      expect(r?.verdict).toBe('both-up');
      expect(r?.body).toContain('Nothing is costing anything');
    });

    it('names the trade when conditioning was dropped and the lifts took the room', () => {
      const r = read(bothWindowLifts(6), [run(40, 75), run(35, 75), run(12, 20), run(8, 20)]);
      expect(r?.verdict).toBe('traded');
    });

    it('never says "neither side moved" while printing a lift gain', () => {
      /*
       * The bug this caught, found by running the readout against the
       * screenshot harness's real seed rather than against invented numbers:
       * conditioning level and +5kg on every lift fell through to `steady`,
       * whose copy asserts "neither side has moved much" — directly above the
       * five kilos. Flat conditioning with rising lifts is its own shape and
       * a genuinely good one, so it gets its own verdict.
       */
      const r = read(bothWindowLifts(5), [run(40, 30), run(35, 30), run(12, 30), run(8, 30)]);
      expect(r?.verdict).toBe('lift-only');
      expect(r?.body).not.toContain('Neither side has moved');
      expect(r?.title).toBe('Lifts up, conditioning level');
    });

    it('does not claim a pattern when the lifts slipped and nothing else changed', () => {
      const r = read(bothWindowLifts(-5), [run(40, 30), run(35, 30), run(12, 30), run(8, 30)]);
      expect(r?.verdict).toBe('unclear');
      expect(r?.body).not.toContain('Neither side has moved');
    });

    it('does not manufacture a verdict out of ordinary wobble', () => {
      // 60 → 66 minutes and +0.4kg mean e1RM. Both real, neither a change; a
      // readout that fires on this is one you stop reading.
      const r = read(bothWindowLifts(0.4), [run(40, 30), run(35, 30), run(12, 33), run(8, 33)]);
      expect(r?.verdict).toBe('steady');
    });
  });

  describe('what it counts', () => {
    it('counts a conditioning block logged inside a session, not just standalone runs', () => {
      // Both are training. A readout that saw only one would be wrong by
      // however you happen to log rather than by what you did.
      const withBlock = (daysAgo: number, min: number): Session =>
        ({
          id: `cs${daysAgo}`,
          date: ymdOf(daysAgo),
          status: 'completed',
          blocks: [{ id: `cb${daysAgo}`, kind: 'conditioning', heading: 'Run', condResult: { dur: min * 60 } }],
        }) as unknown as Session;
      const r = read([...bothWindowLifts(0), withBlock(40, 30), withBlock(35, 30), withBlock(12, 75), withBlock(8, 75)], []);
      expect(r?.verdict).toBe('interference');
      expect(r?.basis).toBe('minutes');
    });

    it('falls back to counting sessions when a duration is missing, and says so', () => {
      // Mixing a timed window with an untimed one would read as a collapse in
      // load that never happened.
      const r = read(bothWindowLifts(0), [run(40, 30), run(35, null), run(12, 60), run(10, 60), run(8, 60)]);
      expect(r?.basis).toBe('sessions');
      expect(r?.con).toMatchObject({ prior: 2, recent: 3 });
      expect(r?.body).toContain('sessions');
    });

    it('reports strength tonnage for both windows alongside the lift delta', () => {
      const r = read(bothWindowLifts(0), [run(35, 30), run(10, 30)]);
      // 100×5 + 80×5 in each window.
      expect(r?.vol.recent).toBe(900);
      expect(r?.vol.prior).toBe(900);
    });

    it('handles a prior window of zero conditioning without dividing by it', () => {
      const r = read(bothWindowLifts(0), [run(12, 40), run(8, 40)]);
      expect(r?.con.pct).toBeNull();
      expect(r?.verdict).toBe('interference');
      expect(r?.body).toContain('up from nothing');
    });
  });

  it('survives a corrupt settings blob rather than taking the screen down', () => {
    // A non-array `conditioning` is truthy and spreading it throws — the same
    // shape both Progress screens already guard against.
    const settings = { conditioning: 'nonsense' } as unknown as Settings;
    expect(() => loadBalance(bothWindowLifts(0), settings, { now: NOW })).not.toThrow();
    expect(loadBalance(bothWindowLifts(0), settings, { now: NOW })).toBeNull();
  });
});
