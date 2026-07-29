export type FlowStep = 'block-type' | 'movement' | 'sets' | 'reps' | 'rpe' | 'more' | 'review';

export interface FlowState {
  blockKind: 'lift' | 'warmup' | 'cond' | 'metcon' | null;
  /** Whether the SET currently being authored is marked as a warm-up. */
  isWarmupSet: boolean;
}

const LIFT_SEQUENCE: FlowStep[] = ['block-type', 'movement', 'sets', 'reps', 'rpe', 'more', 'review'];
const NON_LIFT_SEQUENCE: FlowStep[] = ['block-type', 'more', 'review'];

/**
 * The ordered steps for the current state. A conditioning or metcon block has
 * no movement/sets/reps/RPE to author — it goes straight from "what kind of
 * work" to the free-form "more" step. A warm-up set skips RPE, since nothing
 * in a warm-up counts toward autoregulation (packages/engine/src/autoreg.ts).
 */
export function stepsFor(state: FlowState): FlowStep[] {
  if (state.blockKind === 'cond' || state.blockKind === 'metcon') return NON_LIFT_SEQUENCE;
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
