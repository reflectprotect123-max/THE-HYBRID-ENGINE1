import { fireEvent, render } from '@testing-library/react-native';
import type { BlockView } from '@hybrid/session-authoring';
import { BlockStrip } from './BlockStrip';

const blocks: BlockView[] = [
  { id: 'b0', title: 'Warm-up', progress: { done: 2, total: 2 } },
  { id: 'b1', title: 'Squat + Row', progress: { done: 1, total: 8 } },
  { id: 'b2', title: 'Push-up', progress: { done: 0, total: 4 } },
];

describe('BlockStrip', () => {
  it('renders one segment per block, hooked by index', () => {
    const r = render(<BlockStrip blocks={blocks} currentIndex={1} onSelect={() => {}} />);
    expect(r.getByTestId('seg-0')).toBeTruthy();
    expect(r.getByTestId('seg-1')).toBeTruthy();
    expect(r.getByTestId('seg-2')).toBeTruthy();
    expect(r.queryByTestId('seg-3')).toBeNull();
  });

  it('marks only the current segment selected', () => {
    const r = render(<BlockStrip blocks={blocks} currentIndex={1} onSelect={() => {}} />);
    expect(r.getByTestId('seg-0').props.accessibilityState.selected).toBe(false);
    expect(r.getByTestId('seg-1').props.accessibilityState.selected).toBe(true);
  });

  it('selects by index on press', () => {
    const onSelect = jest.fn();
    const r = render(<BlockStrip blocks={blocks} currentIndex={0} onSelect={onSelect} />);
    fireEvent.press(r.getByTestId('seg-2'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('renders nothing at all for a session with no blocks', () => {
    const r = render(<BlockStrip blocks={[]} currentIndex={0} onSelect={() => {}} />);
    expect(r.toJSON()).toBeNull();
  });
});
