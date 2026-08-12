import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider, strengthColor } from '@hybrid/design';
import { Input, T } from './ui';

/*
 * THE REGRESSION. `Input` set `placeholderTextColor` and never set `color`.
 * React Native's TextInput defaults its text to black on Android, and this app
 * is black, so the placeholder was visible and everything typed after it was
 * not — reported from the phone as "nothing comes up on the screen". It was
 * not one screen: 32 of the 33 <Input> uses named no colour of their own,
 * including the Logger's weight and reps fields.
 *
 * The property asserted here is the one that failed: a bare <Input>, with no
 * style from its caller, resolves to a text colour that is the theme's ink.
 */
function flat(style: unknown) {
  return (StyleSheet.flatten(style) ?? {}) as { color?: string };
}

describe('Input colour', () => {
  it('renders typed text in the theme ink, not the platform default', () => {
    render(
      <ThemeProvider world="strength">
        <Input testID="field" placeholder="Movement" />
      </ThemeProvider>,
    );
    expect(flat(screen.getByTestId('field').props.style).color).toBe(strengthColor.text);
  });

  it('is the same ink the app renders its own text in', () => {
    // The bug was a contrast bug: the input disagreed with every label beside
    // it. Asserting the two agree catches a future palette change that moves
    // one and not the other.
    render(
      <ThemeProvider world="strength">
        <Input testID="field" />
        <T testID="label">Movement</T>
      </ThemeProvider>,
    );
    const ink = flat(screen.getByTestId('field').props.style).color;
    expect(ink).toBe(strengthColor.text);
    expect(ink).not.toBe(strengthColor.bg);
  });

  it('still lets a caller that genuinely wants another colour win', () => {
    render(
      <ThemeProvider world="strength">
        <Input testID="field" style={{ color: '#ff0000' }} />
      </ThemeProvider>,
    );
    expect(flat(screen.getByTestId('field').props.style).color).toBe('#ff0000');
  });

  it('keeps the placeholder dimmer than the text, so the two stay distinct', () => {
    render(
      <ThemeProvider world="strength">
        <Input testID="field" placeholder="Movement" />
      </ThemeProvider>,
    );
    const field = screen.getByTestId('field');
    expect(field.props.placeholderTextColor).toBe(strengthColor.dim);
    expect(field.props.placeholderTextColor).not.toBe(flat(field.props.style).color);
  });
});
