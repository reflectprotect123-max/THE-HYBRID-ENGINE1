import { Picker } from '../../editor/MovementPicker';

/** A thin full-screen wrapper around the (unchanged) movement picker. */
export function MovementStep({ current, onPick }: { current: string; onPick: (name: string) => void }) {
  return <Picker current={current} onClose={() => onPick(current)} onPick={onPick} />;
}
