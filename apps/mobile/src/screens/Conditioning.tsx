import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  CON_FORMATS,
  cardioCompletionFor,
  withFeltZones,
  conAdapt,
  conDownsample,
  conHrr,
  conPrescription,
  conZoneOf,
  conZones,
  fmtClock,
  ensureSharedCore,
  fmtDistance,
  fmtPace,
  geoDownsample,
  isCond,
  paceSecPerKm,
  painHoldFor,
  paramsFor,
  progressionKey,
  pushCondHistory,
  totalDistanceM,
  uid,
  zoneSeconds,
  type CondFmtKey,
  type CondResult,
  type GeoSample,
  type HrSample,
  type Phase,
} from '@hybrid/engine';
import { appendSharedCoreEvent } from '@hybrid/shared-core';
import { useDb } from '../store/db';
import { buzz, createFtmsMonitor, createGeoTracker, createHeartRateMonitor, setKeepAwake } from '../native/capabilities';
import type { RootStackParams } from '../App';
import { color } from '@hybrid/design';
import { Btn, Card, Chip, Kicker, Ring, Row, Screen, SectionHead, T, Tap, Title, zoneInk, zoneNeon } from '../ui';
import { RouteMap } from '../ui/RouteMap';

/*
 * Conditioning, run by live heart rate off a real strap.
 *
 * This is the screen the native app exists for: web Bluetooth is Chromium-only
 * and cannot hold a connection with the screen off, whereas a BLE central here
 * keeps streaming in a pocket.
 *
 * The prescription shown is NOT the format's base — it is the base plus the
 * level you have earned, minus a readiness gate on a low-recovery day. The note
 * says which, because hiding that difference makes the whole progression feel
 * arbitrary.
 */
/** Below this, a run is a mis-tap rather than training, and is not recorded. */
const MIN_LOGGABLE_SEC = 20;

export function ConditioningScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, sessions, hr, whoop, update, activeSession } = useDb();
  // Which block of the live session this run belongs to, when it was started
  // from one. Absent for a standalone run off Home.
  const route = useRoute<RouteProp<RootStackParams, 'Conditioning'>>();
  const sinkBid = route.params?.bid ?? '';
  const sinkBi = route.params?.bi ?? -1;
  // The block this run was launched from, when there is one — its authored
  // format/effort are the prescription this screen should open on.
  const sb = activeSession
    ? (activeSession.blocks.find((b) => b.id === sinkBid) ?? activeSession.blocks[sinkBi])
    : undefined;
  const sinkBlock = isCond(sb) ? sb : null;
  const [fmt, setFmt] = useState<CondFmtKey>(() =>
    sinkBlock?.condFmt && CON_FORMATS[sinkBlock.condFmt] ? sinkBlock.condFmt : 'intervals',
  );
  const [live, setLive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bpm, setBpm] = useState<number | null>(null);
  const [hrMsg, setHrMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [geoMsg, setGeoMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [result, setResult] = useState<CondResult | null>(null);
  // The rating phase between finishing a run and seeing it banked: the built
  // record waits on `pending` through TWO questions — how it felt, then
  // whether the prescribed work was mechanically completed — and only the
  // second answer banks, so both ride in on the same store update as the
  // result. A component ref, NOT the module scope web moved to — this screen
  // guards its exit (the beforeRemove listener below covers `rating` for the
  // whole two-question stretch) rather than surviving it, so the record only
  // has to live exactly as long as the screen does.
  const [rating, setRating] = useState(false);
  const pending = useRef<CondResult | null>(null);
  // `pending` is a ref, so submitFelt() writing `.felt` onto it doesn't
  // re-render on its own — this bump is what advances to the second question.
  const [, setQuestionV] = useState(0);
  const samples = useRef<HrSample[]>([]);
  const geoSamples = useRef<GeoSample[]>([]);
  const startedAt = useRef(0);
  const monitor = useRef<ReturnType<typeof createHeartRateMonitor> | null>(null);
  const geoTracker = useRef<ReturnType<typeof createGeoTracker> | null>(null);
  // The ticker reads the latest beat through a ref. Held in state and listed as
  // a dependency it tore the interval down and rebuilt it on every sample —
  // and a strap notifying at ~1Hz resets a 1s interval before it ever fires, so
  // the session clock stopped the moment a strap actually connected.
  const bpmRef = useRef<number | null>(null);
  bpmRef.current = bpm;

  /*
   * Live Echo Bike V3 telemetry over FTMS, same lifecycle as `bpm`: written by
   * the monitor's notification callback, sampled once a second by the ticker,
   * drawn while live. FTMS frames are flag-gated — one that carries only
   * cadence must not wipe the last known power — so each field is kept
   * per-notification and only overwritten when present. The link itself, like
   * web's RUN.echo, outlives finish(): connect once, ride several runs. It is
   * only torn down with the screen (the unmount cleanup below) or on error.
   */
  const ftms = useRef<ReturnType<typeof createFtmsMonitor> | null>(null);
  const [echoConnected, setEchoConnected] = useState(false);
  const [echoMsg, setEchoMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [echoPowerW, setEchoPowerW] = useState<number | null>(null);
  const [echoCadenceRpm, setEchoCadenceRpm] = useState<number | null>(null);
  const [echoDistanceM, setEchoDistanceM] = useState<number | null>(null);
  // Refs for the 1s ticker, for the same reason as bpmRef: values in the
  // interval's deps would tear it down on every notification.
  const powerRef = useRef<number | null>(null);
  powerRef.current = echoPowerW;
  const cadenceRef = useRef<number | null>(null);
  cadenceRef.current = echoCadenceRpm;
  /** 1Hz power/cadence samples banked while the bike is reporting, averaged
   *  into the record at finish(). FTMS Total Distance is cumulative from the
   *  console's own session, so it is displayed live but never banked. */
  const powerSamples = useRef<number[]>([]);
  const cadenceSamples = useRef<number[]>([]);

  const connectEcho = async () => {
    if (ftms.current) return;
    ftms.current = createFtmsMonitor();
    await ftms.current.start(
      (m) => {
        if (m.power_w != null) setEchoPowerW(m.power_w);
        if (m.cadence_rpm != null) setEchoCadenceRpm(m.cadence_rpm);
        if (m.distance_m != null) setEchoDistanceM(m.distance_m);
      },
      (state, msg) => {
        if (state === 'connected') {
          setEchoConnected(true);
          setEchoMsg(null);
          return;
        }
        if (state === 'error') {
          // Refused, no bike in range, or no BLE in this build. Clear the
          // failed monitor so the button offers a retry, and stop showing
          // stale numbers — but keep any banked samples: the ride up to a
          // mid-run drop really happened.
          ftms.current?.stop();
          ftms.current = null;
          setEchoConnected(false);
          setEchoPowerW(null);
          setEchoCadenceRpm(null);
          setEchoDistanceM(null);
          setEchoMsg({ text: msg, warn: true });
          return;
        }
        setEchoMsg({ text: 'Looking for your Echo Bike…', warn: false });
      },
    );
  };

  const zones = useMemo(() => conZones(hr), [hr]);
  const rx = useMemo(() => conPrescription(fmt, { settings: db.settings, whoop }), [fmt, db.settings, whoop]);
  const phases = useMemo<Phase[]>(() => CON_FORMATS[fmt].build(paramsFor(fmt, rx)), [fmt, rx]);
  const totalSec = useMemo(() => phases.reduce((n, p) => n + p.dur, 0), [phases]);

  /*
   * Setup-time safety gate: was the most recent result in THIS format's bare
   * bucket a reported pain stop that hasn't been acknowledged yet?
   *
   * Bare-format bucket, no modality — modality is only ever learned mid-run
   * (Echo Bike telemetry, see `rec.modality` in finish()), so it is never
   * known here for anything else, and guessing one would let a rowing pain
   * stop silently hold (or fail to hold) an unrelated bucket.
   */
  const hold = useMemo(() => painHoldFor(fmt, sessions, db.settings), [fmt, sessions, db.settings]);

  /** The only way past the gate: mark this format's pain stop acknowledged,
   *  which is what lets `hold` recompute to `held: false` on the next render. */
  const acknowledgeHold = () => {
    update((d) => {
      const key = progressionKey(fmt, undefined);
      d.settings.conditioningAck = { ...(d.settings.conditioningAck || {}), [key]: Date.now() };
      d.settings.updatedAt = Date.now();
    });
  };

  /* Indexed, not just resolved: the INDEX is what makes a phase change
     detectable, which is what the buzz below hangs off. -1 means the
     prescription has been run to the end. */
  const phaseIdx = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < phases.length; i++) {
      if (elapsed < acc + phases[i].dur) return i;
      acc += phases[i].dur;
    }
    return -1;
  }, [phases, elapsed]);

  const phaseNow = useMemo(() => {
    if (phaseIdx < 0) return null;
    const into = elapsed - phases.slice(0, phaseIdx).reduce((n, p) => n + p.dur, 0);
    return { p: phases[phaseIdx], into };
  }, [phases, phaseIdx, elapsed]);

  const done = live && phaseIdx < 0;

  /*
   * A buzz on every phase change, and on finishing.
   *
   * This is the screen that exists to run in a pocket with the screen off, and
   * intervals you cannot feel switch are intervals you cannot train to. The
   * very first phase is skipped — you just pressed Start, you know it began.
   */
  const lastPhase = useRef<number | null>(null);
  useEffect(() => {
    if (!live) {
      lastPhase.current = null;
      return;
    }
    if (lastPhase.current === phaseIdx) return;
    const first = lastPhase.current === null;
    lastPhase.current = phaseIdx;
    if (!first) void buzz();
  }, [live, phaseIdx]);

  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => {
      const t = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(t);
      const b = bpmRef.current;
      if (b != null) samples.current.push({ t, bpm: b });
      if (powerRef.current != null) powerSamples.current.push(powerRef.current);
      if (cadenceRef.current != null) cadenceSamples.current.push(cadenceRef.current);
    }, 1000);
    return () => clearInterval(iv);
  }, [live]);

  // Release the strap and the wake lock if the screen goes away mid-session.
  useEffect(() => () => {
    monitor.current?.stop();
    geoTracker.current?.stop();
    ftms.current?.stop();
    void setKeepAwake(false);
  }, []);

  // Android hardware back and the enabled swipe-back both POP this screen, and
  // the cleanup effect above then tears down strap + GPS — losing the clock,
  // every HR sample and the whole route with no warning. beforeRemove fires for
  // both, so intercept it while live and confirm before discarding. (The web
  // app hoists the run to module scope instead; mobile keeps it in refs, so it
  // guards the exit rather than surviving it.)
  //
  // The guard covers the RATING phase too, not just `live`. finish() flips
  // `live` off on its first line, so the moment the post-run chips are up,
  // the old `if (!live) return` let a back gesture pop the screen and
  // silently drop a finished, already-bankable run. In that branch nothing
  // about the clock or samples is at stake — the record already exists in
  // `pending` — so a confirmed exit BANKS it rather than discarding it. The
  // rating stretch is now TWO questions (felt RPE, then mechanical
  // completion), and the guard holds across both: whichever was showing, a
  // forced exit banks whatever was actually answered — `felt` if the athlete
  // got that far, `mechanicalCompletion`/`cardioCompletion` left unset if
  // they never reached or never answered the second question. A run past
  // MIN_LOGGABLE_SEC always ends up banked, fully answered or not.
  useEffect(() => {
    const unsub = nav.addListener('beforeRemove', (e) => {
      if (!live && !rating) return;
      e.preventDefault();
      if (!live) {
        Alert.alert(
          'Leave without rating?',
          'This run is finished and will be banked either way — leaving now only skips the unanswered questions.',
          [
            { text: 'Keep rating', style: 'cancel' },
            {
              text: 'Bank & leave',
              onPress: () => {
                const rec = pending.current;
                pending.current = null;
                setRating(false);
                if (rec) bank(rec);
                nav.dispatch(e.data.action);
              },
            },
          ],
        );
        return;
      }
      Alert.alert(
        'Discard this run?',
        'Leaving now loses the clock and every heart-rate sample banked so far.',
        [
          { text: 'Keep running', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              monitor.current?.stop();
              geoTracker.current?.stop();
              ftms.current?.stop();
              void setKeepAwake(false);
              nav.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsub;
  }, [nav, live, rating]);

  const zone = bpm == null ? null : conZoneOf(bpm, zones);

  const start = async () => {
    // A fresh run must never inherit a stale unrated record. Unreachable while
    // the rating chips are up (the setup screen is hidden), but cheap to pin.
    pending.current = null;
    setRating(false);
    samples.current = [];
    // Bike telemetry resets WITH the run, not just bpm — a still-connected
    // bike repopulates these on its next notification, but a restart must
    // never open on the previous run's stale numbers or samples.
    powerSamples.current = [];
    cadenceSamples.current = [];
    setEchoPowerW(null);
    setEchoCadenceRpm(null);
    setEchoDistanceM(null);
    startedAt.current = Date.now();
    setElapsed(0);
    setResult(null);
    setHrMsg(null);
    setBpm(null);
    setLive(true);
    void setKeepAwake(true);
    monitor.current = createHeartRateMonitor();
    // The second callback is the old conNativeState: a refused permission, a
    // scan that found nothing, an adapter that is off. Without it the screen
    // could only ever show a dash and the athlete had no idea why.
    await monitor.current.start(setBpm, (state, msg) =>
      setHrMsg(
        state === 'connected'
          ? null
          : { text: state === 'scanning' ? 'Looking for your strap…' : msg, warn: state === 'error' },
      ),
    );
    geoSamples.current = [];
    geoTracker.current = createGeoTracker();
    setGeoMsg(null);
    await geoTracker.current.start(
      (s) => geoSamples.current.push(s),
      (state, msg) => setGeoMsg(state === 'tracking' ? null : { text: msg, warn: state === 'error' }),
    );
  };

  const finish = () => {
    setLive(false);
    monitor.current?.stop();
    geoTracker.current?.stop();
    void setKeepAwake(false);

    /*
     * A run too short to be training is discarded rather than banked. Start
     * then immediately Finish used to record a one-second session, and
     * conAdapt then moved your EARNED level off that — a mis-tap quietly
     * rewriting your progression.
     */
    if (elapsed < MIN_LOGGABLE_SEC) {
      setElapsed(0);
      samples.current = [];
      powerSamples.current = [];
      cadenceSamples.current = [];
      return;
    }

    const dur = Math.max(1, elapsed);
    const trace = conDownsample(samples.current, dur);
    const distanceM = totalDistanceM(geoSamples.current);
    const rec: CondResult = {
      id: uid(),
      fmt,
      // The block's authored effort when this run came from one.
      effort: sinkBlock?.effort ?? (fmt === 'steady' ? 'easy' : 'hard'),
      zsec: zoneSeconds(trace, zones),
      dur,
      rec: zones.rec,
      startedAt: startedAt.current,
      hrr: conHrr(trace).hrr,
      trace,
      ...(distanceM > 0
        ? {
            distanceM,
            avgPaceSecPerKm: paceSecPerKm(distanceM, dur) ?? undefined,
            route: geoDownsample(geoSamples.current, dur),
          }
        : {}),
    };
    // A run with Echo V3 telemetry is an air-bike session and says so. The
    // modality tag is what routes it into the per-format-per-modality
    // progression bucket (progressionKey) instead of the bare-format one, and
    // the device identity is stored with the result because air-bike output is
    // not portable across devices — a same-device baseline needs to know what
    // produced the numbers. Banked samples count even if the link dropped
    // mid-run (echoConnected is false then): the ride up to the drop happened.
    if (echoConnected || powerSamples.current.length > 0 || cadenceSamples.current.length > 0) {
      rec.modality = 'air_bike';
      rec.device = { manufacturer: 'Rogue', model: 'Echo Bike', generation: 'V3.0' };
      const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
      if (powerSamples.current.length > 0) rec.avgPowerW = avg(powerSamples.current);
      if (cadenceSamples.current.length > 0) rec.avgCadenceRpm = avg(cadenceSamples.current);
    }
    // Don't bank it yet — ask how it felt, then whether the work was
    // mechanically completed. submitMechanical() finishes the job, and the
    // beforeRemove guard banks it part-answered on a confirmed exit.
    pending.current = rec;
    setRating(true);
    void buzz();
  };

  /** The single write path for a finished run. submitMechanical() and the
   *  exit guard's "Bank & leave" both land here, so a fully-answered and a
   *  part-answered run bank identically. cardioCompletion is DERIVED from
   *  zsec/dur (never asked of the athlete), so it belongs here — not in
   *  submitMechanical — so every write path sets it the same way. */
  const bank = (rec: CondResult) => {
    /*
     * A STRAPLESS SESSION'S MINUTES GO SOMEWHERE NOW, and this is the right
     * place for the same reason `cardioCompletion` is computed here: BOTH
     * write paths land in `bank`. Doing it in `submitMechanical` — where it
     * was first written — would have skipped the exit guard's "Bank & leave",
     * so a run rated and then backed out of would have kept its minutes and
     * lost them at the same time.
     *
     * `withFeltZones` credits the whole duration to the zone the athlete's own
     * RPE names and marks it `zsrc: 'felt'`, so nothing downstream mistakes it
     * for a heart-rate trace. A record that HAS zone seconds is returned
     * untouched, so a strapped session is unaffected. It runs BEFORE
     * `cardioCompletionFor` and before `conAdapt`, because both read `zsec`
     * and a verdict computed on empty zones would disagree with the zones
     * stored beside it.
     */
    Object.assign(rec, withFeltZones(rec));
    rec.cardioCompletion = cardioCompletionFor(rec.fmt ?? fmt, rec.zsec, rec.dur ?? 0);
    update((d) => {
      const at = Date.now();
      const { conProgress } = conAdapt(rec, d.settings);
      d.settings.conProgress = conProgress;
      d.settings.updatedAt = at;
      const core = ensureSharedCore(d, at).core!;
      d.core = appendSharedCoreEvent(core, {
        type: 'workout_completed',
        occurredAt: new Date(at).toISOString(),
        sourceDomain: 'conditioning',
        idempotencyKey: `conditioning:${rec.id || rec.startedAt || at}:completed`,
        payload: { resultId: rec.id, sessionId: activeSession?.id, domain: 'conditioning', durationSeconds: rec.dur },
      });

      /*
       * A run started FROM a session belongs to that session's block. Banking
       * it in the standalone history instead left the block forever unlogged:
       * the session could never reach 100%, Training kept offering work
       * already done, and the recap and history showed none of it. Match by
       * block id first so an edited or reordered session still lands on the
       * right block, then fall back to the index.
       */
      const ds = activeSession ? d.sessions.find((x) => x.id === activeSession.id) : undefined;
      let cb = ds && sinkBid ? ds.blocks.find((b) => b.id === sinkBid) : undefined;
      if (ds && !isCond(cb) && sinkBi >= 0) cb = ds.blocks[sinkBi];
      if (ds && isCond(cb)) {
        cb.condResult = rec;
        ds.updatedAt = at;
        return;
      }
      d.settings.conditioning = pushCondHistory(d.settings, rec);
    });
  };

  // First question. Answering it only advances to the second — the record
  // stays in `pending`, un-banked, still covered by the exit guard, so
  // backing out between the two questions is intercepted exactly like
  // backing out before the first.
  const submitFelt = (felt: string) => {
    const rec = pending.current;
    if (!rec) return;
    rec.felt = felt;
    setQuestionV((v) => v + 1);
  };

  // Second question, and the end of the rating stretch: only here does the
  // record leave `pending` and reach the store, both answers riding in on
  // the same update as the result itself.
  const submitMechanical = (m: CondResult['mechanicalCompletion']) => {
    const rec = pending.current;
    if (!rec) return;
    rec.mechanicalCompletion = m;
    pending.current = null;
    setRating(false);
    setResult(rec);
    bank(rec);
  };

  return (
    <Screen>
      {/* Only when there is nothing running to lose: this screen keeps its
          clock, strap and GPS trace in component state, not the store, so
          unmounting mid-run (which `goBack` does) would discard it silently.
          Setup and a banked result are safe to leave; a live run is not.
          During the rating phase the arrow shows, but the beforeRemove guard
          intercepts it and banks the pending run before letting the pop by. */}
      {!live ? (
        <Tap
          onPress={() => nav.goBack()}
          label="back"
          box={40}
          className="mb-1 h-5 w-5 items-center justify-center self-start rounded-md border border-line2 bg-panel2"
        >
          <T className="text-6 text-muted">←</T>
        </Tap>
      ) : null}
      <Kicker>Conditioning</Kicker>
      <Title>{live ? (phaseNow?.p.name ?? 'Running') : 'Set up'}</Title>

      {!live && !result && !rating ? (
        <>
          <View className="mt-2 flex-row flex-wrap gap-1">
            {(Object.keys(CON_FORMATS) as CondFmtKey[]).map((k) => (
              <Chip key={k} on={fmt === k} onPress={() => setFmt(k)}>
                {CON_FORMATS[k].name}
              </Chip>
            ))}
          </View>

          {hold.held ? (
            <Card className="mt-2 border-bad bg-panel">
              <Kicker className="text-bad">Before you continue</Kicker>
              <T className="mt-0.5 text-4 text-text">{hold.note}</T>
              <Btn variant="brass" size="lg" className="mt-2" onPress={acknowledgeHold}>
                I&apos;m ready to continue
              </Btn>
            </Card>
          ) : null}

          <Card className="mt-2">
            <Kicker>Today&apos;s prescription</Kicker>
            <T w="black" num className="mt-0.5 text-7 text-gold2">
              {fmt === 'steady' ? `${rx.minutes} min` : fmt === 'free' ? 'open-ended' : `${rx.rounds} × ${rx.work}s / ${rx.rest}s`}
            </T>
            {rx.note ? <T className="mt-0.5 text-4 text-muted">{rx.note}</T> : null}
            <T num className="mt-1 text-3 text-dim">
              {phases.length} phases · {fmtClock(totalSec)} total
            </T>
          </Card>

          <SectionHead title="Zones you'll be held to" />
          <Card>
            {zones.list.map((b) => (
              <Row key={b.key} dot={zoneNeon(b.key)} glow label={b.name} value={`${b.lo}–${b.hi}`} />
            ))}
          </Card>

          {hold.held ? null : (
            <Btn variant="brass" size="lg" className="mt-3" onPress={() => void start()}>
              Start
            </Btn>
          )}
          {/* Manual, not gated on the block's modality: nothing in the app
              sets CondBlock.modality ahead of a session, so a gate would
              simply never show the control — same reasoning as web. */}
          {echoConnected ? (
            <T className="mt-1 text-center text-3 text-dim">Echo Bike connected</T>
          ) : (
            <Btn className="mt-1" onPress={() => void connectEcho()}>
              Connect Echo Bike
            </Btn>
          )}
          {echoMsg ? (
            <T className={'mt-1 text-center text-3 ' + (echoMsg.warn ? 'text-warn' : 'text-muted')}>{echoMsg.text}</T>
          ) : null}
        </>
      ) : null}

      {live ? (
        <>
          {/* The live surface per the web app: a ring lit in the CURRENT
              zone's neon, the beat inside it, the clock beside it. */}
          <Card className="mt-2 flex-row items-center gap-2">
            <Ring
              frac={bpm == null ? 0 : Math.min(1, bpm / zones.max)}
              size={120}
              stroke={10}
              color={zone ? zoneNeon(zone.key) : color.ringIdle}
              glow={zone != null}
            >
              {bpm == null ? (
                <T className="text-3 text-dim">no strap</T>
              ) : (
                <>
                  <T w="black" num className="text-9" style={{ color: zoneNeon(zone!.key) }}>
                    {bpm}
                  </T>
                  <T w="semi" className="text-1 uppercase text-dim" style={{ letterSpacing: 1 }}>
                    bpm
                  </T>
                </>
              )}
            </Ring>
            <View className="min-w-0 flex-1">
              <Kicker>{zone ? zone.name : 'Below zones'}</Kicker>
              <T w="black" num className="mt-0.5 text-8 text-text">
                {fmtClock(elapsed)}
              </T>
              <T num className="text-3 text-dim">
                of {fmtClock(totalSec)}
              </T>
              {phaseNow ? (
                <T num className="mt-1 text-4 text-gold2">
                  {phaseNow.p.name} · {fmtClock(phaseNow.p.dur - phaseNow.into)} left
                </T>
              ) : (
                /* The prescription is done. It used to just keep counting with
                   no label, so nothing ever told you to stop. */
                <T w="semi" className="mt-1 text-4 text-done-ink">
                  Prescription complete — tap Finish
                </T>
              )}
              {echoPowerW != null || echoCadenceRpm != null || echoDistanceM != null ? (
                <T num className="mt-1 text-4 text-muted">
                  {[
                    echoPowerW != null ? `${Math.round(echoPowerW)}W` : null,
                    echoCadenceRpm != null ? `${Math.round(echoCadenceRpm)}rpm` : null,
                    echoDistanceM != null ? `${(echoDistanceM / 1000).toFixed(1)}km` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </T>
              ) : null}
              {bpm == null && hrMsg ? (
                <T className={'mt-1 text-3 ' + (hrMsg.warn ? 'text-warn' : 'text-muted')}>{hrMsg.text}</T>
              ) : null}
              {echoMsg ? (
                <T className={'mt-1 text-3 ' + (echoMsg.warn ? 'text-warn' : 'text-muted')}>{echoMsg.text}</T>
              ) : null}
              {geoMsg ? (
                <T className={'mt-1 text-3 ' + (geoMsg.warn ? 'text-warn' : 'text-muted')}>{geoMsg.text}</T>
              ) : null}
              {geoSamples.current.length > 1 ? (
                <View className="mt-1">
                  <RouteMap route={geoDownsample(geoSamples.current, elapsed)} live />
                </View>
              ) : null}
            </View>
          </Card>
          <Btn variant="brass" size="lg" className="mt-3" onPress={finish}>
            {done ? 'Finish ✓' : 'Finish'}
          </Btn>
          {elapsed < MIN_LOGGABLE_SEC ? (
            <T className="mt-1 text-center text-3 text-dim">
              Runs under {MIN_LOGGABLE_SEC}s are discarded, not logged.
            </T>
          ) : null}
          {!echoConnected ? (
            <Btn className="mt-1" onPress={() => void connectEcho()}>
              Connect Echo Bike
            </Btn>
          ) : null}
        </>
      ) : null}

      {rating && pending.current?.felt == null ? (
        <>
          <SectionHead title="How did that feel?" />
          <View className="flex-row flex-wrap justify-center gap-1">
            {['3', '4', '5', '6', '7', '8', '9', '10'].map((r) => (
              <Chip key={r} on={false} onPress={() => submitFelt(r)}>
                RPE {r}
              </Chip>
            ))}
          </View>
        </>
      ) : null}

      {rating && pending.current?.felt != null && pending.current.mechanicalCompletion == null ? (
        <>
          <SectionHead title="Did you complete the work?" />
          <View className="flex-row flex-wrap justify-center gap-1">
            {(
              [
                ['met', 'Completed it'],
                ['local_fatigue', 'Muscles gave out'],
                ['technique_fail', 'Form broke down'],
                ['pain_stop', 'Stopped — pain'],
              ] as const
            ).map(([m, label]) => (
              <Chip key={m} on={false} onPress={() => submitMechanical(m)}>
                {label}
              </Chip>
            ))}
          </View>
        </>
      ) : null}

      {result ? (
        <>
          <SectionHead title="Banked" />
          <Card>
            {/*
              * SAYS SO WHEN IT IS SELF-REPORTED. `withFeltZones` credits a
              * strapless session's whole duration to the zone its RPE names,
              * which is a real answer and NOT a heart-rate trace — and a row
              * reading "Conditioning 20:00" is indistinguishable from a
              * measured one unless the screen admits the difference.
              */}
            {result.zsrc === 'felt' ? (
              <T className="mb-1 text-3 text-dim">
                From how it felt — no strap this session, so the whole time is banked at that effort.
              </T>
            ) : null}
            {(['low', 'mod', 'high'] as const).map((k) => (
              <Row
                key={k}
                dot={zoneInk(k)}
                label={zones.list.find((b) => b.key === k)?.name || k}
                value={fmtClock(result.zsec?.[k] ?? 0)}
              />
            ))}
            <View className="mt-1.5 border-t border-line pt-1">
              <T num className="text-3 text-dim">
                {fmtClock(result.dur ?? 0)} total
                {result.hrr != null ? ` · HR dropped ${result.hrr}bpm in the minute after peak` : ''}
              </T>
              {result.distanceM ? (
                <T num className="mt-0.5 text-3 text-dim">
                  {fmtDistance(result.distanceM)}
                  {result.avgPaceSecPerKm ? ` · ${fmtPace(result.avgPaceSecPerKm)}` : ''}
                </T>
              ) : null}
            </View>
          </Card>
          <Btn className="mt-2" onPress={() => setResult(null)}>
            Done
          </Btn>
        </>
      ) : null}
    </Screen>
  );
}
