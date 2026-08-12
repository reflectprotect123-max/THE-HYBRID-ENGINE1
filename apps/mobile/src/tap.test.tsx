/*
 * The touch contract.
 *
 * An audit found thirteen controls under the 44pt minimum — one at 24px — and
 * of thirty Pressables, none gave any press feedback. Those defects accumulated
 * one call site at a time over months, and nothing could see them: they are
 * invisible to typecheck, to the bundler, and to a screenshot.
 *
 * So the guard is structural rather than per-screen: `Tap` owns the rules, and
 * these assert it enforces them. The companion check that nothing BYPASSES Tap
 * lives in checks/mobile-touch.mjs — it reads source files, which needs Node
 * types, and putting those in a React Native app's tsconfig would make
 * `process.env` typecheck in app code and then crash on a device.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Btn, Chip, Tap, T } from './ui';

describe('Tap', () => {
  it('expands a small control to the 48dp minimum without resizing it', () => {
    // hitSlop rather than a bigger box is the whole point: the touch area grows,
    // the layout does not move. A 24px glyph needs 12 on each side.
    render(
      <Tap onPress={() => {}} box={24} label="tiny">
        <T>✕</T>
      </Tap>,
    );
    const el = screen.getByLabelText('tiny');
    expect(el.props.hitSlop).toEqual({ top: 12, bottom: 12, left: 12, right: 12 });
  });

  it('adds no slop to a control that is already big enough', () => {
    render(
      <Tap onPress={() => {}} box={64} label="big">
        <T>ok</T>
      </Tap>,
    );
    expect(screen.getByLabelText('big').props.hitSlop).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('handles height and width independently', () => {
    // The RPE steppers are 40 tall and 48 wide — only one axis is short.
    render(
      <Tap onPress={() => {}} box={{ h: 40, w: 48 }} label="rpe">
        <T>−</T>
      </Tap>,
    );
    expect(screen.getByLabelText('rpe').props.hitSlop).toEqual({ top: 4, bottom: 4, left: 0, right: 0 });
  });

  it('announces itself as a button and fires', () => {
    const onPress = jest.fn();
    render(
      <Tap onPress={onPress} label="do it">
        <T>Go</T>
      </Tap>,
    );
    const el = screen.getByLabelText('do it');
    expect(el.props.accessibilityRole).toBe('button');
    fireEvent.press(el);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled, and says so to a screen reader', () => {
    const onPress = jest.fn();
    render(
      <Tap onPress={onPress} disabled label="nope">
        <T>Go</T>
      </Tap>,
    );
    const el = screen.getByLabelText('nope');
    expect(el.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(el);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('carries selection state for chips, which colour alone would not convey', () => {
    render(<Chip on>Mon</Chip>);
    expect(screen.getByLabelText('Mon').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('Btn still fires through the wrapper', () => {
    // The regression that would matter most: Tap sits under every button in the
    // app, so breaking press handling here breaks logging a set.
    const onPress = jest.fn();
    render(<Btn onPress={onPress}>Finish Set</Btn>);
    fireEvent.press(screen.getByText('Finish Set'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
