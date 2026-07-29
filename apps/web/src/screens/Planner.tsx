import { useNavigate, useParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  CON_EFFORTS,
  blockExercises,
  duplicateExercise,
  fillLinkedSets,
  isCond,
  isText,
  knownMovements,
  newBlock,
  newCondBlock,
  newWarmupBlock,
  newTextBlock,
  newEx,
  newSet,
  sessionLetters,
  type CondFmtKey,
  type EffortKey,
  type LoggedSet,
  type StrengthBlock,
  type TextBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Button, Card, Kicker, cx } from '../ui';
import { CondBlockCard } from './planner/CondBlockCard';
import { ExerciseCard } from './planner/ExerciseCard';
import { SupersetSeam } from './planner/SupersetSeam';
import { TextBlockCard } from './planner/TextBlockCard';

/*
 * The plan editor — full-screen, and the mirror image of the coach builder.
 *
 * An athlete writing their own session should be doing the same thing a coach
 * does, in the same shape, because the athlete app and the coach app share one
 * model. Targets are typed rather than chipped for the same reason as on the
 * coach side: chips cannot express "8-12", a ladder, or a warm-up.
 *
 * This file is the SHELL: state, the `edit` call, layout, and the datalists
 * every movement field shares. Each block kind draws itself — the cards live
 * in ./planner, one file each, named for what it draws. This file was over
 * 500 lines before that split, which is more than anyone reads before editing.
 */

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
              <TextBlockCard
                body={b.body || ''}
                readOnly={readOnly}
                onChange={(v) => edit((d) => void ((d.blocks[bi] as TextBlock).body = v))}
              />
            ) : isCond(b) ? (
              <CondBlockCard
                b={b}
                readOnly={readOnly}
                onFmt={(f) => edit((d) => void ((d.blocks[bi] as { condFmt: CondFmtKey }).condFmt = f))}
                onEff={(e) =>
                  edit((d) => {
                    const cb = d.blocks[bi] as { effort: EffortKey; targetZone: string };
                    cb.effort = e;
                    // Keep the zone in lockstep — the live engine and every
                    // older read path go through targetZone.
                    cb.targetZone = CON_EFFORTS[e].zone;
                  })
                }
              />
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
                      <ExerciseCard
                        ex={ex}
                        letter={letters[bi]?.[ei] ?? '?'}
                        open={open}
                        readOnly={readOnly}
                        listId={
                          readOnly
                            ? undefined
                            : (b as StrengthBlock<LoggedSet>).warmup
                              ? PREP_LIST_ID
                              : MOVEMENT_LIST_ID
                        }
                        onToggle={() => setOpenEx(open ? null : key)}
                        onNameChange={(v) =>
                          edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].name = v))
                        }
                        onSet={(si, k, v) =>
                          edit((d) => {
                            const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                            e2.sets = fillLinkedSets(e2.sets, si, k, v);
                          })
                        }
                        onAddSet={() =>
                          edit(
                            (d) =>
                              void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets.push(
                                newSet() as LoggedSet,
                              ),
                          )
                        }
                        onDelSet={(si) =>
                          edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets.splice(si, 1))
                        }
                        onRest={(delta) =>
                          edit((d) => {
                            const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                            e2.rest = Math.max(0, Math.min(3600, (e2.rest || 0) + delta));
                          })
                        }
                        onDuplicate={() => {
                          // Open the new copy, not the original left behind —
                          // that is the one about to be edited.
                          setOpenEx(`${bi}-${ei + 1}`);
                          edit(
                            (d) =>
                              void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises = duplicateExercise(
                                (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises,
                                ei,
                              )),
                          );
                        }}
                        onRemove={() =>
                          edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises.splice(ei, 1))
                        }
                      />
                      {!readOnly && next ? (
                        <SupersetSeam
                          on={!!ex.ssNext}
                          exName={ex.name || 'this'}
                          nextName={next.name || 'the next'}
                          onClick={() =>
                            edit((d) => {
                              const t = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                              t.ssNext = !t.ssNext;
                            })
                          }
                        />
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
