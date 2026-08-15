import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, phasesFor, totalSeconds, type Rig } from '../rig';

/**
 * A short two-tone beep, built on demand.
 *
 * The AudioContext is created inside the Start handler rather than at mount:
 * every browser suspends a context that was not created in a user gesture, and
 * a suspended context fails silently — the timer would look correct and simply
 * never make a sound, which is the failure mode hardest to notice while
 * testing on a muted laptop.
 */
function useBeeper() {
  const ctx = useRef<AudioContext | null>(null);

  const arm = () => {
    if (!ctx.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) ctx.current = new Ctor();
    }
    void ctx.current?.resume();
  };

  const beep = (hz: number, ms: number) => {
    const c = ctx.current;
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    // Ramped, not switched: a square-edged gain change is an audible click on
    // every phase boundary, which is the whole point of the sound being here.
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + ms / 1000 + 0.02);
  };

  return { arm, beep };
}

export function RunIt({ rig }: { rig: Rig }) {
  const phases = useMemo(() => phasesFor(rig), [rig]);
  const total = totalSeconds(phases);

  const [live, setLive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const { arm, beep } = useBeeper();

  // Reconfiguring the rig mid-run would leave the clock running against a
  // session that no longer exists. Stop rather than silently re-map.
  useEffect(() => {
    setLive(false);
    setElapsed(0);
  }, [rig]);

  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 250);
    return () => clearInterval(iv);
  }, [live]);

  const phaseIdx = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      if (!p) break;
      if (elapsed < acc + p.dur) return i;
      acc += p.dur;
    }
    return -1;
  }, [phases, elapsed]);

  const now = useMemo(() => {
    if (phaseIdx < 0) return null;
    const p = phases[phaseIdx];
    if (!p) return null;
    const before = phases.slice(0, phaseIdx).reduce((n, q) => n + q.dur, 0);
    return { p, into: elapsed - before, left: p.dur - (elapsed - before) };
  }, [phases, phaseIdx, elapsed]);

  const done = live && phaseIdx < 0;

  /*
   * One cue per phase CHANGE, keyed on the index rather than the phase object —
   * two consecutive rounds produce equal-looking phases, and comparing by value
   * would skip the boundary between them entirely.
   *
   * The very first phase is skipped: you just pressed Start.
   */
  const lastIdx = useRef<number | null>(null);
  useEffect(() => {
    if (!live) {
      lastIdx.current = null;
      return;
    }
    if (lastIdx.current === phaseIdx) return;
    const first = lastIdx.current === null;
    lastIdx.current = phaseIdx;
    if (first) return;

    const kind = phaseIdx < 0 ? 'end' : phases[phaseIdx]?.kind;
    if (kind === 'end') {
      beep(880, 500);
      navigator.vibrate?.([200, 80, 200, 80, 200]);
    } else if (kind === 'work' || kind === 'work2') {
      beep(880, 160);
      navigator.vibrate?.([140, 60, 140]);
    } else {
      beep(440, 220);
      navigator.vibrate?.(140);
    }
  }, [live, phaseIdx, phases, beep]);

  const start = () => {
    arm();
    startedAt.current = Date.now();
    setElapsed(0);
    setLive(true);
  };

  const stop = () => {
    setLive(false);
    setElapsed(0);
  };

  const kind = now?.p.kind ?? 'cool';
  const bigCls = kind === 'work' || kind === 'work2' ? 'work' : kind === 'rest' ? 'rest' : kind === 'warm' ? 'warm' : 'cool';
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;

  return (
    <section className="panel">
      <h2>Run it</h2>
      <p className="hint">
        The real <code>Phase[]</code> on a clock, with a cue on every boundary. Nothing is logged and
        nothing is saved — this is for feeling whether a format is any good to actually do.
      </p>

      <div className="clock">
        {!live ? (
          <>
            <div className="now">Ready · {phases.length} phases</div>
            <div className="big cool">{clock(total)}</div>
            <div className="sub">total session</div>
          </>
        ) : done ? (
          <>
            <div className="now">Finished</div>
            <div className="big work">{clock(elapsed)}</div>
            <div className="sub">{phases.length} phases done</div>
          </>
        ) : (
          <>
            <div className="now">
              {now?.p.name}
              {now?.p.round ? ` · round ${now.p.round} of ${phases.filter((p) => p.kind === 'work').length}` : ''}
            </div>
            <div className={'big ' + bigCls}>{clock(now?.left ?? 0)}</div>
            <div className="sub">
              {clock(elapsed)} elapsed · {clock(Math.max(0, total - elapsed))} left
            </div>
          </>
        )}
      </div>

      <div className="bar">
        <i style={{ width: pct + '%' }} />
      </div>

      <div className="btn-row">
        {!live ? (
          <button type="button" className="btn" onClick={start}>
            Start
          </button>
        ) : (
          <button type="button" className="btn ghost" onClick={stop}>
            Stop
          </button>
        )}
      </div>

      {rig.fmt === 'free' && (
        <p className="note">
          Free run is a single 8-hour phase, so there is nothing to cue and the countdown is
          meaningless. Watch the elapsed line instead.
        </p>
      )}

      <p className="note">
        No wake lock here. The Android app takes one during a real session; this bench does not,
        because a page that holds your screen awake while you read it is worse than one you have to
        tap. Expect the phone to sleep if you leave it.
      </p>
    </section>
  );
}
