import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  canAdvance,
  nextStep,
  prevStep,
  stepsFor,
  type BlockKind,
  type FlowDraft,
  type FlowStep,
} from '@hybrid/guided-flow';
import {
  CON_EFFORTS,
  knownMovements,
  newBlock,
  newCondBlock,
  newTextBlock,
  type CondFmtKey,
  type EffortKey,
} from '@hybrid/engine';
import { useDb } from '../../store/db';
import { Button, Kicker } from '../../ui';
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

/**
 * The guided, one-step-at-a-time session builder. Replaces the old
 * "blank session straight into the Planner" entry point (see Library.tsx's
 * `addWorkout`) with a flow that authors one block at a time, then hands off
 * to the existing Planner for anything beyond a session's first pass —
 * there is no review/chain/split screen here (docs/superpowers/specs/
 * 2026-07-30-athlete-guided-session-builder-design.md).
 */
export function GuidedBuilder() {
  const { id } = useParams<{ id: string }>();
  const { db, update } = useDb();
  const nav = useNavigate();
  const known = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);

  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [added, setAdded] = useState<string[]>([]);
  const [phase, setPhase] = useState<'flow' | 'add-another'>('flow');

  if (!id) return null;
  const state = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmupSet };

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commitBlock() {
    const kind = draft.blockKind;
    if (!kind) return;
    let label = '';
    update((d) => {
      const w = d.workouts.find((x) => x.id === id);
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
        // @hybrid/engine's top-level `newCondBlock` (packages/engine/src/session.ts)
        // takes no arguments and returns sensible defaults; the emit.ts
        // overload with (heading, condFmt, effort, minutes) params lives only
        // under the `emit` namespace export, not here. Build the default block
        // and fill in what was authored, keeping `targetZone` in lockstep with
        // `effort` the same way emit.newCondBlock does.
        const block = newCondBlock();
        block.heading = 'Conditioning';
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
    // No earlier step than block-type: back here means abandoning the flow.
    nav('/library');
  }

  function pick(kind: Exclude<BlockKind, null>) {
    patch({ blockKind: kind });
    setStep(nextStep('block-type', { blockKind: kind, isWarmupSet: false }) ?? 'block-type');
  }

  if (phase === 'add-another') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
        <Kicker>{added.join(', ')} added</Kicker>
        <h1 className="text-8 font-[800]">Add another block?</h1>
        <div className="mt-1 flex gap-1">
          <Button
            variant="brass"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setStep('block-type');
              setPhase('flow');
            }}
          >
            Yes, add another
          </Button>
          <Button onClick={() => nav(`/planner/${id}`)}>No, I'm done</Button>
        </div>
      </div>
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

  // step === 'text'
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
