import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
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
import { Btn, Card, Chip, Kicker, Ltr, Screen, Title } from '../ui';
import type { RootStackParams } from '../App';

const FORMATS: CondFmtKey[] = ['steady', 'intervals', 'tempo', 'free'];
const EFFORTS: EffortKey[] = ['easy', 'medium', 'hard'];

/* The athlete's own plan editor — the same shape the coach writes in, because
   both sides share one model. Targets are typed, not chipped: chips cannot
   express "8-12", a ladder, or a warm-up. */
export function PlannerScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'Planner'>>();
  const { db, update } = useDb();
  const [openEx, setOpenEx] = useState<string | null>('0-0');

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
      <TextInput
        value={w.name || ''}
        editable={!readOnly}
        onChangeText={(v) => edit((d) => void (d.name = v))}
        className="text-8 font-black text-text"
      />

      {readOnly ? (
        <Text className="mt-2 rounded-md border border-gold-line bg-gold-wash px-1 py-1 text-3 text-gold2">
          Editing this locally would silently diverge from what your coach still believes they gave you. Ask them to
          change it instead.
        </Text>
      ) : null}

      {w.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mt-2">
          <View className="mb-1 flex-row items-center gap-1">
            <TextInput
              value={b.heading || ''}
              editable={!readOnly}
              onChangeText={(v) => edit((d) => void (d.blocks[bi].heading = v))}
              className="flex-1 text-5 font-bold text-text"
            />
            {!readOnly ? (
              <Pressable onPress={() => edit((d) => void d.blocks.splice(bi, 1))}>
                <Text className="px-1 text-3 text-dim">✕</Text>
              </Pressable>
            ) : null}
          </View>

          {isCond(b) ? (
            <Card>
              <View className="flex-row items-center gap-1">
                <Ltr>♥</Ltr>
                <Text className="flex-1 text-5 font-bold text-text">{b.condFmt}</Text>
              </View>
              <Text className="mt-0.5 text-3 text-dim">
                {condEffort(b).name} · RPE {condEffortRpe(condEffort(b))} · {CON_EFFORTS[condEffort(b).key].cue}
              </Text>
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
                    <Pressable onPress={() => setOpenEx(open ? null : key)}>
                      <View className="flex-row items-center gap-1">
                        <Ltr>{letters[bi]?.[ei] ?? '?'}</Ltr>
                        <View className="flex-1">
                          <Text className="text-5 font-bold text-text" numberOfLines={1}>
                            {ex.name || 'Exercise'}
                          </Text>
                          <Text className="text-3 text-dim" numberOfLines={1}>
                            {rxLine(ex)}
                          </Text>
                        </View>
                        <Text className="text-6 text-dim">{open ? '▴' : '›'}</Text>
                      </View>
                    </Pressable>

                    {open ? (
                      <View className="mt-1.5 border-t border-line pt-1.5">
                        <TextInput
                          value={ex.name}
                          editable={!readOnly}
                          onChangeText={(v) => edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].name = v))}
                          placeholder="Movement"
                          placeholderTextColor="#847d73"
                          className="h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
                        />
                        {ex.sets.map((st, si) => (
                          <View key={si} className="mt-1 flex-row items-center gap-1">
                            <Text className={`w-8 text-3 font-bold ${isWarmup(st) ? 'text-gold2' : 'text-dim'}`}>
                              {isWarmup(st) ? 'Warm' : 'Set ' + (si + 1)}
                            </Text>
                            <TextInput
                              value={st.t}
                              editable={!readOnly}
                              onChangeText={(v) =>
                                edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets[si].t = v))
                              }
                              placeholder="reps"
                              placeholderTextColor="#847d73"
                              className="h-4 w-14 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
                            />
                            <TextInput
                              value={st.rpe}
                              editable={!readOnly}
                              onChangeText={(v) =>
                                edit((d) => void ((d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets[si].rpe = v))
                              }
                              placeholder={isWarmup(st) ? '—' : 'RPE'}
                              placeholderTextColor="#847d73"
                              className="h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
                            />
                            {!readOnly && ex.sets.length > 1 ? (
                              <Pressable
                                onPress={() =>
                                  edit((d) => void (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei].sets.splice(si, 1))
                                }
                              >
                                <Text className="px-1 text-3 text-dim">✕</Text>
                              </Pressable>
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
                        <Text className="mt-1 text-3 text-dim">
                          Type what you want to hit — 8, 8-12, max. Start with W for a warm-up (W or W10).
                        </Text>

                        <View className="mt-1.5 flex-row items-center gap-1">
                          <Text className="text-2 font-bold uppercase tracking-widest text-dim">Rest</Text>
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
                          <Text className="w-10 text-center text-4 font-bold text-text">{fmtRest(ex.rest || 0)}</Text>
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
