import { useMemo } from 'react';
import { CON_FORMATS, isProgressedFmt } from '@hybrid/engine';
import { clock, phasesFor, prescriptionFor, totalSeconds, type Rig } from '../rig';

const KIND_LABEL: Record<string, string> = {
  warm: 'warm-up',
  work: 'work',
  work2: 'steady work',
  rest: 'recover',
  cool: 'cool-down',
};

/**
 * The exact `Phase[]` a session would run, for the rig as configured.
 *
 * This is the panel that makes "more formats" a solvable problem rather than a
 * vague one: a new format is a `FormatDef` whose `build()` returns phases, and
 * this screen is where you see whether the phases it returns are a session
 * anyone would want to do.
 */
export function Formats({ rig }: { rig: Rig }) {
  const rx = useMemo(() => prescriptionFor(rig), [rig]);
  const phases = useMemo(() => phasesFor(rig), [rig]);
  const total = totalSeconds(phases);
  const def = CON_FORMATS[rig.fmt];
  const progressed = isProgressedFmt(rig.fmt);

  const work = phases.filter((p) => p.kind === 'work' || p.kind === 'work2');
  const workSec = work.reduce((n, p) => n + p.dur, 0);

  return (
    <>
      <section className="panel">
        <h2>What the engine prescribes</h2>
        <p className="hint">
          <code>conPrescription(&apos;{rig.fmt}&apos;, …)</code> — the earned baseline for this
          format and modality, with a daily readiness gate on top.
        </p>

        <div className="readout">
          <div>
            <span className="k">format </span>
            {def.name} · <span className="k">default </span>
            {def.desc}
          </div>
          <div>
            <span className="k">level </span>
            {rx.level}
            {!progressed && <span className="k"> (this format does not progress)</span>}
          </div>
          <div>
            <span className="k">daily </span>
            {rx.dailyAdj === 0 ? 'no adjustment' : 'eased (−1)'}
            {rig.rec == null ? (
              <span className="k"> · no recovery data</span>
            ) : (
              <span className="k"> · {rig.rec}% recovery</span>
            )}
          </div>
          <div>
            <span className="k">prescribed </span>
            {rig.fmt === 'steady'
              ? `${rx.minutes} min`
              : rig.fmt === 'free'
                ? 'open-ended'
                : `${rx.rounds} × ${rx.work}s work / ${rx.rest}s rest`}
          </div>
          <div>
            <span className="k">note </span>
            {rx.note || '—'}
          </div>
        </div>

        {!progressed && (
          <p className="note">
            <strong>Heads up.</strong> <code>PROGRESSED_FORMATS</code> is{' '}
            <code>[&apos;steady&apos;, &apos;intervals&apos;, &apos;tempo&apos;]</code>. Custom and
            Free run never earn a level however well they go — Custom is the athlete&rsquo;s own
            numbers by definition, and Free run has no target to hit.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>The session it builds</h2>
        <p className="hint">
          {phases.length} phases · {clock(total)} total · {clock(workSec)} of it working (
          {Math.round((workSec / Math.max(1, total)) * 100)}%)
        </p>

        <div className="phases">
          {phases.map((p, i) => (
            <div key={i} className={'phase-row k-' + p.kind}>
              <span>
                {p.name}
                {p.round ? <span className="kind"> · round {p.round}</span> : null}
              </span>
              <span className="kind">{KIND_LABEL[p.kind] ?? p.kind}</span>
              <span className="dur">{clock(p.dur)}</span>
            </div>
          ))}
        </div>

        {rig.fmt === 'free' && (
          <p className="note">
            Free run is one 8-hour phase — it is not a timed session, it is a container for tracking
            heart rate until you stop. The clock in <em>Run it</em> will simply count up.
          </p>
        )}
      </section>
    </>
  );
}
