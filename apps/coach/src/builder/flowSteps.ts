export type FlowStep = 'block-type' | 'cond-detail' | 'movement' | 'sets' | 'reps' | 'rpe' | 'more' | 'review';

export interface FlowState {
  blockKind: 'lift' | 'warmup' | 'cond' | 'metcon' | null;
  /** Whether the SET currently being authored is marked as a warm-up. */
  isWarmupSet: boolean;
}

const LIFT_SEQUENCE: FlowStep[] = ['block-type', 'movement', 'sets', 'reps', 'rpe', 'more', 'review'];
const METCON_SEQUENCE: FlowStep[] = ['block-type', 'more', 'review'];
// A conditioning block DOES have authorable fields (format/effort/minutes),
// which the 'cond-detail' step collects. What it lacks is a note field
// (packages/engine/src/types.ts CondBlock), so 'more' still never shows for
// it — showing that field and then silently dropping whatever was typed into
// it would be dishonest. Metcon's 'more' step stays: its note IS wired to
// TextBlock.body.
const COND_SEQUENCE: FlowStep[] = ['block-type', 'cond-detail', 'review'];

/**
 * The ordered steps for the current state. A conditioning block authors its
 * format/effort/minutes on the 'cond-detail' step, then reviews. A metcon has
 * no movement/sets/reps/RPE, but does have a free-form "more" step for its
 * note. A warm-up set skips RPE, since nothing in a warm-up counts toward
 * autoregulation (packages/engine/src/autoreg.ts).
 */
export function stepsFor(state: FlowState): FlowStep[] {
  if (state.blockKind === 'cond') return COND_SEQUENCE;
  if (state.blockKind === 'metcon') return METCON_SEQUENCE;
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
 * so the button that ACTUALLY advances and the one that merely looks primary
 * can never disagree about whether advancing is allowed.
 */
export function canAdvance(
  step: FlowStep,
  draft: { movementName: string; reps: string; rpe: string; condFmt: string },
): boolean {
  if (step === 'movement') return draft.movementName.trim().length > 0;
  if (step === 'reps') return draft.reps.trim().length > 0;
  if (step === 'rpe') return draft.rpe.trim().length > 0;
  if (step === 'cond-detail') return draft.condFmt.trim().length > 0;
  return true;
}
