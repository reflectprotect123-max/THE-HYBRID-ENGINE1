import { isCond } from './session';
import { bestE1rmByLift, sessionVolume } from './session';
import type { CondResult, Session, Settings } from './types';

/*
 * Is one side costing the other?
 *
 * This is the question a HYBRID app exists to answer and the one thing this
 * app could not do. Strength progression lives in `lift.ts`, conditioning
 * progression in `conditioning.ts`, and each adapts correctly in isolation —
 * so you can add running for six weeks, watch your squat stop moving, and
 * never connect the two, because the two trends have never shared a screen.
 *
 * The classic hybrid failure is not dramatic. Nothing breaks. The lift simply
 * stops going up while the conditioning volume quietly doubles, and by the time
 * it is obvious you have lost a training block working out what happened.
 *
 * WHAT THIS IS NOT: a claim about cause. Two things moving together is not one
 * thing causing the other — a bad month at work moves both. So this reports the
 * shape and refuses to explain it, and the copy below is written to be read as
 * "here is what happened", never "here is why". Deciding whether the trade was
 * the one you wanted is yours; noticing it happened at all is the app's job.
 */

/** One conditioning effort with a timestamp we actually trust. */
interface DatedEffort {
  at: number;
  /** seconds, or null when the effort recorded no duration at all */
  sec: number | null;
}

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

/** Seconds of work in an effort: its own duration, else the banked zone time. */
function effortSeconds(r: CondResult): number | null {
  const d = Number(r.dur);
  if (Number.isFinite(d) && d > 0) return d;
  const z = r.zsec;
  if (z && typeof z === 'object') {
    const t = Object.values(z).reduce<number>((n, v) => n + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
    if (t > 0) return t;
  }
  return null;
}

/**
 * Efforts placed in time.
 *
 * `startedAt` when it is there; otherwise the date of the session the block
 * belongs to, because an inline result written by an older build may carry no
 * timestamp of its own and dropping it would quietly shrink one window.
 */
function datedEfforts(sessions: Session[], settings: Settings): DatedEffort[] {
  const out: DatedEffort[] = [];
  const standalone = Array.isArray(settings.conditioning) ? (settings.conditioning as CondResult[]) : [];
  standalone.forEach((r) => {
    const at = Number(r.startedAt);
    if (Number.isFinite(at) && at > 0) out.push({ at, sec: effortSeconds(r) });
  });
  (sessions || [])
    .filter((s) => s.status !== 'active')
    .forEach((s) => {
      const fallback = Date.parse(String(s.date) + 'T12:00:00');
      (s.blocks || []).filter(isCond).forEach((b) => {
        const r = b.condResult;
        if (!r) return;
        const own = Number(r.startedAt);
        const at = Number.isFinite(own) && own > 0 ? own : fallback;
        if (Number.isFinite(at)) out.push({ at, sec: effortSeconds(r) });
      });
    });
  return out;
}

export interface Side {
  recent: number;
  prior: number;
  /** percent change, or null when the prior window was zero and % is undefined */
  pct: number | null;
}

export interface LoadBalance {
  /** how long each window is */
  weeks: number;
  /** conditioning load — minutes when they were recorded, else session count */
  con: Side;
  /** what `con` is counting, so the copy can say which */
  basis: 'minutes' | 'sessions';
  /** strength tonnage */
  vol: Side;
  /** mean e1RM change, in kg, across lifts trained in BOTH windows */
  lift: { delta: number; n: number };
  verdict: 'interference' | 'both-up' | 'traded' | 'lift-only' | 'steady' | 'unclear';
  title: string;
  body: string;
}

/**
 * A change big enough to be a change.
 *
 * 25% on conditioning load and half a kilo of mean e1RM: under those, four
 * weeks of ordinary variation would trip a verdict every time it ran, and a
 * readout that always has something to say is one you stop reading.
 */
const CON_MOVE = 25;
const LIFT_MOVE = 0.5;

function side(recent: number, prior: number): Side {
  return { recent, prior, pct: prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null };
}

function fmtPct(p: number | null): string {
  if (p == null) return 'up from nothing';
  return (p > 0 ? 'up ' : p < 0 ? 'down ' : 'level, ') + (p === 0 ? '' : Math.abs(p) + '%');
}

/**
 * Compare the last `weeks` against the `weeks` before them.
 *
 * Returns null rather than a verdict whenever the comparison would be made up:
 * fewer than two conditioning efforts across both windows means there is no
 * hybrid question to answer, and fewer than two lifts present in BOTH windows
 * means there is nothing honest to say about strength. That is the same rule
 * the 8-week lift delta already uses — a lift missing from a window shows a
 * dash, not a fabricated zero. Silent until confident.
 */
export function loadBalance(
  sessions: Session[],
  settings: Settings = {},
  opts: { weeks?: number; now?: number } = {},
): LoadBalance | null {
  const weeks = opts.weeks && opts.weeks > 0 ? opts.weeks : 4;
  const now = opts.now ?? Date.now();
  const span = weeks * 7 * 864e5;
  const mid = now - span;
  const start = now - span * 2;

  const efforts = datedEfforts(sessions || [], settings);
  const inRecent = efforts.filter((e) => e.at >= mid && e.at <= now);
  const inPrior = efforts.filter((e) => e.at >= start && e.at < mid);
  if (inRecent.length + inPrior.length < 2) return null;

  // Minutes are the better measure and are not always there. Rather than
  // silently mixing a timed window with an untimed one — which would read as a
  // collapse in load that never happened — fall back to counting sessions and
  // say so.
  const timed = (a: DatedEffort[]) => a.filter((e) => e.sec != null).length;
  const allTimed = timed(inRecent) === inRecent.length && timed(inPrior) === inPrior.length;
  const basis: 'minutes' | 'sessions' = allTimed ? 'minutes' : 'sessions';
  const load = (a: DatedEffort[]) =>
    allTimed ? Math.round(a.reduce((n, e) => n + (e.sec || 0), 0) / 60) : a.length;
  const con = side(load(inRecent), load(inPrior));

  const inWindow = (s: Session, from: number, to: number) => {
    const t = Date.parse(String(s.date) + 'T12:00:00');
    return Number.isFinite(t) && t >= from && t < to && s.status !== 'active';
  };
  const tonnage = (from: number, to: number) =>
    (sessions || []).filter((s) => inWindow(s, from, to)).reduce((n, s) => n + sessionVolume(s), 0);
  const vol = side(tonnage(mid, now + 864e5), tonnage(start, mid));

  const recentLifts = bestE1rmByLift(sessions || [], mid, now + 864e5);
  const priorLifts = bestE1rmByLift(sessions || [], start, mid);
  const deltas: number[] = [];
  recentLifts.forEach((r, k) => {
    const p = priorLifts.get(k);
    if (p) deltas.push(r.e1 - p.e1);
  });
  if (deltas.length < 2) return null;
  const delta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const lift = { delta, n: deltas.length };

  const conUp = con.pct == null ? con.recent > 0 : con.pct >= CON_MOVE;
  const conDown = con.pct != null && con.pct <= -CON_MOVE;
  const liftUp = delta > LIFT_MOVE;
  const liftDown = delta < -LIFT_MOVE;

  /*
   * `steady` claims neither side moved, so it must only be reached when
   * neither side moved. An earlier cut fell through to it whenever the
   * conditioning was level — which meant a block with flat running and a
   * five-kilo jump on every lift printed "neither side has moved much" directly
   * above the five-kilo jump. Everything that is a real shape gets its own
   * verdict, and `unclear` states both numbers without claiming a pattern.
   */
  const verdict: LoadBalance['verdict'] =
    conUp && !liftUp
      ? 'interference'
      : conUp
        ? 'both-up'
        : conDown && liftUp
          ? 'traded'
          : liftUp
            ? 'lift-only'
            : !conDown && !liftDown
              ? 'steady'
              : 'unclear';

  const unit = basis === 'minutes' ? 'min' : basis === 'sessions' && con.recent === 1 ? 'session' : 'sessions';
  const conPhrase = `Conditioning ${fmtPct(con.pct)} (${con.prior}→${con.recent} ${unit})`;
  const liftPhrase = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}kg mean e1RM across ${lift.n} ${lift.n === 1 ? 'lift' : 'lifts'}`;
  const window = `the last ${weeks} weeks against the ${weeks} before`;

  const copy: Record<LoadBalance['verdict'], { title: string; body: string }> = {
    interference: {
      title: 'Conditioning up, lifts flat',
      body: `${conPhrase} over ${window}, and your lifts have not followed: ${liftPhrase}. That is the trade hybrid training makes. It may well be the one you want — this is here so you make it on purpose.`,
    },
    'both-up': {
      title: 'Both sides moving',
      body: `${conPhrase} over ${window}, and your lifts went with it: ${liftPhrase}. Nothing is costing anything right now.`,
    },
    traded: {
      title: 'Lifts up, conditioning down',
      body: `${conPhrase} over ${window} and your lifts took the room: ${liftPhrase}. Worth knowing what the strength cost, if you plan to run again soon.`,
    },
    'lift-only': {
      title: 'Lifts up, conditioning level',
      body: `${liftPhrase} over ${window} with conditioning where it was (${conPhrase.toLowerCase()}). You are getting stronger without paying for it anywhere.`,
    },
    steady: {
      title: 'Holding steady',
      body: `Neither side has moved much over ${window}. ${conPhrase}, ${liftPhrase}.`,
    },
    unclear: {
      title: 'No clear trade',
      body: `${conPhrase} over ${window}, ${liftPhrase}. Nothing here points one way or the other yet.`,
    },
  };

  return { weeks, con, basis, vol, lift, verdict, ...copy[verdict] };
}
