import {
  CON_FORMAT_KEYS,
  CON_FORMATS,
  conPrescription,
  paramsFor,
  type CondFmtKey,
  type Modality,
  type Phase,
  type Prescription,
  type Settings,
  type WhoopSample,
} from '@hybrid/engine';

/**
 * The lab's one seam onto the engine.
 *
 * Every panel goes through here rather than calling `conPrescription` with its
 * own hand-built context, so the four panels cannot drift into showing four
 * subtly different answers for the same inputs — which is the exact failure
 * that would make a bench worse than no bench.
 */

export const FORMATS = CON_FORMAT_KEYS;

export const MODALITIES: Modality[] = ['row', 'run', 'ski', 'bike', 'air_bike'];

export const MODALITY_LABEL: Record<Modality, string> = {
  row: 'Row',
  run: 'Run',
  ski: 'Ski',
  bike: 'Bike',
  air_bike: 'Air bike',
};

export interface Rig {
  fmt: CondFmtKey;
  modality: Modality;
  /** The earned level to pretend the athlete has banked, 0–20. */
  level: number;
  /** WHOOP recovery percentage, or null for "no strap today". */
  rec: number | null;
}

/**
 * A `Settings` carrying exactly one thing: the progression level for this
 * rig's format+modality bucket.
 *
 * `conProgLevel` reads `settings.conProgress[progressionKey(fmt, modality)]`,
 * so writing the level under that key is what makes the level slider real —
 * the lab never sets a level directly, it sets the same stored state the app
 * sets and lets the engine read it back. A panel that shortcut this would be
 * demonstrating the lab's own arithmetic instead of the engine's.
 */
export function settingsFor(rig: Rig): Settings {
  const key = rig.modality ? rig.fmt + ':' + rig.modality : rig.fmt;
  return { conProgress: { [key]: { level: rig.level, miss: 0 } } } as Settings;
}

/**
 * A `WhoopSample` good enough for `todayRecovery`, or null.
 *
 * `conPrescription` only ever asks the sample for its recovery score, and a
 * null sample is the honest representation of a strapless day — which is a
 * state the lab needs to be able to show, because it is the state most of an
 * athlete's sessions are actually in.
 */
export function whoopFor(rig: Rig): WhoopSample | null {
  // `recoveryScore`, NOT `recovery` — `todayRecovery` reads only that field and
  // silently answers null for anything else, which would make every rig look
  // like a strapless day while appearing to carry a number.
  return rig.rec == null ? null : { recoveryScore: rig.rec };
}

/**
 * `ignoreDaily` is how the Progression panel asks for the EARNED baseline
 * alone. Without it a low-recovery day subtracts a round from every row of the
 * level table at once, and the table stops answering the question it exists to
 * answer — whether the level itself moves anything.
 */
export function prescriptionFor(rig: Rig, opts: { ignoreDaily?: boolean } = {}): Prescription {
  return conPrescription(rig.fmt, {
    settings: settingsFor(rig),
    whoop: whoopFor(rig),
    modality: rig.modality,
    ignoreDaily: opts.ignoreDaily,
  });
}

export function phasesFor(rig: Rig): Phase[] {
  const rx = prescriptionFor(rig);
  return CON_FORMATS[rig.fmt].build(paramsFor(rig.fmt, rx));
}

export function totalSeconds(phases: Phase[]): number {
  return phases.reduce((n, p) => n + p.dur, 0);
}

/** mm:ss, or h:mm:ss once an hour is on the clock. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}
