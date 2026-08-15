import { useMemo } from 'react';
import { CON_FORMATS, isProgressedFmt, paramsFor } from '@hybrid/engine';
import { clock, prescriptionFor, totalSeconds, type Rig } from '../rig';

const MAX_LEVEL = 20;

interface Row {
  level: number;
  minutes?: number;
  rounds?: number;
  work?: number;
  rest?: number;
  total: number;
  moved: boolean;
}

/**
 * Twenty levels of earned progression, laid out so you can see the levers
 * rotate.
 *
 * `conPrescription` applies `+1 round`, then `+5s work`, then `−5s rest`, in
 * that order, one lever per level — so a level that appears to change nothing
 * is usually a lever that has hit its clamp (`rounds` caps at 12, `work` at
 * double the base, `rest` floors at 60% of base). The `moved` column exists
 * because that is the single most misleading thing about this table: a run of
 * identical rows is not a bug, it is three clamped levers, and it is also
 * exactly what "progression stopped working" feels like from the phone.
 */
export function Progression({ rig }: { rig: Rig }) {
  const progressed = isProgressedFmt(rig.fmt);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let prev = '';
    for (let level = 0; level <= MAX_LEVEL; level++) {
      const rx = prescriptionFor({ ...rig, level }, { ignoreDaily: true });
      const phases = CON_FORMATS[rig.fmt].build(paramsFor(rig.fmt, rx));
      const sig = [rx.minutes, rx.rounds, rx.work, rx.rest].join('|');
      out.push({
        level,
        minutes: rx.minutes,
        rounds: rx.rounds,
        work: rx.work,
        rest: rx.rest,
        total: totalSeconds(phases),
        moved: level > 0 && sig !== prev,
      });
      prev = sig;
    }
    return out;
  }, [rig]);

  const movedCount = rows.filter((r) => r.moved).length;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const growth =
    first && last && first.total > 0 ? Math.round(((last.total - first.total) / first.total) * 100) : 0;

  return (
    <section className="panel">
      <h2>Levels 0 → {MAX_LEVEL}</h2>
      <p className="hint">
        The earned baseline only — the daily readiness gate is switched off here, so every change in
        this table is progression and nothing else.
      </p>

      {!progressed ? (
        <p className="note">
          <strong>{CON_FORMATS[rig.fmt].name} does not progress.</strong> It is not in{' '}
          <code>PROGRESSED_FORMATS</code>, so <code>conPrescription</code> pins its level at 0 and
          every row below would be identical. Pick Steady-state, Intervals or Tempo.
        </p>
      ) : (
        <>
          <div className="scroller">
            <table className="data">
              <thead>
                <tr>
                  <th>Level</th>
                  {rig.fmt === 'steady' ? (
                    <th>Minutes</th>
                  ) : (
                    <>
                      <th>Rounds</th>
                      <th>Work</th>
                      <th>Rest</th>
                    </>
                  )}
                  <th>Session</th>
                  <th>Moved</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.level}
                    className={(r.moved ? 'moved ' : '') + (r.level === rig.level ? 'here' : '')}
                  >
                    <td>{r.level}</td>
                    {rig.fmt === 'steady' ? (
                      <td>{r.minutes}</td>
                    ) : (
                      <>
                        <td>{r.rounds}</td>
                        <td>{r.work}s</td>
                        <td>{r.rest}s</td>
                      </>
                    )}
                    <td>{clock(r.total)}</td>
                    <td>{r.moved ? 'yes' : r.level === 0 ? '—' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="note">
            {movedCount} of {MAX_LEVEL} levels change the session. Level 0 to level {MAX_LEVEL} is{' '}
            {growth >= 0 ? '+' : ''}
            {growth}% total session time. Rows that do not move are clamped levers, not a stalled
            engine — <code>rounds</code> caps at 12, <code>work</code> at double its base, and{' '}
            <code>rest</code> floors at 60% of its base.
          </p>
        </>
      )}
    </section>
  );
}
