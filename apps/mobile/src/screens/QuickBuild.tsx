import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { blockExercises, rxLine, uid, type Exercise, type LoggedSet, type PlannedSet, type StrengthBlock, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Card, Empty, Input, Kicker, Screen, T, Title } from '../ui';
import type { RootStackParams } from '../App';

/*
 * The guided front door to building a session — three steps instead of one
 * screen with everything on it. It exists alongside the full Planner, not
 * instead of it: Library seeds a workout and sends you here first, and this
 * screen's own summary step hands off into Planner for anyone who wants
 * supersets, conditioning blocks, or per-set control.
 *
 * The one real simplification versus Planner: a single target + RPE typed
 * once here is applied to every set of the exercise, rather than editing each
 * set's row individually. What that produces is an ordinary PlannedSet[] —
 * the same shape newSet() makes — so Planner can fine-tune any of it
 * afterward with zero special-casing.
 *
 * Every edit goes through update(), same as Library and Planner, which
 * persists synchronously. So the workout on disk is always current through
 * the last completed step; only a half-typed, not-yet-added exercise is ever
 * at risk if the app is backgrounded mid-flow.
 */

type Step = 'name' | 'exercise' | 'summary';

interface Draft {
  name: string;
  setCount: number;
  target: string;
  rpe: string;
}

const BLANK_DRAFT: Draft = { name: '', setCount: 3, target: '', rpe: '' };

function makeSets(n: number, t: string, rpe: string): PlannedSet[] {
  return Array.from({ length: Math.max(1, n) }, () => ({ t, rpe }));
}

export function QuickBuildScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'QuickBuild'>>();
  const { db, update } = useDb();
  const [step, setStep] = useState<Step>('name');
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);

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

  const commitExercise = () => {
    edit((d) => {
      const block = d.blocks[0] as StrengthBlock<LoggedSet>;
      block.exercises.push({
        id: uid(),
        name: draft.name.trim() || 'Exercise',
        mode: 'reps_kg',
        tempo: '',
        rest: 90,
        sets: makeSets(draft.setCount, draft.target, draft.rpe) as LoggedSet[],
      });
    });
    setDraft(BLANK_DRAFT);
  };

  const exercises = blockExercises(w.blocks[0] as StrengthBlock<LoggedSet>);

  return (
    <Screen>
      {step === 'name' ? (
        <NameStep
          name={w.name || ''}
          onChangeName={(v) => edit((d) => void (d.name = v))}
          onNext={() => setStep('exercise')}
        />
      ) : step === 'exercise' ? (
        <ExerciseStep
          draft={draft}
          setDraft={setDraft}
          addedCount={exercises.length}
          onAdd={commitExercise}
          onDone={() => setStep('summary')}
        />
      ) : (
        <SummaryStep
          exercises={exercises}
          onEditFurther={() => nav.replace('Planner', { id: w.id })}
          onFinish={() => nav.goBack()}
        />
      )}
    </Screen>
  );
}

function NameStep({
  name,
  onChangeName,
  onNext,
}: {
  name: string;
  onChangeName: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <View>
      <Kicker>Quick build · step 1 of 3</Kicker>
      <Title>Name it</Title>
      <T className="mt-1 text-4 text-muted">Keep the default and move on, or call it whatever helps you find it later.</T>
      <Input
        w="bold"
        value={name}
        onChangeText={onChangeName}
        placeholder="New session"
        className="mt-2 h-6 rounded-md border border-line bg-well px-1.5 text-7 text-text"
      />
      <Btn variant="brass" size="lg" className="mt-3" onPress={onNext}>
        Next →
      </Btn>
    </View>
  );
}

function ExerciseStep({
  draft,
  setDraft,
  addedCount,
  onAdd,
  onDone,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  addedCount: number;
  onAdd: () => void;
  onDone: () => void;
}) {
  const step = (delta: number) => setDraft({ ...draft, setCount: Math.max(1, Math.min(12, draft.setCount + delta)) });

  return (
    <View>
      <Kicker>Quick build · step 2 of 3</Kicker>
      <Title>Add exercises</Title>
      {addedCount ? (
        <T num className="mt-0.5 text-3 text-dim">
          {addedCount} added so far
        </T>
      ) : null}

      <Card className="mt-2">
        <Input
          value={draft.name}
          onChangeText={(v) => setDraft({ ...draft, name: v })}
          placeholder="Movement"
          className="h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
        />

        <View className="mt-1.5 flex-row items-center gap-1">
          <T w="semi" className="text-2 uppercase tracking-widest text-dim">
            Sets
          </T>
          <Pressable onPress={() => step(-1)} className="rounded-md border border-line2 bg-panel2 px-1.5 py-0.5">
            <T w="med">−</T>
          </Pressable>
          <T w="semi" num className="w-6 text-center text-4 text-text">
            {draft.setCount}
          </T>
          <Pressable onPress={() => step(1)} className="rounded-md border border-line2 bg-panel2 px-1.5 py-0.5">
            <T w="med">+</T>
          </Pressable>
        </View>

        <View className="mt-1.5 flex-row gap-1">
          <Input
            num
            value={draft.target}
            onChangeText={(v) => setDraft({ ...draft, target: v })}
            placeholder="reps — 5, 8-12, max, W10"
            className="h-4 flex-1 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
          />
          <Input
            num
            value={draft.rpe}
            onChangeText={(v) => setDraft({ ...draft, rpe: v })}
            placeholder="RPE"
            className="h-4 w-14 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
          />
        </View>
        <T className="mt-1 text-3 text-dim">
          Type what you want to hit — 8, 8-12, max. Start with W for a warm-up (W or W10). Applied to all {draft.setCount}{' '}
          sets — fine-tune each one individually later in the full editor.
        </T>

        <Btn variant="brass" className="mt-1.5" onPress={onAdd}>
          ＋ Add exercise
        </Btn>
      </Card>

      <Btn size="lg" className="mt-2" onPress={onDone}>
        Done adding exercises
      </Btn>
    </View>
  );
}

function SummaryStep({
  exercises,
  onEditFurther,
  onFinish,
}: {
  exercises: Exercise<LoggedSet>[];
  onEditFurther: () => void;
  onFinish: () => void;
}) {
  return (
    <View>
      <Kicker>Quick build · step 3 of 3</Kicker>
      <Title>Ready</Title>

      {exercises.length ? (
        exercises.map((ex, ei) => (
          <Card key={ex.id ?? ei} className="mt-1.5">
            <T w="semi" className="text-5 text-text">
              {ex.name || 'Exercise'}
            </T>
            <T num className="mt-0.5 text-3 text-dim">
              {rxLine(ex)}
            </T>
          </Card>
        ))
      ) : (
        <Empty title="No exercises yet" body="Add at least one, or fine-tune in the full editor." />
      )}

      <Btn className="mt-3" onPress={onEditFurther}>
        Fine-tune in the full editor
      </Btn>
      <Btn variant="brass" size="lg" className="mt-1.5" onPress={onFinish}>
        Save & finish
      </Btn>
    </View>
  );
}
