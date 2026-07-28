import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import { Btn, Card, Chip, Input, Kicker, Ltr, Screen, T, Tap, Title } from '../ui';
import type { RootStackParams } from '../App';

const FORMATS: CondFmtKey[] = ['steady', 'intervals', 'tempo', 'free'];
const EFFORTS: EffortKey[] = ['easy', 'medium', 'hard'];

/** How many name suggestions fit under the field without pushing the sets off. */
const MAX_SUGGEST = 6;

/*
 * Movements you have already written, offered back.
 *
 * Not a catalogue — the sessions ARE the catalogue, and `knownMovements`
 * derives this on read. The point is that "Squat" and "Back Squat" are two
 * different lifts to the history, the PR detector and the earned working
 * weight, so the cheapest way to stop a lift fragmenting is to make retyping
 * it unnecessary.
 *
 * Hidden once what you have typed already matches something exactly — at that
 * point the row is only telling you what is already in the box.
 */
function Suggest({ typed, known, onPick }: { typed: string; known: string[]; onPick: (name: string) => void }) {
  const q = String(typed || '').trim().toLowerCase();
  const hits = known.filter((n) => n.toLowerCase() !== q && (!q || n.toLowerCase().includes(q))).slice(0, MAX_SUGGEST);
  if (!hits.length) return null;

  return (
    <View className="mt-0.5 flex-row flex-wrap gap-0.5">
      {hits.map((n) => (
        <Chip key={n} onPress={() => onPick(n)}>
          {n}
        </Chip>
      ))}
    </View>
  );
}

/* The athlete's own plan editor — the same shape the coach writes in, because
   both sides share one model. Targets are typed, not chipped: chips cannot
   express "8-12", a ladder, or a warm-up. */
export function PlannerScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'Planner'>>();
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

  const w = db.workouts.find((x) => x.id === route.params.id);
  if (!w) {
    return (
      <Screen>
        <Title>That session is gone</Title>
        <Btn variant="brass" className="mt-2" onPress={() => nav.goBack()}>
          Back
        </Btn>
      </Screen>
    );
  }

  const readOnly = w.origin === 'coach';
  const letters = sessionLetters({ id: w.id, date: '', status: 'completed', blocks: w.blocks });

  const edit = (fn: (draft: Workout) => void) =>
    update((d) => {
      const t = d.workouts.find((x) => x.id === w.id);
      if (!t) return false;
      fn(t);
      t.updatedAt = Date.now();
    });

  return (
    <Screen>
      <Kicker>{readOnly ? 'From your coach · read-only' : 'Plan editor · saves as you go'}</Kicker>
      <Input
        w="bold"
        value={w.name || ''}
        editable={!readOnly}
        onChangeText={(v) => edit((d) => void (d.name = v))}
        className="text-8 text-text"
      />

      {readOnly ? (
        <T className="mt-2 rounded-md border border-gold-line bg-gold-wash px-1 py-1 text-3 text-gold2">
          Editing this locally would silently diverge from what your coach still believes they gave you. Ask them to
          change it instead.
        </T>
      ) : null}

      {w.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mt-2">
          <View className="mb-1 flex-row items-center gap-1">
            <Input
              w="semi"
              value={b.heading || ''}
              editable={!readOnly}
              onChangeText={(v) => edit((d) => void (d.blocks[bi].heading = v))}
              className="flex-1 text-5 text-text"
            />
            {!readOnly ? (
              <Tap
                onPress={() => edit((d) => void d.blocks.splice(bi, 1))}
                box={{ h: 20, w: 24 }}
                label={`delete block ${b.heading || bi + 1}`}
              >
                <T className="px-1 text-3 text-dim">✕</T>
              </Tap>
            ) : null}
          </View>

          {isText(b) ? (
            /* Just words — see the web Planner for why a metcon is not sets. */
            <Card>
              <Input
                value={b.body || ''}
                editable={!readOnly}
                multiline
                numberOfLines={5}
                onChangeText={(v) => edit((d) => void ((d.blocks[bi] as TextBlock).body = v))}
                placeholder={'AMRAP 12\n10 burpees\n15 KB swings\n200m run'}
                accessibilityLabel="what the block is"
                className="min-h-[96px] rounded-md border border-line bg-well px-1 py-1 text-4 text-text"
                style={{ textAlignVertical: 'top' }}
              />
              <T className="mt-0.5 text-2 text-dim">
                Counts as trained when you tick it. No tonnage, no e1RM — there is nothing here to measure.
              </T>
            </Card>
          ) : isCond(b) ? (
            <Card>
              <View className="flex-row items-center gap-1">
                <Ltr>♥</Ltr>
                <T w="semi" className="flex-1 text-5 text-text">{b.condFmt}</T>
              </View>
              <T num className="mt-0.5 text-3 text-dim">
                {condEffort(b).name} · RPE {condEffortRpe(condEffort(b))} · {CON_EFFORTS[condEffort(b).key].cue}
              </T>
              {!readOnly ? (
                <>
                  <View className="mt-1.5 flex-row flex-wrap gap-0.5">
                    {FORMATS.map((f) => (
                      <Chip key={f} on={b.condFmt === f} onPress={() => edit((d) => void ((d.blocks[bi] as { condFmt: CondFmtKey }).condFmt = f))}>
                        {f}
                      </Chip>
                    ))}
                  </View>
                  <View className="mt-1 flex-row flex-wrap gap-0.5">
                    {EFFORTS.map((e) => (
                      <Chip
                        key={e}
                        on={b.effort === e}
                        onPress={() =>
                          edit((d) => {
                            const cb = d.blocks[bi] as { effort: EffortKey; targetZone: string };
                            cb.effort = e;
                            // Keep the zone in lockstep — the live engine reads targetZone.
                            cb.targetZone = CON_EFFORTS[e].zone;
                          })
                        }
                      >
                        {CON_EFFORTS[e].name}
                      </Chip>
                    ))}
                  </View>
                </>
              ) : null}
            </Card>
          ) : (
            <>
              {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei, exs) => {
                const key = `${bi}-${ei}`;
                const open = openEx === key;
                const next = exs[ei + 1];
                return (
                  <View key={ex.id ?? ei}>
                  <Card className={`mb-1 ${open ? 'border-gold-line' : ''}`}>
                    <Tap
                      onPress={() => setOpenEx(open ? null : key)}
                      label={`${open ? 'collapse' : 'expand'} ${ex.name || 'exercise'}`}
                    >
                      <View className="flex-row items-center gap-1">
                        <Ltr>{letters[bi]?.[ei] ?? '?'}</Ltr>
                        <View className="flex-1">
                          <T w="semi" className="text-5 text-text" numberOfLines={1}>
                            {ex.name || 'Exercise'}
                          </T>
                          <T num className="text-3 text-dim" numberOfLines={1}>
                            {rxLine(ex)}
                          </T>
                        </View>
                        <T className="text-6 text-dim">{open ? '▴' : '›'}</T>
                      </View>
                    </Tap>

                    {open ? (
                      <View className="mt-1.5 border-t border-line pt-1.5">
                        <Input
                          value={ex.name}
                          editable={!readOnly}
                          onChangeText={(v) => edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].name = v))}
                          placeholder="Movement"
                          className="h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
                        />
                        {!readOnly ? (
                          <Suggest
                            typed={ex.name}
                            known={(b as StrengthBlock<LoggedSet>).warmup ? prepFirst : known}
                            onPick={(name) =>
                              edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].name = name))
                            }
                          />
                        ) : null}
                        {ex.sets.map((st, si) => (
                          <View key={si} className="mt-1 flex-row items-center gap-1">
                            <T w="semi" num className={`w-8 text-3 ${isWarmup(st) ? 'text-gold2' : 'text-dim'}`}>
                              {isWarmup(st) ? 'Warm' : 'Set ' + (si + 1)}
                            </T>
                            <Input
                              num
                              value={st.t}
                              editable={!readOnly}
                              onChangeText={(v) =>
                                edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets[si].t = v))
                              }
                              placeholder="reps"
                              className="h-5 w-14 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
                            />
                            <Input
                              num
                              value={st.rpe}
                              editable={!readOnly}
                              onChangeText={(v) =>
                                edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets[si].rpe = v))
                              }
                              placeholder={isWarmup(st) ? '—' : 'RPE'}
                              className="h-5 w-12 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
                            />
                            {!readOnly && ex.sets.length > 1 ? (
                              <Tap
                                onPress={() =>
                                  edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets.splice(si, 1))
                                }
                                box={{ h: 20, w: 24 }}
                                label={`delete set ${si + 1}`}
                              >
                                <T className="px-1 text-3 text-dim">✕</T>
                              </Tap>
                            ) : null}
                          </View>
                        ))}
                        {!readOnly ? (
                          <Btn
                            className="mt-1 self-start"
                            onPress={() =>
                              edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets.push(newSet() as LoggedSet))
                            }
                          >
                            ＋ Add set
                          </Btn>
                        ) : null}
                        <T className="mt-1 text-3 text-dim">
                          Type what you want to hit — 8, 8-12, max. Start with W for a warm-up (W or W10).
                        </T>

                        <View className="mt-1.5 flex-row items-center gap-1">
                          <T w="semi" className="text-2 uppercase tracking-widest text-dim">Rest</T>
                          {!readOnly ? (
                            <Btn
                              onPress={() =>
                                edit((d) => {
                                  const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                                  e2.rest = Math.max(0, (e2.rest || 0) - 15);
                                })
                              }
                            >
                              −
                            </Btn>
                          ) : null}
                          <T w="semi" num className="w-10 text-center text-4 text-text">{fmtRest(ex.rest || 0)}</T>
                          {!readOnly ? (
                            <Btn
                              onPress={() =>
                                edit((d) => {
                                  const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                                  e2.rest = Math.min(3600, (e2.rest || 0) + 15);
                                })
                              }
                            >
                              +
                            </Btn>
                          ) : null}
                          {/* An exercise added by mistake was permanent: the
                              sets could be removed one by one, and the block
                              deleted whole, but never the movement itself. */}
                          {!readOnly ? (
                            <>
                              <View className="flex-1" />
                              <Tap
                                label={`remove ${ex.name || 'exercise'}`}
                                onPress={() => {
                                  setOpenEx(null);
                                  edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises.splice(ei, 1));
                                }}
                                box={{ h: 28 }}
                                className="rounded-md border border-line2 px-1 py-0.5"
                              >
                                <T className="text-3 text-dim">Remove</T>
                              </Tap>
                            </>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </Card>
                  {/* The chain BETWEEN two movements, not a row inside one:
                      a superset is a relationship, and drawing it as a property
                      of the first exercise never said which two. */}
                  {!readOnly && next ? (
                    <View className="relative items-center justify-center py-0.5">
                      <View className="absolute inset-y-0 w-px bg-line2" />
                      <Tap
                        onPress={() =>
                          edit((d) => {
                            const t = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                            t.ssNext = !t.ssNext;
                          })
                        }
                        role="radio"
                        selected={!!ex.ssNext}
                        label={
                          ex.ssNext
                            ? `Split the superset between ${ex.name || 'this'} and ${next.name || 'the next'}`
                            : `Superset ${ex.name || 'this'} with ${next.name || 'the next'}`
                        }
                        box={{ h: 26, w: 48 }}
                        className={`h-3.5 w-6 flex-row items-center justify-center gap-0.5 rounded-pill border ${
                          ex.ssNext ? 'border-gold bg-gold' : 'border-dashed border-line2 bg-panel2'
                        }`}
                      >
                        {/* Two interlocking links, drawn rather than glyphed:
                            react-native-svg is not a dependency and a chain
                            emoji renders in full colour, off the palette. */}
                        <View className={`h-1.5 w-2 rounded-pill border ${ex.ssNext ? 'border-[#1b1509]' : 'border-muted'}`} />
                        <View className={`-ml-1 h-1.5 w-2 rounded-pill border ${ex.ssNext ? 'border-[#1b1509]' : 'border-muted'}`} />
                      </Tap>
                    </View>
                  ) : null}
                  </View>
                );
              })}

              {!readOnly ? (
                <View className="flex-row gap-1">
                  <Btn
                    className="flex-1"
                    onPress={() => edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises.push(newEx() as never))}
                  >
                    ＋ Exercise
                  </Btn>
                  <Btn
                    className="flex-1"
                    onPress={() =>
                      edit((d) => {
                        const sb = d.blocks[bi] as StrengthBlock<LoggedSet>;
                        sb.superset = !sb.superset;
                      })
                    }
                  >
                    {(b as StrengthBlock<LoggedSet>).superset ? 'Split' : 'Superset'}
                  </Btn>
                </View>
              ) : null}
            </>
          )}
        </View>
      ))}

      {!readOnly ? (
        <View className="mt-2 flex-row gap-1">
          <Btn className="flex-1" onPress={() => edit((d) => void d.blocks.push(newBlock() as never))}>
            ＋ Block
          </Btn>
          <Btn className="flex-1" onPress={() => edit((d) => void d.blocks.push(newWarmupBlock() as never))}>
            ☀ Warm-up
          </Btn>
          <Btn className="flex-1" onPress={() => edit((d) => void d.blocks.push(newTextBlock()))}>
            ✎ Metcon
          </Btn>
          <Btn className="flex-1" onPress={() => edit((d) => void d.blocks.push(newCondBlock()))}>
            ♥ Conditioning
          </Btn>
        </View>
      ) : null}

      <Btn variant="brass" className="mt-3" onPress={() => nav.goBack()}>
        Done
      </Btn>
    </Screen>
  );
}
