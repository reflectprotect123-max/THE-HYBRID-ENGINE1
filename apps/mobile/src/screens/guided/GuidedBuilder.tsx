import { useMemo, useState } from 'react';
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
import { Btn, Kicker, Screen } from '../../ui';
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
  const { db, update } = useDb();
  const known = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);

  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [added, setAdded] = useState<string[]>([]);
  const [phase, setPhase] = useState<'flow' | 'add-another'>('flow');

  const state = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmupSet };

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commitBlock() {
    const kind = draft.blockKind;
    if (!kind) return;
    let label = '';
    update((d) => {
      const w = d.workouts.find((x) => x.id === params.id);
      if (!w) return false;
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
    nav.navigate('Tabs', { screen: 'Library' } as never);
  }

  function pick(kind: Exclude<BlockKind, null>) {
    patch({ blockKind: kind });
    setStep(nextStep('block-type', { blockKind: kind, isWarmupSet: false }) ?? 'block-type');
  }

  if (phase === 'add-another') {
    return (
      <Screen>
        <Kicker>{added.join(', ')} added</Kicker>
        <Btn variant="brass" onPress={() => { setDraft(EMPTY_DRAFT); setStep('block-type'); setPhase('flow'); }}>
          Yes, add another
        </Btn>
        <Btn onPress={() => nav.navigate('Planner', { id: params.id })}>No, I&apos;m done</Btn>
      </Screen>
    );
  }

  if (step === 'block-type') return <BlockTypeStep onPick={pick} />;

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
