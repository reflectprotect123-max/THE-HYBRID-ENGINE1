import { useNavigate, useParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  CON_EFFORTS,
  blockExercises,
  condEffort,
  condEffortRpe,
  fmtRest,
  isCond,
  isText,
  isWarmup,
  knownMovements,
  newBlock,
  newCondBlock,
  newWarmupBlock,
  newTextBlock,
  newEx,
  newSet,
  rxLine,
  sessionLetters,
  type CondFmtKey,
  type EffortKey,
  type LoggedSet,
  type StrengthBlock,
  type TextBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Button, Card, Chip, Kicker, LetterChip, cx } from '../ui';

/*
 * The plan editor — full-screen, and the mirror image of the coach builder.
 *
 * An athlete writing their own session should be doing the same thing a coach
 * does, in the same shape, because the athlete app and the coach app share one
 * model. Targets are typed rather than chipped for the same reason as on the
 * coach side: chips cannot express "8-12", a ladder, or a warm-up.
 */
const FORMATS: CondFmtKey[] = ['steady', 'intervals', 'tempo', 'free'];
const EFFORTS: EffortKey[] = ['easy', 'medium', 'hard'];

/** Every movement field points at the same list; see the datalist below. */
const MOVEMENT_LIST_ID = 'known-movements';
const PREP_LIST_ID = 'prep-movements';

export function Planner() {
  const { id } = useParams();
  const nav = useNavigate();
  const { db, update } = useDb();
  const [openEx, setOpenEx] = useState<string | null>('0-0');

  /* Above the early return, not below it: a hook that only runs when the
     workout exists changes the hook COUNT between renders, which typecheck
     cannot see and React crashes on. */
  const known = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);
  /* In a warm-up/cooldown block the prep movements come first — that is what
     you are reaching for there, and it is what finally makes the 200-strong
     Mobility list something you use rather than a page you read. Logged
     movements stay available underneath, because an empty-bar bench is a
     legitimate warm-up. */
  const mobility = useMemo(
    () => (Array.isArray(db.settings.mobility) ? db.settings.mobility : []),
    [db.settings.mobility],
  );
  const prepFirst = useMemo(() => {
    const seen = new Set(mobility.map((m) => m.toLowerCase()));
    return [...mobility, ...known.filter((k) => !seen.has(k.toLowerCase()))];
  }, [mobility, known]);

  const w = db.workouts.find((x) => x.id === id);

  if (!w) {
    return (
      <div className="grid min-h-full place-items-center p-3">
        <Card className="text-center">
          <p className="text-6 font-[750]">That session is gone</p>
          <Button className="mt-2" variant="brass" onClick={() => nav('/library')}>
            Back to Library
          </Button>
        </Card>
      </div>
    );
  }

  const readOnly = w.origin === 'coach';
  const letters = sessionLetters({ id: w.id, date: '', status: 'completed', blocks: w.blocks });

  // Typed as Workout, not `typeof w`: `typeof` reads the DECLARED type, which
  // still includes the undefined that the early return above has ruled out.
  const edit = (fn: (draft: Workout) => void) =>
    update((draft) => {
      const t = draft.workouts.find((x) => x.id === w.id);
      if (!t) return false;
      fn(t);
      t.updatedAt = Date.now();
    });

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-2 pt-2 pb-3">
      {/*
       * Movements already written, offered back to every name field.
       *
       * ONE datalist for the whole screen rather than one per input: the list
       * is identical everywhere, and `list=` is a reference, so N copies would
       * be N identical option sets in the DOM for no benefit.
       *
       * Not a catalogue — the sessions ARE the catalogue, derived on read by
       * `knownMovements`. The point is that "Squat" and "Back Squat" are two
       * different lifts to the history, the PR detector and the earned working
       * weight, so the cheapest fix is to make retyping unnecessary.
       */}
      {!readOnly && known.length ? (
        <datalist id={MOVEMENT_LIST_ID}>
          {known.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}
      {!readOnly && prepFirst.length ? (
        <datalist id={PREP_LIST_ID}>
          {prepFirst.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}

      <header className="flex items-start gap-1">
        <button
          onClick={() => nav('/library')}
          aria-label="back to library"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line2 bg-panel2 text-6 text-muted hover:text-text"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <Kicker>{readOnly ? 'From your coach · read-only' : 'Plan editor · saves as you go'}</Kicker>
          <input
            value={w.name || ''}
            readOnly={readOnly}
            onChange={(e) => edit((d) => void (d.name = e.target.value))}
            aria-label="session name"
            className="w-full rounded-md border border-transparent bg-transparent text-7 font-[800] outline-none hover:border-line focus:border-gold-line read-only:hover:border-transparent"
          />
        </div>
      </header>

      {readOnly ? (
        <p className="mt-2 rounded-md border border-gold-line bg-gold-wash px-1 py-1 text-3 text-gold2">
          Editing this locally would silently diverge from what your coach still believes they gave you. Ask them to
          change it instead.
        </p>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        {w.blocks.map((b, bi) => (
          <section key={b.id ?? bi}>
            <div className="mb-1 flex items-center gap-1">
              <input
                value={b.heading || ''}
                readOnly={readOnly}
                onChange={(e) => edit((d) => void (d.blocks[bi].heading = e.target.value))}
                aria-label="block name"
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-0.5 text-5 font-[750] outline-none hover:border-line focus:border-gold-line"
              />
              {!readOnly ? (
                <button
                  onClick={() => edit((d) => void d.blocks.splice(bi, 1))}
                  aria-label="remove block"
                  className="h-4 rounded-md border border-line2 px-1 text-3 text-dim hover:text-bad"
                >
                  ✕
                </button>
              ) : null}
            </div>

            {isText(b) ? (
              /* Just words. A metcon is one prescription that does not
                 decompose into sets without inventing structure, so the app
                 stores what you wrote and nothing else. The heading above is
                 already editable, which is where "Metcon" gets renamed. */
              <Card>
                <textarea
                  value={b.body || ''}
                  readOnly={readOnly}
                  onChange={(e) =>
                    edit((d) => void ((d.blocks[bi] as TextBlock).body = e.target.value))
                  }
                  rows={5}
                  placeholder={'AMRAP 12\n10 burpees\n15 KB swings\n200m run'}
                  aria-label="what the block is"
                  className="w-full resize-y rounded-md border border-line bg-well px-1 py-1 text-4 leading-relaxed text-text outline-none placeholder:text-dim focus:border-gold-line"
                />
                <p className="mt-0.5 text-2 text-dim">
                  Counts as trained when you tick it. No tonnage, no e1RM — there is nothing here to measure.
                </p>
              </Card>
            ) : isCond(b) ? (
              <Card>
                <div className="flex items-center gap-1">
                  <LetterChip letter="♥" />
                  <span className="flex-1 text-5 font-[750]">{b.condFmt}</span>
                </div>
                <p className="mt-0.5 text-3 text-dim">
                  {condEffort(b).name} · RPE {condEffortRpe(condEffort(b))} · {CON_EFFORTS[condEffort(b).key].cue}
                </p>
                {!readOnly ? (
                  <>
                    <div className="mt-1.5 flex flex-wrap gap-0.5">
                      {FORMATS.map((f) => (
                        <Chip
                          key={f}
                          on={b.condFmt === f}
                          onClick={() => edit((d) => void ((d.blocks[bi] as { condFmt: CondFmtKey }).condFmt = f))}
                        >
                          {f}
                        </Chip>
                      ))}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {EFFORTS.map((e) => (
                        <Chip
                          key={e}
                          on={b.effort === e}
                          onClick={() =>
                            edit((d) => {
                              const cb = d.blocks[bi] as { effort: EffortKey; targetZone: string };
                              cb.effort = e;
                              // Keep the zone in lockstep — the live engine and
                              // every older read path go through targetZone.
                              cb.targetZone = CON_EFFORTS[e].zone;
                            })
                          }
                        >
                          {CON_EFFORTS[e].name}
                        </Chip>
                      ))}
                    </div>
                  </>
                ) : null}
              </Card>
            ) : (
              <div
                className={cx(
                  (b as StrengthBlock<LoggedSet>).superset && 'rounded-lg border border-gold-line/40 bg-gold-wash/40 p-1',
                  (b as StrengthBlock<LoggedSet>).warmup && 'rounded-lg border border-dashed border-line2 p-1',
                )}
              >
                {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei, exs) => {
                  const key = `${bi}-${ei}`;
                  const open = openEx === key;
                  const next = exs[ei + 1];
                  return (
                    <div key={ex.id ?? ei} className="mb-1">
                      <Card className={open ? 'border-gold-line shadow-lift' : undefined}>
                        <button className="flex w-full items-center gap-1 text-left" onClick={() => setOpenEx(open ? null : key)}>
                          <LetterChip letter={letters[bi]?.[ei] ?? '?'} />
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-5 font-[750]">{ex.name || 'Exercise'}</b>
                            <span className="num block truncate text-3 text-dim">{rxLine(ex)}</span>
                          </span>
                          <span className="text-6 text-dim">{open ? '▴' : '›'}</span>
                        </button>

                        {open ? (
                          <div className="mt-1.5 border-t border-line pt-1.5">
                            {/* A native datalist: no dependency, no popup to
                                position, and no inline script — which matters,
                                because the deployed CSP is script-src self and
                                `check:csp` fails the build on inline script. */}
                            <input
                              value={ex.name}
                              readOnly={readOnly}
                              list={readOnly ? undefined : (b as StrengthBlock<LoggedSet>).warmup ? PREP_LIST_ID : MOVEMENT_LIST_ID}
                              onChange={(e) =>
                                edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].name = e.target.value))
                              }
                              placeholder="Movement"
                              aria-label="movement name"
                              className="h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
                            />

                            <div className="mt-1.5 flex flex-col gap-1">
                              {ex.sets.map((st, si) => (
                                <div key={si} className="flex items-center gap-1">
                                  <span className={cx('num w-8 shrink-0 text-3 font-[650]', isWarmup(st) ? 'text-gold2' : 'text-dim')}>
                                    {isWarmup(st) ? 'Warm' : 'Set ' + (si + 1)}
                                  </span>
                                  <input
                                    value={st.t}
                                    readOnly={readOnly}
                                    onChange={(e) =>
                                      edit(
                                        (d) =>
                                          void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets[si].t =
                                            e.target.value),
                                      )
                                    }
                                    placeholder="reps"
                                    aria-label={`target for set ${si + 1}`}
                                    className="num h-4 w-14 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                                  />
                                  <input
                                    value={st.rpe}
                                    readOnly={readOnly}
                                    onChange={(e) =>
                                      edit(
                                        (d) =>
                                          void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets[si].rpe =
                                            e.target.value),
                                      )
                                    }
                                    placeholder={isWarmup(st) ? '—' : 'RPE'}
                                    aria-label={`target RPE for set ${si + 1}`}
                                    className="num h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                                  />
                                  {!readOnly && ex.sets.length > 1 ? (
                                    <button
                                      onClick={() =>
                                        edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets.splice(si, 1))
                                      }
                                      aria-label={`remove set ${si + 1}`}
                                      className="h-4 w-4 text-3 text-dim hover:text-bad"
                                    >
                                      ✕
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                              {!readOnly ? (
                                <button
                                  onClick={() =>
                                    edit((d) =>
                                      void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets.push(newSet() as LoggedSet),
                                    )
                                  }
                                  className="h-4 w-fit rounded-md border border-dashed border-line2 px-1 text-3 text-muted hover:border-gold-line hover:text-gold2"
                                >
                                  ＋ Add set
                                </button>
                              ) : null}
                              <p className="max-w-[46ch] text-3 text-dim">
                                Type what you want to hit — <b className="text-muted">8</b>,{' '}
                                <b className="text-muted">8-12</b>, <b className="text-muted">max</b>. Start with{' '}
                                <b className="text-muted">W</b> for a warm-up (<b className="text-muted">W</b> or{' '}
                                <b className="text-muted">W10</b>).
                              </p>
                            </div>

                            <div className="mt-1.5 flex items-center gap-1">
                              <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Rest</span>
                              {!readOnly ? (
                                <button
                                  onClick={() =>
                                    edit((d) => {
                                      const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                                      e2.rest = Math.max(0, (e2.rest || 0) - 15);
                                    })
                                  }
                                  className="h-4 w-4 rounded-md border border-line2 bg-panel2 text-5 text-muted"
                                >
                                  −
                                </button>
                              ) : null}
                              <span className="num w-10 text-center text-4 font-[750]">{fmtRest(ex.rest || 0)}</span>
                              {!readOnly ? (
                                <button
                                  onClick={() =>
                                    edit((d) => {
                                      const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                                      e2.rest = Math.min(3600, (e2.rest || 0) + 15);
                                    })
                                  }
                                  className="h-4 w-4 rounded-md border border-line2 bg-panel2 text-5 text-muted"
                                >
                                  +
                                </button>
                              ) : null}
                              {!readOnly ? (
                                <button
                                  onClick={() =>
                                    edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises.splice(ei, 1))
                                  }
                                  className="ml-auto h-4 rounded-md border border-line2 px-1 text-3 text-dim hover:text-bad"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </Card>
                      {/* The chain BETWEEN two movements, not a row inside one:
                          a superset is a relationship, and drawing it as a
                          property of the first exercise never said which two.
                          Dashed and quiet when they are separate, solid brass
                          when they flow on — the coach builder's Seam, same
                          gesture on the athlete side. */}
                      {!readOnly && next ? (
                        <div className="relative flex items-center justify-center py-0.5">
                          <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line2" />
                          <button
                            onClick={() =>
                              edit((d) => {
                                const t = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                                t.ssNext = !t.ssNext;
                              })
                            }
                            role="switch"
                            aria-checked={!!ex.ssNext}
                            aria-label={
                              ex.ssNext
                                ? `Split the superset between ${ex.name || 'this'} and ${next.name || 'the next'}`
                                : `Superset ${ex.name || 'this'} with ${next.name || 'the next'}`
                            }
                            title={ex.ssNext ? 'split them apart' : 'chain into a superset'}
                            className={cx(
                              'relative grid h-3 w-6 place-items-center rounded-pill border transition-colors duration-150',
                              ex.ssNext
                                ? 'border-gold text-[#1b1509] [background:var(--brass)]'
                                : 'border-dashed border-line2 bg-panel2 text-muted hover:border-gold-line hover:text-gold2',
                            )}
                          >
                            <ChainIcon />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {!readOnly ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises.push(newEx() as never))}
                    >
                      ＋ Exercise
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        edit((d) => {
                          const sb = d.blocks[bi] as StrengthBlock<LoggedSet>;
                          sb.superset = !sb.superset;
                        })
                      }
                    >
                      {(b as StrengthBlock<LoggedSet>).superset ? 'Split superset' : 'Make superset'}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        ))}
      </div>

      {!readOnly ? (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button onClick={() => edit((d) => void d.blocks.push(newBlock() as never))}>＋ Block</Button>
          <Button onClick={() => edit((d) => void d.blocks.push(newWarmupBlock() as never))}>
            ☀ Warm-up / Cooldown
          </Button>
          <Button onClick={() => edit((d) => void d.blocks.push(newCondBlock()))}>♥ Conditioning</Button>
          <Button onClick={() => edit((d) => void d.blocks.push(newTextBlock()))}>✎ Metcon / notes</Button>
        </div>
      ) : null}

      <Button variant="brass" size="lg" className="mt-3 w-full" onClick={() => nav('/library')}>
        Done
      </Button>
    </div>
  );
}

/** Two interlocking links — the same gesture the coach builder uses for a chain. */
function ChainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M9.5 12h5" />
      <path d="M10 8.5H8a3.5 3.5 0 0 0 0 7h2" />
      <path d="M14 8.5h2a3.5 3.5 0 0 1 0 7h-2" />
    </svg>
  );
}
