import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  blockExercises,
  detectPRs,
  epley,
  fmtClock,
  isCond,
  isWarmup,
  sessionRpe,
  sessionVolume,
  type LoggedSet,
  type StrengthBlock,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Button, Card, Kicker, ScreenTitle, SectionHead } from '../ui';

/*
 * What just happened. Shown after a session finishes.
 *
 * PRs first, because that is the thing worth knowing; then the honest totals.
 * Warm-ups are excluded everywhere here for the same reason they are excluded
 * from the maths — counting them would flatter the numbers.
 */
export function Recap() {
  const { id } = useParams();
  const nav = useNavigate();
  const { sessions } = useDb();

  const s = sessions.find((x) => x.id === id);
  const others = useMemo(() => sessions.filter((x) => x.id !== id), [sessions, id]);
  const prs = useMemo(() => (s ? detectPRs(s, others) : []), [s, others]);

  if (!s) {
    return (
      <>
        <ScreenTitle>Session not found</ScreenTitle>
        <Button className="mt-2" variant="brass" onClick={() => nav('/history')}>
          Back to History
        </Button>
      </>
    );
  }

  const vol = sessionVolume(s);
  const rpe = sessionRpe(s);
  const dur = s.completedAt && s.startedAt ? Math.max(0, Math.round((s.completedAt - s.startedAt) / 1000)) : 0;
  const workingSets = s.blocks.reduce(
    (n, b) => n + blockExercises(b as StrengthBlock<LoggedSet>).reduce((m, e) => m + e.sets.filter((st) => st.done && !isWarmup(st)).length, 0),
    0,
  );

  return (
    <>
      <Kicker>{s.date}</Kicker>
      <ScreenTitle>{s.name || 'Session'}</ScreenTitle>

      {prs.length ? (
        <Card className="mt-2 border-gold-line bg-gold-wash">
          <Kicker>{prs.length === 1 ? 'Personal record' : 'Personal records'}</Kicker>
          <ul className="num mt-0.5 flex flex-col gap-0.5 text-5 font-[750] text-gold2">
            {prs.map((p) => (
              <li key={p.name}>
                {p.name} — {p.kg}kg × {p.reps}
                <span className="ml-1 text-3 font-[500] text-muted">
                  e1RM {Math.round(p.e1)}kg{p.prevE1 != null ? ` (was ${Math.round(p.prevE1)})` : ' — first one on record'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-1">
        <Stat label="Volume" value={vol ? vol.toLocaleString() : '—'} unit="kg" />
        <Stat label="Working sets" value={String(workingSets)} unit="" />
        <Stat label="Felt RPE" value={rpe.felt != null ? rpe.felt.toFixed(1) : '—'} unit="" />
        <Stat label="Duration" value={dur ? fmtClock(dur) : '—'} unit="" />
      </div>

      {rpe.target != null && rpe.felt != null ? (
        <Card className="mt-2">
          <p className="text-4 text-muted">
            You rated it {rpe.felt.toFixed(1)} against a target of {rpe.target.toFixed(1)} —{' '}
            {Math.abs(rpe.felt - rpe.target) <= 0.25
              ? 'right where it was meant to be.'
              : rpe.felt > rpe.target
                ? 'harder than asked. Tomorrow gets adjusted for that.'
                : 'easier than asked. There is room to add load.'}
          </p>
        </Card>
      ) : null}

      <SectionHead title="Everything logged" />
      <div className="flex flex-col gap-1">
        {s.blocks.map((b, bi) => (
          <Card key={b.id ?? bi}>
            <div className="text-3 font-[750] uppercase tracking-[.12em] text-dim">{b.heading || 'Block'}</div>
            {isCond(b) ? (
              <p className="num mt-0.5 text-4 text-muted">
                {b.condFmt}
                {b.condResult?.dur ? ` · ${fmtClock(b.condResult.dur)}` : ''}
                {b.condResult?.hrr != null ? ` · HRR ${b.condResult.hrr}bpm` : ''}
              </p>
            ) : (
              <ul className="mt-0.5 flex flex-col gap-1">
                {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
                  const done = ex.sets.filter((st) => st.done);
                  if (!done.length) return null;
                  const best = done.reduce<number | null>((m, st) => {
                    if (isWarmup(st)) return m;
                    const e1 = epley(st.aVal, st.aVal2);
                    return e1 != null && (m == null || e1 > m) ? e1 : m;
                  }, null);
                  return (
                    <li key={ex.id ?? ei}>
                      <div className="text-4 font-[650]">{ex.name || 'Exercise'}</div>
                      <div className="num text-3 text-muted">
                        {done
                          .map(
                            (st) =>
                              `${isWarmup(st) ? 'W ' : ''}${st.aVal || '—'}${st.aVal2 ? '×' + st.aVal2 : ''}${st.felt ? '@' + st.felt : ''}`,
                          )
                          .join('  ')}
                        {best != null ? `  ·  best e1RM ${Math.round(best)}kg` : ''}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <Button variant="brass" size="lg" className="mt-3 w-full" onClick={() => nav('/')}>
        Done
      </Button>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <Card className="py-1.5">
      <div className="text-2 font-[750] uppercase tracking-[.14em] text-dim">{label}</div>
      <div className="num mt-0.5 text-8 font-[900] text-text">
        {value}
        {unit ? <span className="ml-0.5 text-4 font-[500] text-dim">{unit}</span> : null}
      </div>
    </Card>
  );
}
