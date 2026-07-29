import { useState } from 'react';
import {
  blockExercises, duplicateExercise, isCond, isText,
  newBlock, newCondBlock, newEx, newTextBlock, newWarmupBlock, sessionLetters,
  type ModeKey,
} from '@hybrid/engine';
import { nextStep, prevStep, stepsFor, type FlowState, type FlowStep } from './flowSteps';
import { BlockTypeStep } from './steps/BlockTypeStep';
import { MovementStep } from './steps/MovementStep';
import { SetsStep } from './steps/SetsStep';
import { RepsStep } from './steps/RepsStep';
import { RpeStep } from './steps/RpeStep';
import { MoreStep } from './steps/MoreStep';
import { PublishStep } from './steps/PublishStep';
import type { CoachSession } from '../model';
import { GHOST, Ltr } from '../ui';

interface Draft {
  blockKind: 'lift' | 'warmup' | 'cond' | 'metcon' | null;
  movementName: string;
  sets: number;
  reps: string;
  isWarmup: boolean;
  rpe: string;
  rest: number;
  tempo: string;
  mode: ModeKey;
  note: string;
}

const EMPTY_DRAFT: Draft = {
  blockKind: null, movementName: '', sets: 3, reps: '', isWarmup: false,
  rpe: '', rest: 90, tempo: '', mode: 'reps_kg', note: '',
};

export function GuidedFlow({
  session,
  onChange,
  onClose,
}: {
  session: CoachSession;
  onChange: (s: CoachSession) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // `publish` is deliberately NOT a FlowStep — flowSteps.ts's FlowStep union
  // ('block-type' | 'movement' | 'sets' | 'reps' | 'rpe' | 'more' | 'review')
  // has no 'publish' member, so it lives beside `step` rather than as a fake
  // value forced into it.
  const [showPublish, setShowPublish] = useState(false);
  const flowState: FlowState = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmup };

  const go = (dir: 'next' | 'prev') => {
    const s = dir === 'next' ? nextStep(step, flowState) : prevStep(step, flowState);
    if (s) setStep(s);
    else if (dir === 'prev') {
      // prevStep is null at index 0 of every sequence, i.e. only ever on
      // 'block-type'. Re-entering 'block-type' from "＋ Add another block"
      // on the review screen is index 0 too, so without this check Back
      // there would exit the WHOLE flow instead of returning to the review
      // list the coach came from. Only a session with nothing in it yet
      // (the very first block) has nowhere to go back TO.
      if (step === 'block-type' && session.blocks.length > 0) setStep('review');
      else onClose();
    }
  };

  /**
   * Turns the draft into a real block, appends it, and returns to the
   * overview. `cond` is committed directly from BlockTypeStep's onPick
   * instead — see below — since a conditioning block has nothing left to
   * author (CondBlock has no note/rest/tempo/mode field to hold a `more`
   * step's input) and 'more' is never shown for it (flowSteps.ts).
   */
  const commitBlock = () => {
    if (draft.blockKind === 'metcon') {
      onChange({ ...session, blocks: [...session.blocks, { ...newTextBlock(), body: draft.note }] });
    } else {
      const target = draft.isWarmup ? 'W' + draft.reps : draft.reps;
      const sets = Array.from({ length: draft.sets }, () => ({ t: target, rpe: draft.isWarmup ? '' : draft.rpe }));
      // `draft.note` is MoreStep's "Note for the athlete" field — the exact
      // label ExerciseCard.tsx already uses for `ex.cue` (packages/engine/src
      // /types.ts), so it belongs on the exercise, not dropped on the floor.
      const ex = { ...newEx(), name: draft.movementName, sets, rest: draft.rest, tempo: draft.tempo, mode: draft.mode, cue: draft.note };
      const block = draft.blockKind === 'warmup' ? newWarmupBlock() : newBlock();
      block.exercises = [ex];
      onChange({ ...session, blocks: [...session.blocks, block] });
    }
    setDraft(EMPTY_DRAFT);
    setStep('review');
  };

  const letters = sessionLetters({ id: session.id, date: '', status: 'completed', blocks: session.blocks });

  if (showPublish) {
    return (
      <div className="flex min-h-full flex-col">
        <header className="flex items-center gap-1 border-b border-line px-2 py-1">
          <button onClick={() => setShowPublish(false)} aria-label="back to review" className={GHOST}>
            ‹ Back to review
          </button>
        </header>
        <div className="flex-1">
          <PublishStep sess={session} />
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <ReviewScreen
        session={session}
        letters={letters}
        onAddBlock={() => setStep('block-type')}
        onDuplicate={(bi, ei) => {
          const b = session.blocks[bi];
          if (isCond(b) || isText(b)) return;
          const blocks = [...session.blocks];
          blocks[bi] = { ...b, exercises: duplicateExercise(blockExercises(b), ei) };
          onChange({ ...session, blocks });
        }}
        onChainToggle={(bi, ei) => {
          const b = session.blocks[bi];
          if (isCond(b) || isText(b)) return;
          const exs = blockExercises(b).map((e, i) => (i === ei ? { ...e, ssNext: !e.ssNext } : e));
          const blocks = [...session.blocks];
          blocks[bi] = { ...b, exercises: exs };
          onChange({ ...session, blocks });
        }}
        onPublish={() => setShowPublish(true)}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line px-2 py-1">
        <button onClick={() => go('prev')} aria-label="back" className={GHOST}>
          ‹ Back
        </button>
        <span className="num text-3 text-dim">
          {session.name || 'Session'} · {stepsFor(flowState).indexOf(step) + 1} of {stepsFor(flowState).length}
        </span>
      </header>
      <div className="flex-1">
        {step === 'block-type' ? (
          <BlockTypeStep
            onPick={(kind) => {
              if (kind === 'cond') {
                // Commit immediately: a cond block is complete as soon as its
                // kind is picked, and going through setDraft + go('next') +
                // commitBlock would read stale state (setDraft's update
                // isn't visible until the next render), so this stays a
                // direct branch rather than a call into commitBlock.
                onChange({ ...session, blocks: [...session.blocks, newCondBlock()] });
                setStep('review');
                return;
              }
              setDraft((d) => ({ ...d, blockKind: kind }));
              go('next');
            }}
          />
        ) : step === 'movement' ? (
          <MovementStep current={draft.movementName} onPick={(name) => { setDraft((d) => ({ ...d, movementName: name })); go('next'); }} />
        ) : step === 'sets' ? (
          <SetsStep count={draft.sets} onChange={(n) => setDraft((d) => ({ ...d, sets: n }))} />
        ) : step === 'reps' ? (
          <RepsStep
            value={draft.reps}
            isWarmup={draft.isWarmup}
            onChange={(v) => setDraft((d) => ({ ...d, reps: v }))}
            onWarmupToggle={(v) => setDraft((d) => ({ ...d, isWarmup: v }))}
          />
        ) : step === 'rpe' ? (
          <RpeStep value={draft.rpe} onChange={(v) => setDraft((d) => ({ ...d, rpe: v }))} />
        ) : step === 'more' ? (
          <MoreStep
            rest={draft.rest} tempo={draft.tempo} mode={draft.mode} note={draft.note}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onDone={commitBlock}
          />
        ) : null}
      </div>
      {step !== 'sets' && step !== 'reps' && step !== 'rpe' ? null : (
        <footer className="flex justify-end gap-1 border-t border-line p-1">
          <button onClick={() => go('next')} className={GHOST}>Next ›</button>
        </footer>
      )}
    </div>
  );
}

/** The session overview reached at the end of the flow — the same block/exercise
 *  list and superset seam Editor.tsx had, just as this flow's landing screen. */
function ReviewScreen({
  session, letters, onAddBlock, onDuplicate, onChainToggle, onPublish, onClose,
}: {
  session: CoachSession;
  letters: Record<number, string[]>;
  onAddBlock: () => void;
  onDuplicate: (blockIndex: number, exIndex: number) => void;
  onChainToggle: (blockIndex: number, exIndex: number) => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col gap-2 p-3">
      <header className="flex items-center gap-1">
        <button onClick={onClose} className={GHOST}>‹ Done for now</button>
        <h1 className="ml-1 text-7 font-[800]">{session.name || 'Session'}</h1>
      </header>
      {session.blocks.map((b, bi) => (
        <section key={b.id} className="rounded-md border border-line p-2">
          <div className={'text-3 font-[750] uppercase tracking-[.12em] text-gold2'}>{b.heading || 'Block'}</div>
          {isCond(b) || isText(b) ? null : (
            <ul className="mt-1 flex flex-col gap-1">
              {blockExercises(b).map((ex, ei) => (
                <li key={ex.id} className="flex items-center gap-1">
                  <Ltr>{letters[bi]?.[ei] ?? '?'}</Ltr>
                  <span className="min-w-0 flex-1 truncate text-4">{ex.name || 'Exercise'}</span>
                  <button onClick={() => onDuplicate(bi, ei)} className={GHOST}>Duplicate</button>
                  <button onClick={() => onChainToggle(bi, ei)} className={GHOST}>{ex.ssNext ? 'Split' : 'Chain'}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <button onClick={onAddBlock} className={GHOST}>＋ Add another block</button>
      <button onClick={onPublish} className={GHOST + ' mt-auto'}>Continue to publish ›</button>
    </div>
  );
}
