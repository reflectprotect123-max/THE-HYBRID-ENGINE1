import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider, conditioningColor, strengthColor, useTheme } from '@hybrid/design';

function Probe() {
  const { color } = useTheme();
  return <Text testID="ink">{color.onAccent}</Text>;
}

describe('ThemeProvider / useTheme', () => {
  it('resolves the strength palette under productId="strength"', () => {
    render(
      <ThemeProvider productId="strength">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('ink').props.children).toBe(strengthColor.onAccent);
  });

  it('resolves the conditioning palette under productId="conditioning"', () => {
    render(
      <ThemeProvider productId="conditioning">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('ink').props.children).toBe(conditioningColor.onAccent);
  });

  it('falls back to the strength palette when nothing wraps it', () => {
    render(<Probe />);
    expect(screen.getByTestId('ink').props.children).toBe(strengthColor.onAccent);
  });

  it('actually differs between the two products', () => {
    expect(conditioningColor.onAccent).not.toBe(strengthColor.onAccent);
  });
});
