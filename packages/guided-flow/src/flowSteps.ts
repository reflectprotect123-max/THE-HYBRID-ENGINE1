export type FlowStep = 'block-type' | 'movement' | 'sets' | 'reps' | 'rpe' | 'cond-detail' | 'text';

export type BlockKind = 'lift' | 'warmup' | 'cond' | 'metcon' | null;

export interface FlowState {
  blockKind: BlockKind;
  /** Whether the SET currently being authored is marked as a warm-up. */
  isWarmupSet: boolean;
}

/** Every field any step's `canAdvance` check might need to read. */
export interface FlowDraft {
  movementName: string;
  reps: string;
  rpe: string;
  condFmt: string;
  text: string;
}

const LIFT_SEQUENCE: FlowStep[] = ['block-type', 'movement', 'sets', 'reps', 'rpe'];
const COND_SEQUENCE: FlowStep[] = ['block-type', 'cond-detail'];
const TEXT_SEQUENCE: FlowStep[] = ['block-type', 'text'];

/**
 * The ordered steps for the current state. A conditioning block authors its
 * format/effort/minutes on the 'cond-detail' step. A Warm-up/Cooldown BLOCK
 * and a Metcon/notes block are both a single open text box — see the spec's
 * "two separate warm-up concepts" note: this is the whole-BLOCK choice,
 * distinct from flagging one SET as a warm-up inside an ordinary lift block.
 * A warm-up SET skips 'rpe', since nothing in a warm-up counts toward
 * autoregulation (packages/engine/src/autoreg.ts).
 */
export function stepsFor(state: FlowState): FlowStep[] {
  if (state.blockKind === 'cond') return COND_SEQUENCE;
  if (state.blockKind === 'warmup' || state.blockKind === 'metcon') return TEXT_SEQUENCE;
  return state.isWarmupSet ? LIFT_SEQUENCE.filter((s) => s !== 'rpe') : LIFT_SEQUENCE;
}

export function nextStep(current: FlowStep, state: FlowState): FlowStep | null {
  const seq = stepsFor(state);
  const i = seq.indexOf(current);
  return i >= 0 && i < seq.length - 1 ? seq[i + 1] : null;
}

export function prevStep(current: FlowStep, state: FlowState): FlowStep | null {
  const seq = stepsFor(state);
  const i = seq.indexOf(current);
  return i > 0 ? seq[i - 1] : null;
}

/**
 * What each step requires before the flow may advance past it. The gate lives
 * here — pure and tested — rather than scattered across the step components,
 * so the button that actually advances and the one that merely looks primary
 * can never disagree about whether advancing is allowed.
 */
export function canAdvance(step: FlowStep, draft: FlowDraft): boolean {
  if (step === 'movement') return draft.movementName.trim().length > 0;
  if (step === 'reps') return draft.reps.trim().length > 0;
  if (step === 'rpe') return draft.rpe.trim().length > 0;
  if (step === 'cond-detail') return draft.condFmt.trim().length > 0;
  if (step === 'text') return draft.text.trim().length > 0;
  return true;
}
