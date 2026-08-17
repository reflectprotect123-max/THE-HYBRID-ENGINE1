export type FlowStep = 'block-type' | 'cond-detail' | 'text';

export type BlockKind = 'warmup' | 'cond' | 'metcon' | null;

export interface FlowState {
  blockKind: BlockKind;
}

/** Every field any step's `canAdvance` check might need to read. */
export interface FlowDraft {
  condFmt: string;
  text: string;
}

const COND_SEQUENCE: FlowStep[] = ['block-type', 'cond-detail'];
const TEXT_SEQUENCE: FlowStep[] = ['block-type', 'text'];

/*
 * `'lift'` — the fourth `BlockKind`, and its own `LIFT_SEQUENCE`
 * ('block-type' → 'movement' → 'sets' → 'reps' → 'rpe') — went whole with
 * the rest of strength on 17 August 2026. `FlowState` lost `isWarmupSet`
 * with it: it existed only to decide whether a lift block's 'rpe' step was
 * skipped for a warm-up SET, a question that made sense only inside the
 * lift sequence. The whole-BLOCK 'warmup' kind (Warm-up/Cooldown, a single
 * text box — see the spec's "two separate warm-up concepts" note) is
 * unrelated and unaffected.
 */

/**
 * The ordered steps for the current state. A conditioning block authors its
 * format/effort/minutes on the 'cond-detail' step. A Warm-up/Cooldown BLOCK
 * and a Metcon/notes block are both a single open text box.
 */
export function stepsFor(state: FlowState): FlowStep[] {
  if (state.blockKind === 'cond') return COND_SEQUENCE;
  return TEXT_SEQUENCE;
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
  if (step === 'cond-detail') return draft.condFmt.trim().length > 0;
  if (step === 'text') return draft.text.trim().length > 0;
  return true;
}
