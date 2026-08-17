import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  CON_EFFORTS,
  isCond,
  isText,
  newCondBlock,
  newTextBlock,
  type CondFmtKey,
  type EffortKey,
  type TextBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Input, Kicker, Screen, T, Tap, Title } from '../ui';
import type { RootStackParams } from '../App';
import { CondBlockCard } from './planner/CondBlockCard';
import { TextBlockCard } from './planner/TextBlockCard';

/*
 * The athlete's own plan editor.
 *
 * This file is the SHELL: state, the `edit` call, layout. Each block kind
 * draws itself — the cards live in ./planner, one file each, matching the
 * web app's own split.
 *
 * Strength editing — targeted sets, supersets, the movement-suggestion pool
 * (`ExerciseCard`, `SupersetSeam`, `blockExercises`/`duplicateExercise`/
 * `fillLinkedSets`/`newBlock`/`newWarmupBlock`/`newEx`/`newSet`/
 * `knownMovements`) — went whole with the rest of strength on 17 August
 * 2026. What is left edits a CondBlock or a TextBlock. `Block` regained a
 * third shape, `StrengthBlockItem` from `@hybrid/strength-engine`, on the
 * same day Phase A closed — this screen still only renders/edits the other
 * two, so reads of block-specific fields like `heading` are typed loosely
 * (`{ heading?: string }`) rather than narrowed, since nothing here
 * constructs or edits a `StrengthBlockItem` yet.
 */
export function PlannerScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'Planner'>>();
  const { db, update } = useDb();

  // Whole-db by-id lookup on purpose: an editor must never lose its subject
  // to view scoping (a kind change mid-edit, a stale deep link) — see
  // GuidedBuilder's identical rule.
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
              value={(b as { heading?: string }).heading || ''}
              onChangeText={(v) => edit((d) => void ((d.blocks[bi] as { heading?: string }).heading = v))}
              className="flex-1 text-5 text-text"
            />
            <Tap
              onPress={() => edit((d) => void d.blocks.splice(bi, 1))}
              box={{ h: 20, w: 24 }}
              label={`delete block ${(b as { heading?: string }).heading || bi + 1}`}
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
          ) : null}
        </View>
      ))}

      <View className="mt-2 flex-row flex-wrap gap-1">
        {w.kind !== 'conditioning' ? (
          <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newTextBlock()))}>
            ✎ Metcon / notes
          </Btn>
        ) : (
          <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newCondBlock()))}>
            ♥ Conditioning
          </Btn>
        )}
      </View>

      <Btn variant="brass" className="mt-3" onPress={() => nav.goBack()}>
        Done
      </Btn>
    </Screen>
  );
}
