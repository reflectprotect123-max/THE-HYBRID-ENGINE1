import { useState } from 'react';
import {
  blockExercises, duplicateExercise, isCond, isText, isWarmupBlock,
  newBlock, newCondBlock, newEx, newTextBlock, newWarmupBlock, sessionLetters,
  type ModeKey,
} from '@hybrid/engine';
import { canAdvance, nextStep, prevStep, stepsFor, type FlowState, type FlowStep } from './flowSteps';
import { BlockTypeStep } from './steps/BlockTypeStep';
import { MovementStep } from './steps/MovementStep';
import { SetsStep } from './steps/SetsStep';
import { RepsStep } from './steps/RepsStep';
import { RpeStep } from './steps/RpeStep';
import { MoreStep } from './steps/MoreStep';
import { PublishStep } from './steps/PublishStep';
import type { CoachSession } from '../model';
import { GHOST, Ltr, MICRO, WELL } from '../ui';

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
  // A session that already has content opens on its overview — the grid's
  // filled-cell button says "Edit", and landing on "What are we doing?"
  // (which authors a NEW block) would contradict it. Only a genuinely empty
  // session starts at the first authoring question.
  const [step, setStep] = useState<FlowStep>(session.blocks.length ? 'review' : 'block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // `publish` is deliberately NOT a FlowStep — flowSteps.ts's FlowStep union
  // ('block-type' | 'movement' | 'sets' | 'reps' | 'rpe' | 'more' | 'review')
  // has no 'publish' member, so it lives beside `step` rather than as a fake
  // value forced into it.
  const [showPublish, setShowPublish] = useState(false);
  // When set, the flow is appending an exercise to this EXISTING block (the
  // review screen's per-block "＋ Add exercise") rather than creating a new
  // one — this is how a real A1/A2 superset gets its second movement.
  const [targetBlock, setTargetBlock] = useState<number | null>(null);
  const flowState: FlowState = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmup };

  const go = (dir: 'next' | 'prev') => {
    // The gate lives in flowSteps.canAdvance (pure, tested) — the advancing
    // button is disabled on the same condition, so this guard is the
    // authoritative backstop, not the only defense.
    if (dir === 'next' && !canAdvance(step, draft)) return;
    // Backing out of the movement picker while appending to an existing
    // block returns to the review screen — 'block-type' would offer to
    // change the kind of a block that already exists.
    if (dir === 'prev' && step === 'movement' && targetBlock != null) {
      setTargetBlock(null);
      setDraft(EMPTY_DRAFT);
      setStep('review');
      return;
    }
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
      // `draft.note` is MoreStep's "Note for the athlete" field — the label
      // the athlete apps read from `ex.cue` (packages/engine/src/types.ts),
      // so it belongs on the exercise, not dropped on the floor.
      const ex = { ...newEx(), name: draft.movementName, sets, rest: draft.rest, tempo: draft.tempo, mode: draft.mode, cue: draft.note };
      const existing = targetBlock != null ? session.blocks[targetBlock] : null;
      if (existing && !isCond(existing) && !isText(existing)) {
        // Appending to an existing block (the "＋ Add exercise" path): the
        // new movement joins the block's exercise list, where the chain seam
        // can then pair it into an A1/A2 superset.
        const blocks = [...session.blocks];
        blocks[targetBlock!] = { ...existing, exercises: [...blockExercises(existing), ex] };
        onChange({ ...session, blocks });
      } else {
        const block = draft.blockKind === 'warmup' ? newWarmupBlock() : newBlock();
        block.exercises = [ex];
        onChange({ ...session, blocks: [...session.blocks, block] });
      }
    }
    setTargetBlock(null);
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
          {/* Coach instructions ride the session itself (Workout.note) and are
              read by the athlete before the first block — authored here, on
              the same screen that sends them, per the design spec. */}
          <div className="mx-auto w-full max-w-[360px] px-3 pt-3">
            <label className="flex flex-col gap-0.5">
              <span className={MICRO}>Coach instructions (the athlete reads these first)</span>
              <textarea
                value={session.note || ''}
                onChange={(e) => onChange({ ...session, note: e.target.value })}
                rows={3}
                className={WELL + ' resize-y px-1 py-1 text-4'}
              />
            </label>
          </div>
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
        onAddExercise={(bi) => {
          const b = session.blocks[bi];
          if (isCond(b) || isText(b)) return;
          setDraft({ ...EMPTY_DRAFT, blockKind: isWarmupBlock(b) ? 'warmup' : 'lift' });
          setTargetBlock(bi);
          setStep('movement');
        }}
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
                // direct branch rather than a call into commitBlock. Reset
                // the draft too, so nothing from an abandoned lift/metcon
                // attempt earlier in the session leaks into the next block.
                onChange({ ...session, blocks: [...session.blocks, newCondBlock()] });
                setDraft(EMPTY_DRAFT);
                setStep('review');
                return;
              }
              setDraft((d) => ({ ...d, blockKind: kind }));
              // go('next') would read `flowState`, which is computed from
              // THIS render's `draft` — the setDraft above hasn't landed yet
              // (React batches it), so flowState.blockKind here is still the
              // PREVIOUS value, not `kind`. For 'lift'/'warmup' that happens
              // to be harmless, since stepsFor's fallback for anything except
              // 'cond'/'metcon' (including null) is LIFT_SEQUENCE anyway —
              // but for 'metcon' it would send the coach to 'movement'
              // (LIFT_SEQUENCE's next step) instead of 'more', and the
              // following transition would then evaluate against
              // METCON_SEQUENCE, find 'movement' isn't in it, and silently
              // go nowhere — stranding metcon authoring for good. So this one
              // transition computes the next step directly from the
              // freshly-known `kind` instead of trusting go('next')'s stale
              // closure.
              {
                const s = nextStep('block-type', { blockKind: kind, isWarmupSet: false });
                if (s) setStep(s);
                else onClose();
              }
            }}
          />
        ) : step === 'movement' ? (
          <MovementStep
            current={draft.movementName}
            onPick={(name) => {
              // Same stale-closure rule as the block-type pick above: this
              // render's `draft.movementName` is still the OLD value, so the
              // gate is checked against the freshly-picked name directly.
              setDraft((d) => ({ ...d, movementName: name }));
              if (canAdvance('movement', { ...draft, movementName: name })) {
                const s = nextStep('movement', flowState);
                if (s) setStep(s);
              }
            }}
            onBack={() => go('prev')}
          />
        ) : step === 'sets' ? (
          <SetsStep count={draft.sets} onChange={(n) => setDraft((d) => ({ ...d, sets: n }))} onNext={() => go('next')} />
        ) : step === 'reps' ? (
          <RepsStep
            value={draft.reps}
            isWarmup={draft.isWarmup}
            onChange={(v) => setDraft((d) => ({ ...d, reps: v }))}
            onWarmupToggle={(v) => setDraft((d) => ({ ...d, isWarmup: v }))}
            onNext={() => go('next')}
          />
        ) : step === 'rpe' ? (
          <RpeStep value={draft.rpe} onChange={(v) => setDraft((d) => ({ ...d, rpe: v }))} onNext={() => go('next')} />
        ) : step === 'more' ? (
          <MoreStep
            rest={draft.rest} tempo={draft.tempo} mode={draft.mode} note={draft.note}
            metcon={draft.blockKind === 'metcon'}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onDone={commitBlock}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The session overview reached at the end of the flow — the same block/exercise
 *  list and superset seam Editor.tsx had, just as this flow's landing screen. */
function ReviewScreen({
  session, letters, onAddBlock, onAddExercise, onDuplicate, onChainToggle, onPublish, onClose,
}: {
  session: CoachSession;
  letters: Record<number, string[]>;
  onAddBlock: () => void;
  onAddExercise: (blockIndex: number) => void;
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
            <>
              <ul className="mt-1 flex flex-col gap-1">
                {blockExercises(b).map((ex, ei, exs) => (
                  <li key={ex.id} className="flex items-center gap-1">
                    <Ltr>{letters[bi]?.[ei] ?? '?'}</Ltr>
                    <span className="min-w-0 flex-1 truncate text-4">{ex.name || 'Exercise'}</span>
                    <button onClick={() => onDuplicate(bi, ei)} className={GHOST}>Duplicate</button>
                    {/* ssNext chains an exercise to the one BELOW it — the
                        last row has nothing below, so no seam is offered
                        (duplicateExercise documents the same rule). */}
                    {ei < exs.length - 1 ? (
                      <button onClick={() => onChainToggle(bi, ei)} className={GHOST}>{ex.ssNext ? 'Split' : 'Chain'}</button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <button onClick={() => onAddExercise(bi)} className={GHOST + ' mt-1'}>
                ＋ Add exercise
              </button>
            </>
          )}
        </section>
      ))}
      <button onClick={onAddBlock} className={GHOST}>＋ Add another block</button>
      <button onClick={onPublish} className={GHOST + ' mt-auto'}>Continue to publish ›</button>
    </div>
  );
}
