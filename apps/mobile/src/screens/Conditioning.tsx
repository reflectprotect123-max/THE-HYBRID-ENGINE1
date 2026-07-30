import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  CON_FORMATS,
  conAdapt,
  conDownsample,
  conHrr,
  conPrescription,
  conZoneOf,
  conZones,
  fmtClock,
  fmtDistance,
  fmtPace,
  geoDownsample,
  isCond,
  paceSecPerKm,
  paramsFor,
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
import { useDb } from '../store/db';
import { buzz, createGeoTracker, createHeartRateMonitor, setKeepAwake } from '../native/capabilities';
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
  const { db, hr, whoop, update, activeSession } = useDb();
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

  const zones = useMemo(() => conZones(hr), [hr]);
  const rx = useMemo(() => conPrescription(fmt, { settings: db.settings, whoop }), [fmt, db.settings, whoop]);
  const phases = useMemo<Phase[]>(() => CON_FORMATS[fmt].build(paramsFor(fmt, rx)), [fmt, rx]);
  const totalSec = useMemo(() => phases.reduce((n, p) => n + p.dur, 0), [phases]);

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
    }, 1000);
    return () => clearInterval(iv);
  }, [live]);

  // Release the strap and the wake lock if the screen goes away mid-session.
  useEffect(() => () => {
    monitor.current?.stop();
    geoTracker.current?.stop();
    void setKeepAwake(false);
  }, []);

  // Android hardware back and the enabled swipe-back both POP this screen, and
  // the cleanup effect above then tears down strap + GPS — losing the clock,
  // every HR sample and the whole route with no warning. beforeRemove fires for
  // both, so intercept it while live and confirm before discarding. (The web
  // app hoists the run to module scope instead; mobile keeps it in refs, so it
  // guards the exit rather than surviving it.)
  useEffect(() => {
    const unsub = nav.addListener('beforeRemove', (e) => {
      if (!live) return;
      e.preventDefault();
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
              void setKeepAwake(false);
              nav.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsub;
  }, [nav, live]);

  const zone = bpm == null ? null : conZoneOf(bpm, zones);

  const start = async () => {
    samples.current = [];
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
    setResult(rec);
    void buzz();
    update((d) => {
      const { conProgress } = conAdapt(rec, d.settings);
      d.settings.conProgress = conProgress;
      d.settings.updatedAt = Date.now();

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
        ds.updatedAt = Date.now();
        return;
      }
      d.settings.conditioning = pushCondHistory(d.settings, rec);
    });
  };

  return (
    <Screen>
      {/* Only when there is nothing running to lose: this screen keeps its
          clock, strap and GPS trace in component state, not the store, so
          unmounting mid-run (which `goBack` does) would discard it silently.
          Setup and a banked result are safe to leave; a live run is not. */}
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

      {!live && !result ? (
        <>
          <View className="mt-2 flex-row flex-wrap gap-1">
            {(Object.keys(CON_FORMATS) as CondFmtKey[]).map((k) => (
              <Chip key={k} on={fmt === k} onPress={() => setFmt(k)}>
                {CON_FORMATS[k].name}
              </Chip>
            ))}
          </View>

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

          <Btn variant="brass" size="lg" className="mt-3" onPress={() => void start()}>
            Start
          </Btn>
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
              {bpm == null && hrMsg ? (
                <T className={'mt-1 text-3 ' + (hrMsg.warn ? 'text-warn' : 'text-muted')}>{hrMsg.text}</T>
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
        </>
      ) : null}

      {result ? (
        <>
          <SectionHead title="Banked" />
          <Card>
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
