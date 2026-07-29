import { Picker } from '../../editor/MovementPicker';

/** A thin full-screen wrapper around the (unchanged) movement picker.
 *  Closing without picking goes BACK — it must never commit `current`
 *  as if it had been picked (an empty `current` would advance the flow
 *  with no movement at all). */
export function MovementStep({ current, onPick, onBack }: { current: string; onPick: (name: string) => void; onBack: () => void }) {
  return <Picker current={current} onClose={onBack} onPick={onPick} />;
}
