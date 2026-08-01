import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import { Btn, Card, Input, Kicker, Screen, T, Tap, Title } from '../ui';
import type { RootStackParams } from '../App';
import { CondBlockCard } from './planner/CondBlockCard';
import { ExerciseCard } from './planner/ExerciseCard';
import { SupersetSeam } from './planner/SupersetSeam';
import { TextBlockCard } from './planner/TextBlockCard';

/*
 * The athlete's own plan editor. Targets are typed, not chipped: chips cannot
 * express "8-12", a ladder, or a warm-up.
 *
 * This file is the SHELL: state, the `edit` call, layout, and the movement
 * lists every exercise card suggests from. Each block kind draws itself — the
 * cards live in ./planner, one file each, matching the web app's own split.
 * This file was pushing 475 lines doing every block kind's job before that.
 */
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
      <Kicker>Plan editor · saves as you go</Kicker>
      <Input
        w="bold"
        value={w.name || ''}
        onChangeText={(v) => edit((d) => void (d.name = v))}
        className="text-8 text-text"
      />

      {w.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mt-2">
          <View className="mb-1 flex-row items-center gap-1">
            <Input
              w="semi"
              value={b.heading || ''}
              onChangeText={(v) => edit((d) => void (d.blocks[bi].heading = v))}
              className="flex-1 text-5 text-text"
            />
            <Tap
              onPress={() => edit((d) => void d.blocks.splice(bi, 1))}
              box={{ h: 20, w: 24 }}
              label={`delete block ${b.heading || bi + 1}`}
            >
              <T className="px-1 text-3 text-dim">✕</T>
            </Tap>
          </View>

          {isText(b) ? (
            <TextBlockCard
              body={b.body || ''}
              onChange={(v) => edit((d) => void ((d.blocks[bi] as TextBlock).body = v))}
            />
          ) : isCond(b) ? (
            <CondBlockCard
              b={b}
              onFmt={(f) => edit((d) => void ((d.blocks[bi] as { condFmt: CondFmtKey }).condFmt = f))}
              onEff={(e) =>
                edit((d) => {
                  const cb = d.blocks[bi] as { effort: EffortKey; targetZone: string };
                  cb.effort = e;
                  // Keep the zone in lockstep — the live engine reads targetZone.
                  cb.targetZone = CON_EFFORTS[e].zone;
                })
              }
            />
          ) : (
            <>
              {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei, exs) => {
                const key = `${bi}-${ei}`;
                const open = openEx === key;
                const next = exs[ei + 1];
                return (
                  <View key={ex.id ?? ei}>
                    <ExerciseCard
                      ex={ex}
                      letter={letters[bi]?.[ei] ?? '?'}
                      open={open}
                      suggestPool={(b as StrengthBlock<LoggedSet>).warmup ? prepFirst : known}
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
                    {next ? (
                      <SupersetSeam
                        on={!!ex.ssNext}
                        exName={ex.name || 'this'}
                        nextName={next.name || 'the next'}
                        onPress={() =>
                          edit((d) => {
                            const t = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                            t.ssNext = !t.ssNext;
                          })
                        }
                      />
                    ) : null}
                  </View>
                );
              })}

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
            </>
          )}
        </View>
      ))}

      <View className="mt-2 flex-row flex-wrap gap-1">
        <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newBlock() as never))}>
          ＋ Block
        </Btn>
        <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newWarmupBlock() as never))}>
          ☀ Warm-up / Cooldown
        </Btn>
        <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newCondBlock()))}>
          ♥ Conditioning
        </Btn>
        <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newTextBlock()))}>
          ✎ Metcon / notes
        </Btn>
      </View>

      <Btn variant="brass" className="mt-3" onPress={() => nav.goBack()}>
        Done
      </Btn>
    </Screen>
  );
}
