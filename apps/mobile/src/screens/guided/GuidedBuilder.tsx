import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  canAdvance,
  nextStep,
  prevStep,
  type BlockKind,
  type FlowDraft,
  type FlowStep,
} from '@hybrid/guided-flow';
import { CON_EFFORTS, knownMovements, newBlock, newCondBlock, newTextBlock, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { Btn, Kicker, Title } from '../../ui';
import type { RootStackParams } from '../../App';
import { BlockTypeStep } from './BlockTypeStep';
import { MovementStep } from './MovementStep';
import { SetsStep } from './SetsStep';
import { RepsStep } from './RepsStep';
import { RpeStep } from './RpeStep';
import { CondDetailStep } from './CondDetailStep';
import { TextStep } from './TextStep';

interface Draft extends FlowDraft {
  blockKind: Exclude<BlockKind, null> | null;
  isWarmupSet: boolean;
  sets: number;
  effort: EffortKey;
  minutes: number;
}

const EMPTY_DRAFT: Draft = {
  blockKind: null,
  isWarmupSet: false,
  movementName: '',
  sets: 3,
  reps: '',
  rpe: '',
  condFmt: '',
  effort: 'medium',
  minutes: 0,
  text: '',
};

const BLOCK_LABEL: Record<Exclude<BlockKind, null>, string> = {
  lift: 'Lift',
  warmup: 'Warm-up / Cooldown',
  cond: 'Conditioning',
  metcon: 'Metcon / notes',
};

export function GuidedBuilderScreen() {
  const { params } = useRoute<RouteProp<RootStackParams, 'GuidedBuilder'>>();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const { db, update } = useDb();
  const known = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);
  const currentWorkout = db.workouts.find((x) => x.id === params.id);
  // Gated on blocks.length, not merely on `kind` being set: sanitizeDB's
  // splitMixedWorkout (packages/engine/src/db.ts) backfills `kind: 'strength'`
  // onto ANY workout with zero conditioning blocks — including a brand-new,
  // still-blockless one — on every full app reload. Trusting `kind` alone here
  // would silently hide Conditioning from a fresh workout's very first
  // question after nothing more than a reload. A workout with no blocks yet
  // has not committed to a kind from this wizard's point of view, whatever
  // sanitizeDB may have guessed.
  const allowedKinds: Exclude<BlockKind, null>[] | undefined = !currentWorkout?.blocks.length
    ? undefined
    : currentWorkout.kind === 'conditioning'
      ? ['cond']
      : currentWorkout.kind === 'strength'
        ? ['lift', 'warmup', 'metcon']
        : undefined;

  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [added, setAdded] = useState<string[]>([]);
  const [phase, setPhase] = useState<'flow' | 'add-another'>('flow');

  const state = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmupSet };

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  /*
   * Dropping the record the Library minted for a flow that authored nothing.
   *
   * "＋ New session" writes the Workout BEFORE this screen opens, so leaving the
   * first question would otherwise strand a permanent, blockless session — which
   * the Library then lists as "conditioning", since it reads any zero-block
   * workout that way. Tombstoned rather than merely spliced out, the same as
   * Library.tsx's own delete: without the tombstone the next sync sees a workout
   * the remote still has and restores it.
   *
   * Guarded twice: an empty `added` means nothing was committed in THIS wizard
   * session, and the blocks check means the stored workout is genuinely empty,
   * so a session that already has work in it can never be caught by this.
   */
  const dropPhantom = useCallback(() => {
    if (added.length) return;
    update((d) => {
      const w = d.workouts.find((x) => x.id === params.id);
      if (!w || w.blocks.length) return false;
      d.workouts = d.workouts.filter((x) => x.id !== params.id);
      d.settings.deletedIds = { ...(d.settings.deletedIds || {}), [params.id]: Date.now() };
    });
  }, [added.length, params.id, update]);

  function commitBlock() {
    const kind = draft.blockKind;
    if (!kind) return;
    let label = '';
    update((d) => {
      const w = d.workouts.find((x) => x.id === params.id);
      if (!w) return false;
      // Same blocks.length gate as `allowedKinds` above: `!w.kind` alone is
      // not a reliable "is this the first block?" check once sanitizeDB has
      // already backfilled a guessed kind onto a zero-block workout.
      if (!w.blocks.length) w.kind = kind === 'cond' ? 'conditioning' : 'strength';
      if (kind === 'lift') {
        const block = newBlock();
        const t = draft.isWarmupSet ? 'W' + draft.reps : draft.reps;
        const rpe = draft.isWarmupSet ? '' : draft.rpe;
        block.exercises[0].name = draft.movementName;
        block.exercises[0].sets = Array.from({ length: draft.sets }, () => ({ t, rpe }));
        w.blocks.push(block);
        label = draft.movementName;
      } else if (kind === 'cond') {
        // @hybrid/engine's flat-exported `newCondBlock` (from session.ts) is
        // zero-argument — the 4-arg version only exists as `emit.newCondBlock`,
        // reachable through the namespaced `emit` export, not this flat import.
        // Build with the zero-arg constructor, then set the fields by hand;
        // CON_EFFORTS[effort].zone reproduces the same zone derivation
        // emit.newCondBlock does internally (confirmed identical mapping:
        // easy→low, medium→mod, hard→high, in both CON_EFFORTS and emit's
        // own EFFORTS table).
        const block = newCondBlock();
        block.condFmt = (draft.condFmt || 'intervals') as CondFmtKey;
        block.effort = draft.effort;
        block.targetZone = CON_EFFORTS[draft.effort].zone;
        block.minutes = draft.minutes || '';
        w.blocks.push(block);
        label = 'Conditioning';
      } else {
        const block = newTextBlock();
        block.heading = BLOCK_LABEL[kind];
        block.body = draft.text;
        w.blocks.push(block);
        label = BLOCK_LABEL[kind];
      }
      w.updatedAt = Date.now();
    });
    setAdded((a) => [...a, label]);
    setPhase('add-another');
  }

  function goNext() {
    const next = nextStep(step, state);
    if (next) {
      setStep(next);
      return;
    }
    commitBlock();
  }

  function goBack() {
    const prev = prevStep(step, state);
    if (prev) {
      setStep(prev);
      return;
    }
    // No earlier step than block-type: this is a cancel, so leave — and take the
    // phantom session with us.
    dropPhantom();
    nav.navigate('Tabs', { screen: 'Library' } as never);
  }

  /*
   * Android's hardware back and the swipe-back gesture both POP this screen,
   * which would drop the whole flow — and the block being authored — from any
   * step. The spec's rule is that back goes to the previous step within the
   * current block and only leaves from the first question, so intercept the
   * native action and step backward instead. `beforeRemove` fires for both the
   * button and the gesture, which is why it is what Conditioning.tsx guards a
   * live run with (apps/mobile/src/screens/Conditioning.tsx:156).
   *
   * Left to proceed on the first question (leaving IS right there, and the
   * phantom is dropped on the way out) and on "add another?", which is not a
   * step and whose blocks are already saved.
   */
  useEffect(() => {
    const unsub = nav.addListener('beforeRemove', (e) => {
      if (phase !== 'flow') return;
      const prev = prevStep(step, state);
      if (!prev) {
        dropPhantom();
        return;
      }
      e.preventDefault();
      setStep(prev);
    });
    return unsub;
  }, [nav, phase, step, draft.blockKind, draft.isWarmupSet, dropPhantom]);

  function pick(kind: Exclude<BlockKind, null>) {
    // A fresh block starts from a clean draft: without this, `isWarmupSet` (and
    // every other answer) leaks out of the previous block into this one.
    setDraft({ ...EMPTY_DRAFT, blockKind: kind });
    setStep(nextStep('block-type', { blockKind: kind, isWarmupSet: false }) ?? 'block-type');
  }

  function renderStep() {
    if (step === 'block-type') return <BlockTypeStep onPick={pick} onBack={goBack} allowed={allowedKinds} />;

    if (step === 'movement') {
      return (
        <MovementStep
          value={draft.movementName}
          known={known}
          onChange={(v) => patch({ movementName: v })}
          onNext={goNext}
          onBack={goBack}
          disabled={!canAdvance('movement', draft)}
        />
      );
    }

    if (step === 'sets') {
      return <SetsStep value={draft.sets} onChange={(n) => patch({ sets: n })} onNext={goNext} onBack={goBack} />;
    }

    if (step === 'reps') {
      return (
        <RepsStep
          value={draft.reps}
          isWarmupSet={draft.isWarmupSet}
          onChange={(v) => patch({ reps: v })}
          onWarmupSetChange={(v) => patch({ isWarmupSet: v })}
          onNext={goNext}
          onBack={goBack}
          disabled={!canAdvance('reps', draft)}
        />
      );
    }

    if (step === 'rpe') {
      return (
        <RpeStep
          value={draft.rpe}
          onChange={(v) => patch({ rpe: v })}
          onNext={goNext}
          onBack={goBack}
          disabled={!canAdvance('rpe', draft)}
        />
      );
    }

    if (step === 'cond-detail') {
      return (
        <CondDetailStep
          condFmt={draft.condFmt as CondFmtKey | ''}
          effort={draft.effort}
          minutes={draft.minutes}
          onChange={(p) => patch(p)}
          onNext={goNext}
          onBack={goBack}
          disabled={!canAdvance('cond-detail', draft)}
        />
      );
    }

    const question = draft.blockKind === 'warmup' ? "What's the warm-up?" : "What's the workout?";
    return (
      <TextStep
        question={question}
        value={draft.text}
        onChange={(v) => patch({ text: v })}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('text', draft)}
      />
    );
  }

  if (phase === 'add-another') {
    // The same centred layout the seven step screens use, rather than <Screen>'s
    // top-aligned ScrollView — one flow should not change shape halfway through.
    return (
      <View className="flex-1 items-center justify-center gap-3 p-4">
        <Kicker>{added.join(', ')} added</Kicker>
        <Title>Add another block?</Title>
        <View className="mt-2 flex-row gap-2">
          <Btn variant="brass" onPress={() => { setDraft(EMPTY_DRAFT); setStep('block-type'); setPhase('flow'); }}>
            Yes, add another
          </Btn>
          <Btn onPress={() => nav.navigate('Planner', { id: params.id })}>No, I&apos;m done</Btn>
        </View>
      </View>
    );
  }

  /*
   * The persistent progress header the spec asks for — "a multi-step flow with
   * no sense of where you are in it is a known, avoidable source of confusion".
   * It wraps the steps rather than being repeated inside all seven of them, and
   * is left off the "add another?" screen above, which already carries its own
   * running summary and would otherwise say where you are twice.
   */
  return (
    <View className="flex-1">
      <View className="px-4" style={{ paddingTop: insets.top + 16 }}>
        <Kicker>{`Session · block ${added.length + 1}`}</Kicker>
      </View>
      {renderStep()}
    </View>
  );
}
