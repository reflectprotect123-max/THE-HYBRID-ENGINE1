import { useEffect, useMemo, useRef, useState } from 'react';
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
 */
export function Conditioning() {
  const { hr, settings, whoop, update } = useDb();
  const [fmt, setFmt] = useState<CondFmtKey>('intervals');
  const [live, setLive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bpm, setBpm] = useState<number | null>(null);
  const samples = useRef<HrSample[]>([]);
  const startedAt = useRef(0);
  const [result, setResult] = useState<CondResult | null>(null);

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

  useEffect(() => {
    if (!live) return;
    const iv = window.setInterval(() => {
      const t = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(t);
      if (bpm != null) samples.current.push({ t, bpm });
    }, 1000);
    return () => window.clearInterval(iv);
  }, [live, bpm]);

  const zone = bpm == null ? null : conZoneOf(bpm, zones);

  function start() {
    samples.current = [];
    startedAt.current = Date.now();
    setElapsed(0);
    setResult(null);
    setLive(true);
    void connectStrap(setBpm);
  }

  function finish() {
    setLive(false);
    const dur = Math.max(1, elapsed);
    const trace = conDownsample(samples.current, dur);
    const zsec = zoneSeconds(trace, zones);
    const rec: CondResult = {
      id: uid(),
      fmt,
      effort: fmt === 'steady' ? 'easy' : 'hard',
      zsec,
      dur,
      rec: zones.rec,
      startedAt: startedAt.current,
      hrr: conHrr(trace).hrr,
      trace,
    };
    setResult(rec);

    update((draft) => {
      const { conProgress } = conAdapt(rec, draft.settings);
      draft.settings.conProgress = conProgress;
      draft.settings.conditioning = pushCondHistory(draft.settings, rec);
      draft.settings.updatedAt = Date.now();
    });
  }

  return (
    <>
      <Kicker>Conditioning</Kicker>
      <ScreenTitle>{live ? (phaseNow?.p.name ?? 'Running') : 'Set up'}</ScreenTitle>

      {!live && !result ? (
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
                  <span className="h-1 w-1 shrink-0 rounded-pill" style={{ background: zoneInk(b.key) }} />
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
              color={zone ? zoneInk(zone.key) : 'var(--color-ring-idle)'}
              size={120}
              stroke={10}
            >
              {bpm == null ? (
                <span className="text-3 text-dim">no strap</span>
              ) : (
                <>
                  <span className="num text-9 font-[900]" style={{ color: zoneInk(zone!.key) }}>
                    {bpm}
                  </span>
                  <span className="text-2 text-dim">bpm</span>
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

function zoneInk(k: 'low' | 'mod' | 'high'): string {
  return k === 'low' ? 'var(--color-z-low)' : k === 'mod' ? 'var(--color-z-mod)' : 'var(--color-z-high)';
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
