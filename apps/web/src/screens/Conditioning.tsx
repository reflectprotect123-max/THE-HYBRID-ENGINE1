import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CON_FORMATS,
  cardioCompletionFor,
  conAdapt,
  conDownsample,
  conHrr,
  conPrescription,
  conZoneOf,
  conZones,
  fmtClock,
  ensureSharedCore,
  isCond,
  painHoldFor,
  paramsFor,
  progressionKey,
  pushCondHistory,
  uid,
  zoneSeconds,
  type CondFmtKey,
  type CondResult,
  type HrSample,
  type Phase,
} from '@hybrid/engine';
import { appendSharedCoreEvent } from '@hybrid/shared-core';
import { useDb } from '../store/db';
import { connectEchoV3, type EchoV3Connection, type EchoV3Event } from '../native/echoV3';
import { Button, Card, Chip, Kicker, Ring, ScreenTitle, SectionHead, cx } from '../ui';

/*
 * Conditioning: pick a format, run it against live heart rate, bank the time.
 *
 * The prescription is not the format's base — it is the base plus whatever
 * level you have earned, minus a readiness gate on a low-recovery day. That is
 * why the setup screen shows the note ("Level 3 · eased today for 24%
 * recovery"): the numbers you're about to run are not the ones written on the
 * format, and hiding that difference makes the whole progression feel arbitrary.
 *
 * Live HR needs a real strap. In the browser that means Web Bluetooth, which is
 * Chromium-only; the native app uses a proper BLE stack. Where neither is
 * available the session still runs on the clock and simply banks no zone time,
 * which is honest — as opposed to inventing a heart rate.
 *
 * A run reached from a session's conditioning block carries that block in the
 * query string, so the result lands ON the block rather than in the standalone
 * history. It rides in the URL rather than in router state so a reload mid-run
 * still knows where the result belongs.
 */

/*
 * A live run outlives the screen, exactly as it did on the vanilla app's
 * module-level CON object.
 *
 * Held in component state, one tap on the nav bar — to glance at Home, or at
 * the session you are running this for — unmounted the screen and silently
 * threw away the run, the clock and every heart-rate sample banked so far. The
 * clock and the sampling therefore live out here and keep running while the
 * screen is away; the component only draws them.
 *
 * Deliberately not persisted: a run is over when the tab is, and resuming an
 * hours-old run from storage would bank time nobody trained.
 */
/** Below this, a run is a mis-tap rather than training, and is not recorded —
 *  parity with mobile's MIN_LOGGABLE_SEC (apps/mobile/.../Conditioning.tsx:50). */
const MIN_LOGGABLE_SEC = 20;

const RUN: {
  live: boolean;
  fmt: CondFmtKey;
  startedAt: number;
  elapsed: number;
  bpm: number | null;
  samples: HrSample[];
  /** Live Echo Bike V3 telemetry, same lifecycle as `bpm`: written by the
   *  module's FTMS subscription, sampled once a second by runTick, drawn by
   *  whichever screen is mounted. Null until the bike has reported. */
  power_w: number | null;
  cadence_rpm: number | null;
  /** FTMS Total Distance is cumulative from the console's own session, so it
   *  is displayed live but never banked as the run's distance. */
  distance_m: number | null;
  /** 1Hz power/cadence samples banked by runTick while a bike is reporting,
   *  averaged into the record at finish(). */
  powerSamples: number[];
  cadenceSamples: number[];
  /** The open Echo V3 link, held at module scope like the run itself so a
   *  mid-run hop to Home doesn't drop the bike. Null when not connected. */
  echo: EchoV3Connection | null;
  timer: number | null;
  /** The mounted screen, when there is one, so beats reach the ring. */
  onBpm: ((n: number) => void) | null;
  /** The mounted screen's redraw poke for bike telemetry. The values live on
   *  RUN (they must survive unmount); this only tells React to re-read them. */
  onFtms: (() => void) | null;
  /** Where the result belongs, captured at start() so it survives a mid-run
   *  hop to Home and back — the launching URL's query params do not. */
  sinkBid: string;
  sinkBi: number;
  /** A finished run waiting on its post-run questions (felt RPE, then
   *  mechanical completion). Lives on RUN for the same reason the clock does:
   *  in component state, one tap on the nav bar while the chips were up
   *  unmounted the screen and silently threw away the whole banked run —
   *  trace, zone time, all of it. Held here, coming back to the screen
   *  re-asks whichever question is unanswered instead — the felt answer
   *  written by submitFelt() survives a nav-away between the two questions
   *  the same way. Written by finish(), cleared only by submitMechanical(),
   *  the single point that banks. */
  pending: CondResult | null;
} = {
  live: false,
  fmt: 'intervals',
  startedAt: 0,
  elapsed: 0,
  bpm: null,
  samples: [],
  power_w: null,
  cadence_rpm: null,
  distance_m: null,
  powerSamples: [],
  cadenceSamples: [],
  echo: null,
  timer: null,
  onBpm: null,
  onFtms: null,
  sinkBid: '',
  sinkBi: -1,
  pending: null,
};

function runTick() {
  const t = Math.floor((Date.now() - RUN.startedAt) / 1000);
  RUN.elapsed = t;
  if (RUN.bpm != null) RUN.samples.push({ t, bpm: RUN.bpm });
  if (RUN.power_w != null) RUN.powerSamples.push(RUN.power_w);
  if (RUN.cadence_rpm != null) RUN.cadenceSamples.push(RUN.cadence_rpm);
}

/**
 * FTMS Indoor Bike Data notifications land here. Fields are flag-gated per
 * notification, so each is kept only when present — a frame that carries only
 * cadence must not wipe the last known power.
 */
function onEchoEvent(ev: EchoV3Event) {
  if (ev.power_w != null) RUN.power_w = ev.power_w;
  if (ev.cadence_rpm != null) RUN.cadence_rpm = ev.cadence_rpm;
  if (ev.distance_m != null) RUN.distance_m = ev.distance_m;
  RUN.onFtms?.();
}

/**
 * Manual, gesture-driven connect — Web Bluetooth's chooser needs a user
 * gesture, and unlike the HR strap this cannot ride the Start tap because two
 * device choosers cannot share one gesture. Module scope for the same reason
 * as connectStrap's subscription: the link must outlive the screen.
 */
async function connectEcho(): Promise<void> {
  if (RUN.echo) return;
  try {
    RUN.echo = await connectEchoV3(onEchoEvent, () => {
      // Link loss: stop showing stale numbers, but keep any banked samples —
      // the ride up to the drop really happened.
      RUN.echo = null;
      RUN.power_w = null;
      RUN.cadence_rpm = null;
      RUN.distance_m = null;
      RUN.onFtms?.();
    });
    RUN.onFtms?.();
  } catch {
    // Refused, unsupported, or no bike in range. The session still runs — it
    // just banks no bike telemetry, same policy as a missing strap.
  }
}

export function Conditioning() {
  const { hr, sessions, settings, whoop, activeSession, update } = useDb();
  const [params] = useSearchParams();
  const sinkBid = params.get('block') || '';
  // -1 when absent — Number(null) is 0, which silently aimed a
  // standalone run at the session's first block.
  const sinkBi = params.has('bi') ? Number(params.get('bi')) : -1;
  // The block this run was launched from, when there is one. Resolved by id
  // first so an edited session still lands on the right block; `bi` is the
  // fallback the result-sink already used.
  const sb = activeSession
    ? (activeSession.blocks.find((b) => b.id === sinkBid) ?? activeSession.blocks[sinkBi])
    : undefined;
  const sinkBlock = isCond(sb) ? sb : null;
  // The module RUN still wins while a run is live — a mid-run remount must
  // not flip the format under the athlete's feet.
  const [fmt, setFmtState] = useState<CondFmtKey>(() =>
    RUN.live ? RUN.fmt : sinkBlock?.condFmt && CON_FORMATS[sinkBlock.condFmt] ? sinkBlock.condFmt : RUN.fmt,
  );
  const [live, setLive] = useState(RUN.live);
  const [elapsed, setElapsed] = useState(RUN.live ? RUN.elapsed : 0);
  const [bpm, setBpm] = useState<number | null>(RUN.live ? RUN.bpm : null);
  const [result, setResult] = useState<CondResult | null>(null);
  // The rating phase between finishing a run and seeing it banked. The built
  // record waits on RUN.pending through TWO questions — how it felt, then
  // whether the prescribed work was mechanically completed — and only the
  // second answer writes it, so both answers ride in on the same store update
  // as the result. Initialised from RUN so a nav-away during EITHER question
  // re-asks the unanswered one on return rather than dropping the finished
  // run (module scope doesn't care which sub-question was showing).
  const [rating, setRating] = useState(RUN.pending != null);
  // RUN is module state, so mutating RUN.pending.felt doesn't re-render on
  // its own — submitFelt() bumps this to advance to the second question.
  const [, setQuestionV] = useState(0);
  // Same again for bike telemetry: the values live on RUN, this only makes
  // React re-read them when a notification (or connect/drop) lands.
  const [, setFtmsV] = useState(0);

  const setFmt = (k: CondFmtKey) => {
    RUN.fmt = k;
    setFmtState(k);
  };

  // Beats arrive on the module's strap subscription and are handed to whichever
  // screen is mounted. Reading them through a dependency instead tore the 1s
  // tick down and rebuilt it before it could fire, for any strap notifying
  // faster than once a second — the clock froze at 0:00 and not one sample was
  // banked, for exactly the athletes who own the hardware.
  useEffect(() => {
    RUN.onBpm = setBpm;
    RUN.onFtms = () => setFtmsV((v) => v + 1);
    return () => {
      RUN.onBpm = null;
      RUN.onFtms = null;
    };
  }, []);

  const zones = useMemo(() => conZones(hr), [hr]);
  const rx = useMemo(() => conPrescription(fmt, { settings, whoop }), [fmt, settings, whoop]);
  // Setup-time only: modality is never known ahead of a run (the one place
  // this screen ever sets it, `rec.modality = 'air_bike'` in finish(), only
  // fires once Echo Bike telemetry has actually been seen mid-run), so the
  // hold is always checked against the bare-format bucket.
  const hold = useMemo(() => painHoldFor(fmt, sessions, settings), [fmt, sessions, settings]);
  const phases = useMemo<Phase[]>(() => CON_FORMATS[fmt].build(paramsFor(fmt, rx)), [fmt, rx]);
  const totalSec = useMemo(() => phases.reduce((n, p) => n + p.dur, 0), [phases]);

  const phaseNow = useMemo(() => {
    let acc = 0;
    for (const p of phases) {
      if (elapsed < acc + p.dur) return { p, into: elapsed - acc };
      acc += p.dur;
    }
    return null;
  }, [phases, elapsed]);

  // Redraw only. The banking itself is RUN's timer, which does not stop when
  // this screen does.
  useEffect(() => {
    if (!live) return;
    const iv = window.setInterval(() => setElapsed(RUN.elapsed), 500);
    return () => window.clearInterval(iv);
  }, [live]);

  const zone = bpm == null ? null : conZoneOf(bpm, zones);

  // Clears the hold for THIS format's bare bucket only — an ack keyed to
  // running says nothing about the rower. Recomputing `hold` off the fresh
  // settings is what makes the banner disappear and Start reappear on the
  // very next render, no separate unlock step needed.
  function acknowledgePainHold() {
    update((draft) => {
      draft.settings.conditioningAck = {
        ...(draft.settings.conditioningAck || {}),
        [progressionKey(fmt)]: Date.now(),
      };
      draft.settings.updatedAt = Date.now();
    });
  }

  function start() {
    if (RUN.timer) window.clearInterval(RUN.timer);
    // A fresh run must never inherit a stale unrated record. Unreachable while
    // the rating chips are up (the setup screen is hidden), but cheap to pin.
    RUN.pending = null;
    RUN.samples = [];
    RUN.powerSamples = [];
    RUN.cadenceSamples = [];
    RUN.bpm = null;
    RUN.power_w = null;
    RUN.cadence_rpm = null;
    RUN.distance_m = null;
    RUN.startedAt = Date.now();
    RUN.elapsed = 0;
    RUN.live = true;
    // The URL that launched this run carries where the result belongs. The run
    // outlives the screen in RUN, but the URL does not survive a hop to Home
    // and back — so capture the sink onto RUN now, and read it at finish().
    RUN.sinkBid = sinkBid;
    RUN.sinkBi = sinkBi;
    RUN.timer = window.setInterval(runTick, 1000);
    setBpm(null);
    setElapsed(0);
    setResult(null);
    setLive(true);
    void connectStrap((n) => {
      RUN.bpm = n;
      RUN.onBpm?.(n);
    });
  }

  function finish() {
    if (RUN.timer) window.clearInterval(RUN.timer);
    RUN.timer = null;
    RUN.live = false;
    setLive(false);
    // A run too short to be training is discarded, not banked — a Start→Finish
    // mis-tap used to write a 1-second run, which conAdapt then treated as a
    // session and (with the no-data guard) still counts as time on the clock.
    if (RUN.elapsed < MIN_LOGGABLE_SEC) {
      RUN.samples = [];
      RUN.powerSamples = [];
      RUN.cadenceSamples = [];
      RUN.elapsed = 0;
      setElapsed(0);
      setResult(null);
      return;
    }
    const dur = Math.max(1, RUN.elapsed);
    const trace = conDownsample(RUN.samples, dur);
    const zsec = zoneSeconds(trace, zones);
    const rec: CondResult = {
      id: uid(),
      fmt,
      // The block's authored effort when this run came from one — the coach's
      // prescription, not a guess from the format.
      effort: sinkBlock?.effort ?? (fmt === 'steady' ? 'easy' : 'hard'),
      zsec,
      dur,
      rec: zones.rec,
      startedAt: RUN.startedAt,
      hrr: conHrr(trace).hrr,
      trace,
    };
    // A run with Echo V3 telemetry is an air-bike session and says so. The
    // modality tag is what routes it into the per-format-per-modality
    // progression bucket (progressionKey) instead of the bare-format one, and
    // the device identity is stored with the result because air-bike output is
    // not portable across devices — a same-device baseline needs to know what
    // produced the numbers. Banked samples count even if the link dropped
    // mid-run (RUN.echo is null then): the ride up to the drop happened.
    if (RUN.echo != null || RUN.powerSamples.length > 0 || RUN.cadenceSamples.length > 0) {
      rec.modality = 'air_bike';
      rec.device = { manufacturer: 'Rogue', model: 'Echo Bike', generation: 'V3.0' };
      const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
      if (RUN.powerSamples.length > 0) rec.avgPowerW = avg(RUN.powerSamples);
      if (RUN.cadenceSamples.length > 0) rec.avgCadenceRpm = avg(RUN.cadenceSamples);
    }
    // Don't bank it yet — ask how it felt, then whether the work was
    // mechanically completed. submitMechanical() finishes the job.
    RUN.pending = rec;
    setRating(true);
  }

  // First question. Answering it only advances to the second — the record
  // stays on RUN.pending, un-banked, so a nav-away between the two questions
  // is survived exactly like one before the first.
  function submitFelt(felt: string) {
    const rec = RUN.pending;
    if (!rec) return;
    rec.felt = felt;
    setQuestionV((v) => v + 1);
  }

  // Second question, and the single write path: only here does the record
  // leave RUN.pending and reach the store, both answers riding in on the
  // same update as the result itself.
  function submitMechanical(m: CondResult['mechanicalCompletion']) {
    const rec = RUN.pending;
    if (!rec) return;
    rec.mechanicalCompletion = m;
    rec.cardioCompletion = cardioCompletionFor(rec.fmt ?? fmt, rec.zsec, rec.dur ?? 0);
    RUN.pending = null;
    setResult(rec);
    setRating(false);

    update((draft) => {
      const at = Date.now();
      const { conProgress } = conAdapt(rec, draft.settings);
      draft.settings.conProgress = conProgress;
      draft.settings.updatedAt = at;
      const core = ensureSharedCore(draft, at).core!;
      draft.core = appendSharedCoreEvent(core, {
        type: 'workout_completed',
        occurredAt: new Date(at).toISOString(),
        sourceDomain: 'conditioning',
        idempotencyKey: `conditioning:${rec.id || rec.startedAt || at}:completed`,
        payload: { resultId: rec.id, sessionId: activeSession?.id, domain: 'conditioning', durationSeconds: rec.dur },
      });

      // A run started from a session belongs to that session's block. Banking
      // it in the standalone history instead left the block forever unlogged:
      // the session could never reach 100%, "Start conditioning" kept offering
      // work already done, and the recap showed none of it. Match by block id
      // first so an edited or reordered session still lands on the right one.
      const ds = activeSession ? draft.sessions.find((x) => x.id === activeSession.id) : undefined;
      let cb = ds && RUN.sinkBid ? ds.blocks.find((b) => b.id === RUN.sinkBid) : undefined;
      // Guard the index fallback on the -1 sentinel, matching mobile (:237) —
      // a standalone run (sinkBi -1) must not resolve blocks[-1].
      if (ds && !isCond(cb) && RUN.sinkBi >= 0) cb = ds.blocks[RUN.sinkBi];
      if (ds && isCond(cb)) {
        cb.condResult = rec;
        ds.updatedAt = at;
        return;
      }
      draft.settings.conditioning = pushCondHistory(draft.settings, rec);
    });
  }

  return (
    <>
      <Kicker>Conditioning</Kicker>
      <ScreenTitle>{live ? (phaseNow?.p.name ?? 'Running') : 'Set up'}</ScreenTitle>

      {!live && !result && !rating ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            {(Object.keys(CON_FORMATS) as CondFmtKey[]).map((k) => (
              <Chip key={k} on={fmt === k} onClick={() => setFmt(k)}>
                {CON_FORMATS[k].name}
              </Chip>
            ))}
          </div>

          <Card className="mt-2">
            <Kicker>Today&apos;s prescription</Kicker>
            <p className="num mt-0.5 text-7 font-[800] text-gold2">
              {fmt === 'steady'
                ? `${rx.minutes} min`
                : fmt === 'free'
                  ? 'open-ended'
                  : `${rx.rounds} × ${rx.work}s / ${rx.rest}s`}
            </p>
            {rx.note ? <p className="mt-0.5 text-4 text-muted">{rx.note}</p> : null}
            <p className="num mt-1 text-3 text-dim">
              {phases.length} phases · {fmtClock(totalSec)} total
            </p>
          </Card>

          <SectionHead title="Zones you'll be held to" />
          <Card>
            <p className="num text-3 text-dim">
              max {zones.max} bpm · {zones.method === 'hrr' ? 'Karvonen · resting ' + zones.rest : 'percent of max'}
            </p>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {zones.list.map((b) => (
                <li key={b.key} className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="h-1 w-1 shrink-0 rounded-pill"
                    style={{ background: zoneNeon(b.key), boxShadow: `0 0 6px ${zoneNeon(b.key)}` }}
                  />
                  <span className="flex-1 text-4 font-[650]">{b.name}</span>
                  <span className="num text-4 text-muted">
                    {b.lo}–{b.hi}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {hold.held ? (
            <Card className="mt-2 border-[color:var(--color-bad)]/40 bg-[color:var(--color-bad)]/10">
              <p className="text-4 text-bad">{hold.note}</p>
              <Button variant="brass" size="md" className="mt-1.5 w-full" onClick={acknowledgePainHold}>
                I&apos;m ready to continue
              </Button>
            </Card>
          ) : (
            <Button variant="brass" size="lg" className="mt-3 w-full" onClick={start}>
              Start
            </Button>
          )}
          {/* Manual, not gated on the block's modality: nothing in the app
              sets CondBlock.modality ahead of a session, so a gate would
              simply never show the control. Start's tap handles the HR strap;
              the bike's chooser needs its own gesture. */}
          {RUN.echo ? (
            <p className="mt-1 text-center text-3 text-dim">
              Echo Bike connected{RUN.echo.device.name ? ` · ${RUN.echo.device.name}` : ''}
            </p>
          ) : (
            <Button className="mt-1 w-full" onClick={() => void connectEcho()}>
              Connect Echo Bike
            </Button>
          )}
        </>
      ) : null}

      {live ? (
        <>
          <Card className="mt-2 flex items-center gap-2">
            <Ring
              frac={bpm == null ? 0 : Math.min(1, bpm / zones.max)}
              color={zone ? zoneNeon(zone.key) : 'var(--color-ring-idle)'}
              glow={zone != null}
              size={120}
              stroke={10}
            >
              {bpm == null ? (
                <span className="text-3 text-dim">no strap</span>
              ) : (
                <>
                  <span className="num text-9 font-[900]" style={{ color: zoneNeon(zone!.key) }}>
                    {bpm}
                  </span>
                  <span className="text-1 font-[750] uppercase tracking-[.1em] text-dim">bpm</span>
                </>
              )}
            </Ring>
            <div className="min-w-0 flex-1">
              <Kicker>{zone ? zone.name : 'Below zones'}</Kicker>
              <p className="num mt-0.5 text-8 font-[900]">{fmtClock(elapsed)}</p>
              <p className="num text-3 text-dim">of {fmtClock(totalSec)}</p>
              {phaseNow ? (
                <p className="num mt-1 text-4 text-gold2">
                  {phaseNow.p.name} · {fmtClock(phaseNow.p.dur - phaseNow.into)} left
                </p>
              ) : null}
              {RUN.power_w != null || RUN.cadence_rpm != null || RUN.distance_m != null ? (
                <p className="num mt-1 text-4 text-muted">
                  {[
                    RUN.power_w != null ? `${Math.round(RUN.power_w)}W` : null,
                    RUN.cadence_rpm != null ? `${Math.round(RUN.cadence_rpm)}rpm` : null,
                    RUN.distance_m != null ? `${(RUN.distance_m / 1000).toFixed(1)}km` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          </Card>

          <Button variant="brass" size="lg" className="mt-3 w-full" onClick={finish}>
            Finish
          </Button>
          {elapsed < MIN_LOGGABLE_SEC ? (
            <p className="mt-1 text-center text-3 text-dim">
              Runs under {MIN_LOGGABLE_SEC}s are discarded, not logged.
            </p>
          ) : null}
          {!RUN.echo ? (
            <Button className="mt-1 w-full" onClick={() => void connectEcho()}>
              Connect Echo Bike
            </Button>
          ) : null}
        </>
      ) : null}

      {rating && RUN.pending && RUN.pending.felt == null ? (
        <>
          <SectionHead title="How did that feel?" />
          <div className="flex flex-wrap justify-center gap-1">
            {['3', '4', '5', '6', '7', '8', '9', '10'].map((r) => (
              <Chip key={r} on={false} onClick={() => submitFelt(r)}>
                RPE {r}
              </Chip>
            ))}
          </div>
        </>
      ) : null}

      {rating && RUN.pending && RUN.pending.felt != null && RUN.pending.mechanicalCompletion == null ? (
        <>
          <SectionHead title="Did you complete the work?" />
          <div className="flex flex-wrap justify-center gap-1">
            {(
              [
                ['met', 'Completed it'],
                ['local_fatigue', 'Muscles gave out'],
                ['technique_fail', 'Form broke down'],
                ['pain_stop', 'Stopped — pain'],
              ] as const
            ).map(([m, label]) => (
              <Chip key={m} on={false} onClick={() => submitMechanical(m)}>
                {label}
              </Chip>
            ))}
          </div>
        </>
      ) : null}

      {result ? (
        <>
          <SectionHead title="Banked" />
          <Card>
            <ul className="flex flex-col gap-0.5">
              {(['low', 'mod', 'high'] as const).map((k) => (
                <li key={k} className="flex items-center gap-1">
                  <span className="h-1 w-1 shrink-0 rounded-pill" style={{ background: zoneInk(k) }} />
                  <span className="flex-1 text-4 font-[650]">{zones.list.find((b) => b.key === k)?.name}</span>
                  <span className="num text-4 text-muted">{fmtClock(result.zsec?.[k] ?? 0)}</span>
                </li>
              ))}
            </ul>
            <p className="num mt-1.5 border-t border-line pt-1 text-3 text-dim">
              {fmtClock(result.dur ?? 0)} total
              {result.hrr != null ? ` · HR dropped ${result.hrr}bpm in the minute after peak` : ''}
            </p>
          </Card>
          <Button className="mt-2 w-full" onClick={() => setResult(null)}>
            Done
          </Button>
        </>
      ) : null}
    </>
  );
}

/** Band inks for data read against text (banked seconds); the neon set for
 * anything drawn as a lit dot, strip or ring — 01-foundations-colour-05/06. */
function zoneInk(k: 'low' | 'mod' | 'high'): string {
  return k === 'low' ? 'var(--color-zone-blue)' : k === 'mod' ? 'var(--color-zone-green)' : 'var(--color-zone-red)';
}
function zoneNeon(k: 'low' | 'mod' | 'high'): string {
  return k === 'low' ? 'var(--color-neon-strain)' : k === 'mod' ? 'var(--color-neon-ok)' : 'var(--color-neon-bad)';
}

/**
 * Web Bluetooth against the standard Heart Rate service (0x180D) and its
 * measurement characteristic (0x2A37). The first byte's low bit says whether
 * the value is 8- or 16-bit — get that wrong and every reading above 255 wraps.
 *
 * Chromium-only, and requires a user gesture, which is why this is called from
 * the Start button rather than on mount.
 */
async function connectStrap(onBpm: (n: number) => void): Promise<void> {
  const nav = navigator as Navigator & {
    bluetooth?: {
      requestDevice(o: unknown): Promise<{
        gatt?: {
          connect(): Promise<{
            getPrimaryService(s: number): Promise<{
              getCharacteristic(c: number): Promise<{
                startNotifications(): Promise<EventTarget>;
              }>;
            }>;
          }>;
        };
      }>;
    };
  };
  if (!nav.bluetooth) return;
  try {
    const dev = await nav.bluetooth.requestDevice({ filters: [{ services: [0x180d] }] });
    const server = await dev.gatt?.connect();
    if (!server) return;
    const svc = await server.getPrimaryService(0x180d);
    const ch = await svc.getCharacteristic(0x2a37);
    const target = await ch.startNotifications();
    target.addEventListener('characteristicvaluechanged', (e: Event) => {
      const dv = (e.target as unknown as { value: DataView }).value;
      const flags = dv.getUint8(0);
      onBpm(flags & 1 ? dv.getUint16(1, true) : dv.getUint8(1));
    });
  } catch {
    // Refused, unsupported, or no strap in range. The session still runs on the
    // clock — it just banks no zone time.
  }
}
