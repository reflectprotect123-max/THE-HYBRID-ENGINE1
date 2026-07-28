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
  isWarmup,
  knownMovements,
  newBlock,
  newCondBlock,
  newEx,
  newSet,
  rxLine,
  sessionLetters,
  type CondFmtKey,
  type EffortKey,
  type LoggedSet,
  type StrengthBlock,
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

          {isCond(b) ? (
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
              {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
                const key = `${bi}-${ei}`;
                const open = openEx === key;
                return (
                  <Card key={ex.id ?? ei} className={`mb-1 ${open ? 'border-gold-line' : ''}`}>
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
                            known={known}
                            onPick={(name) =>
                              edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].name = name))
                            }
                          />
                        ) : null}
                        {/* Superset the SAVED session, so a pairing you run every
                            week survives it. The Logger's toggle only ever
                            changed the live session. */}
                        {!readOnly && ei < blockExercises(b as StrengthBlock<LoggedSet>).length - 1 ? (
                          <Tap
                            onPress={() =>
                              edit((d) => {
                                const t = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                                t.ssNext = !t.ssNext;
                              })
                            }
                            role="radio"
                            selected={!!ex.ssNext}
                            label={`superset with ${blockExercises(b as StrengthBlock<LoggedSet>)[ei + 1]?.name || 'the next exercise'}, ${ex.ssNext ? 'on' : 'off'}`}
                            box={{ h: 34 }}
                            className={`mt-1 flex-row items-center gap-1 rounded-md border px-1 py-1 ${
                              ex.ssNext ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel3'
                            }`}
                          >
                            <T className={`text-4 ${ex.ssNext ? 'text-gold2' : 'text-dim'}`}>⇄</T>
                            <T className={`flex-1 text-3 ${ex.ssNext ? 'text-gold2' : 'text-dim'}`} numberOfLines={1}>
                              {ex.ssNext ? 'Supersetted with ' : 'Superset with '}
                              <T w="semi">{blockExercises(b as StrengthBlock<LoggedSet>)[ei + 1]?.name || 'next'}</T>
                              {ex.ssNext ? '' : '?'}
                            </T>
                          </Tap>
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
