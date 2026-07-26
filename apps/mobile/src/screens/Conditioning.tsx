import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  CON_FORMATS,
  conAdapt,
  conDownsample,
  conHrr,
  conPrescription,
  conZoneOf,
  conZones,
  fmtClock,
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
import { createHeartRateMonitor, setKeepAwake } from '../native/capabilities';
import { Btn, Card, Chip, Kicker, Row, Screen, SectionHead, Title, zoneInk } from '../ui';

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
export function ConditioningScreen() {
  const { db, hr, whoop, update } = useDb();
  const [fmt, setFmt] = useState<CondFmtKey>('intervals');
  const [live, setLive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bpm, setBpm] = useState<number | null>(null);
  const [result, setResult] = useState<CondResult | null>(null);
  const samples = useRef<HrSample[]>([]);
  const startedAt = useRef(0);
  const monitor = useRef<ReturnType<typeof createHeartRateMonitor> | null>(null);

  const zones = useMemo(() => conZones(hr), [hr]);
  const rx = useMemo(() => conPrescription(fmt, { settings: db.settings, whoop }), [fmt, db.settings, whoop]);
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

  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => {
      const t = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(t);
      if (bpm != null) samples.current.push({ t, bpm });
    }, 1000);
    return () => clearInterval(iv);
  }, [live, bpm]);

  // Release the strap and the wake lock if the screen goes away mid-session.
  useEffect(() => () => {
    monitor.current?.stop();
    void setKeepAwake(false);
  }, []);

  const zone = bpm == null ? null : conZoneOf(bpm, zones);

  const start = async () => {
    samples.current = [];
    startedAt.current = Date.now();
    setElapsed(0);
    setResult(null);
    setLive(true);
    void setKeepAwake(true);
    monitor.current = createHeartRateMonitor();
    await monitor.current.start(setBpm);
  };

  const finish = () => {
    setLive(false);
    monitor.current?.stop();
    void setKeepAwake(false);

    const dur = Math.max(1, elapsed);
    const trace = conDownsample(samples.current, dur);
    const rec: CondResult = {
      id: uid(),
      fmt,
      effort: fmt === 'steady' ? 'easy' : 'hard',
      zsec: zoneSeconds(trace, zones),
      dur,
      rec: zones.rec,
      startedAt: startedAt.current,
      hrr: conHrr(trace).hrr,
      trace,
    };
    setResult(rec);
    update((d) => {
      const { conProgress } = conAdapt(rec, d.settings);
      d.settings.conProgress = conProgress;
      d.settings.conditioning = pushCondHistory(d.settings, rec);
      d.settings.updatedAt = Date.now();
    });
  };

  return (
    <Screen>
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
            <Text className="mt-0.5 text-7 font-black text-gold2">
              {fmt === 'steady' ? `${rx.minutes} min` : fmt === 'free' ? 'open-ended' : `${rx.rounds} × ${rx.work}s / ${rx.rest}s`}
            </Text>
            {rx.note ? <Text className="mt-0.5 text-4 text-muted">{rx.note}</Text> : null}
            <Text className="mt-1 text-3 text-dim">
              {phases.length} phases · {fmtClock(totalSec)} total
            </Text>
          </Card>

          <SectionHead title="Zones you'll be held to" />
          <Card>
            {zones.list.map((b) => (
              <Row key={b.key} dot={zoneInk(b.key)} label={b.name} value={`${b.lo}–${b.hi}`} />
            ))}
          </Card>

          <Btn variant="brass" className="mt-3" onPress={() => void start()}>
            Start
          </Btn>
        </>
      ) : null}

      {live ? (
        <>
          <Card className="mt-2 items-center">
            <Text className="text-9 font-black" style={{ color: zone ? zoneInk(zone.key) : '#847d73' }}>
              {bpm == null ? '—' : bpm}
            </Text>
            <Text className="text-2 text-dim">{bpm == null ? 'no strap connected' : 'bpm · ' + zone?.name}</Text>
            <Text className="mt-2 text-8 font-black text-text">{fmtClock(elapsed)}</Text>
            <Text className="text-3 text-dim">of {fmtClock(totalSec)}</Text>
            {phaseNow ? (
              <Text className="mt-1 text-4 text-gold2">
                {phaseNow.p.name} · {fmtClock(phaseNow.p.dur - phaseNow.into)} left
              </Text>
            ) : null}
          </Card>
          <Btn variant="brass" className="mt-3" onPress={finish}>
            Finish
          </Btn>
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
            <Text className="mt-1.5 border-t border-line pt-1 text-3 text-dim">
              {fmtClock(result.dur ?? 0)} total
              {result.hrr != null ? ` · HR dropped ${result.hrr}bpm in the minute after peak` : ''}
            </Text>
          </Card>
          <Btn className="mt-2" onPress={() => setResult(null)}>
            Done
          </Btn>
        </>
      ) : null}
    </Screen>
  );
}
