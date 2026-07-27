import { useMemo, useState } from 'react';
import {
  bestE1rmByLift,
  blockExercises,
  byMonth,
  dayLabel,
  epley,
  isCond,
  sessionRpe,
  sessionVolume,
  type LoggedSet,
  type Session,
  type StrengthBlock,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Empty, Kicker, ScreenTitle, SectionHead } from '../ui';

/*
 * History and Progress in one place, because they answer the same question at
 * two zoom levels: what did I do, and is it going anywhere.
 *
 * The 8-week lift delta compares two already-trusted numbers across two
 * windows. No new science and no invented constant — and a lift missing from
 * either window shows no delta rather than a fabricated one. Silent until
 * confident.
 */
export function History() {
  const { sessions } = useDb();
  const [open, setOpen] = useState<string | null>(null);

  const done = useMemo(
    () =>
      sessions
        .filter((s) => s.status !== 'active')
        .slice()
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    [sessions],
  );

  const months = useMemo(() => byMonth(done, (s) => s.date), [done]);

  const deltas = useMemo(() => {
    const now = Date.now();
    const recent = bestE1rmByLift(sessions, now - 8 * 7 * 864e5, now);
    const prior = bestE1rmByLift(sessions, now - 16 * 7 * 864e5, now - 8 * 7 * 864e5);
    return Array.from(recent.values())
      .map((r) => {
        const p = prior.get(r.name.toLowerCase());
        return { name: r.name, e1: r.e1, delta: p ? r.e1 - p.e1 : null };
      })
      .sort((a, b) => b.e1 - a.e1)
      .slice(0, 5);
  }, [sessions]);

  return (
    <>
      <Kicker>History</Kicker>
      <ScreenTitle>What you&apos;ve done</ScreenTitle>

      {deltas.length ? (
        <>
          <SectionHead title="Top lifts · 8-week change" />
          <Card>
            <ul className="flex flex-col gap-1">
              {deltas.map((d) => (
                <li key={d.name} className="flex items-baseline gap-1">
                  <span className="min-w-0 flex-1 truncate text-4 font-[650]">{d.name}</span>
                  <span className="num text-4 text-muted">{Math.round(d.e1)}kg e1RM</span>
                  <span
                    className="num w-8 text-right text-4 font-[750]"
                    style={{
                      color:
                        d.delta == null
                          ? 'var(--color-dim)'
                          : d.delta > 0
                            ? 'var(--color-ok)'
                            : d.delta < 0
                              ? 'var(--color-bad)'
                              : 'var(--color-muted)',
                    }}
                  >
                    {d.delta == null ? '—' : (d.delta > 0 ? '+' : '') + Math.round(d.delta)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 border-t border-line pt-1 text-2 text-dim">
              Against the same lift&apos;s best 8–16 weeks ago. A dash means it wasn&apos;t trained in that window.
            </p>
          </Card>
        </>
      ) : null}

      {/* Grouped by month rather than run as one ribbon. Seventeen identical
          cards each stamped `2026-07-20` is a column of near-identical strings
          that has to be read digit by digit to place; the heading carries the
          month once and each row carries only what tells it apart. */}
      {done.length ? (
        months.map((m) => (
          <div key={m.key}>
            <SectionHead title={m.label} />
            <ul className="flex flex-col gap-0.5">
              {m.items.map((s) => (
                <li key={s.id}>
                  <Card tone="quiet" className="py-1.5">
                    <button
                      className="w-full text-left"
                      onClick={() => setOpen(open === s.id ? null : s.id)}
                      aria-expanded={open === s.id}
                    >
                      <div className="flex items-baseline gap-1">
                        <span className="min-w-0 flex-1 truncate text-5 font-[750]">{s.name || 'Session'}</span>
                        <span className="num shrink-0 text-3 text-dim">{dayLabel(s.date) || s.date}</span>
                      </div>
                      <SessionSummary s={s} />
                    </button>
                    {open === s.id ? <SessionDetail s={s} /> : null}
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <>
          <SectionHead title="Sessions" />
          <Empty title="No finished sessions yet" body="Your first one will show up here the moment you finish it." />
        </>
      )}
    </>
  );
}

function SessionSummary({ s }: { s: Session }) {
  const vol = sessionVolume(s);
  const rpe = sessionRpe(s);
  const cond = s.blocks.filter((b) => isCond(b) && b.condResult).length;
  return (
    <p className="num mt-0.5 text-3 text-muted">
      {vol ? `${vol.toLocaleString()} kg` : null}
      {vol && (rpe.felt != null || cond) ? ' · ' : null}
      {rpe.felt != null ? `felt RPE ${rpe.felt.toFixed(1)}` : null}
      {cond ? `${vol || rpe.felt != null ? ' · ' : ''}${cond} conditioning` : null}
      {s.status === 'incomplete' ? ' · left unfinished' : null}
    </p>
  );
}

function SessionDetail({ s }: { s: Session }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 border-t border-line pt-1.5">
      {s.blocks.map((b, bi) => (
        <div key={b.id ?? bi}>
          <div className="text-3 font-[750] uppercase tracking-[.12em] text-dim">{b.heading || 'Block'}</div>
          {isCond(b) ? (
            <p className="num mt-0.5 text-4 text-muted">
              {b.condFmt}
              {b.condResult?.dur ? ` · ${Math.round(b.condResult.dur / 60)} min` : ''}
              {b.condResult?.felt ? ` · felt RPE ${b.condResult.felt}` : ''}
            </p>
          ) : (
            <ul className="mt-0.5 flex flex-col gap-1">
              {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
                const logged = ex.sets.filter((st) => st.done);
                if (!logged.length) return null;
                const best = logged.reduce<number | null>((m, st) => {
                  const e1 = epley(st.aVal, st.aVal2);
                  return e1 != null && (m == null || e1 > m) ? e1 : m;
                }, null);
                return (
                  <li key={ex.id ?? ei}>
                    <div className="text-4 font-[650]">{ex.name || 'Exercise'}</div>
                    <div className="num text-3 text-muted">
                      {logged
                        .map((st) => `${st.aVal || '—'}${st.aVal2 ? '×' + st.aVal2 : ''}${st.felt ? '@' + st.felt : ''}`)
                        .join('  ')}
                      {best != null ? `  ·  e1RM ${Math.round(best)}kg` : ''}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
