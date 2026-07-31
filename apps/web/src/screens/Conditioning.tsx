import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CON_FORMATS,
  conAdapt,
  conDownsample,
  conHrr,
  conPrescription,
  conZoneOf,
  conZones,
  fmtClock,
  isCond,
  paramsFor,
  pushCondHistory,
  uid,
  zoneSeconds,
  type CondFmtKey,
  type CondResult,
  type HrSample,
  type Phase,
} from '@hybrid/engine';
import { useDb } from '../store/db';
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
  timer: number | null;
  /** The mounted screen, when there is one, so beats reach the ring. */
  onBpm: ((n: number) => void) | null;
  /** Where the result belongs, captured at start() so it survives a mid-run
   *  hop to Home and back — the launching URL's query params do not. */
  sinkBid: string;
  sinkBi: number;
  /** A finished run waiting on its "How did that feel?" answer. Lives on RUN
   *  for the same reason the clock does: in component state, one tap on the
   *  nav bar while the rating chips were up unmounted the screen and silently
   *  threw away the whole banked run — trace, zone time, all of it. Held here,
   *  coming back to the screen re-asks the question instead. Written and
   *  cleared by submitFelt(). */
  pending: CondResult | null;
} = {
  live: false,
  fmt: 'intervals',
  startedAt: 0,
  elapsed: 0,
  bpm: null,
  samples: [],
  timer: null,
  onBpm: null,
  sinkBid: '',
  sinkBi: -1,
  pending: null,
};

function runTick() {
  const t = Math.floor((Date.now() - RUN.startedAt) / 1000);
  RUN.elapsed = t;
  if (RUN.bpm != null) RUN.samples.push({ t, bpm: RUN.bpm });
}

export function Conditioning() {
  const { hr, settings, whoop, activeSession, update } = useDb();
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
  // record waits on RUN.pending until the athlete says how it felt — only then
  // is it written, so `felt` rides in on the same store update as the result.
  // Initialised from RUN so a nav-away during the question re-asks it on
  // return rather than dropping the finished run.
  const [rating, setRating] = useState(RUN.pending != null);

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
    return () => {
      RUN.onBpm = null;
    };
  }, []);

  const zones = useMemo(() => conZones(hr), [hr]);
  const rx = useMemo(() => conPrescription(fmt, { settings, whoop }), [fmt, settings, whoop]);
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

  function start() {
    if (RUN.timer) window.clearInterval(RUN.timer);
    // A fresh run must never inherit a stale unrated record. Unreachable while
    // the rating chips are up (the setup screen is hidden), but cheap to pin.
    RUN.pending = null;
    RUN.samples = [];
    RUN.bpm = null;
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
    // Don't bank it yet — ask how it felt first. submitFelt() finishes the job.
    RUN.pending = rec;
    setRating(true);
  }

  function submitFelt(felt: string) {
    const rec = RUN.pending;
    if (!rec) return;
    rec.felt = felt;
    RUN.pending = null;
    setResult(rec);
    setRating(false);

    update((draft) => {
      const { conProgress } = conAdapt(rec, draft.settings);
      draft.settings.conProgress = conProgress;
      draft.settings.updatedAt = Date.now();

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
        ds.updatedAt = Date.now();
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
            <ul className="flex flex-col gap-0.5">
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

          <Button variant="brass" size="lg" className="mt-3 w-full" onClick={start}>
            Start
          </Button>
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
        </>
      ) : null}

      {rating ? (
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
