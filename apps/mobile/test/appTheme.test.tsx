import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider, conditioningColor, strengthColor, useTheme } from '@hybrid/design';

/** Mirrors the shape App.tsx now uses: a provider rendered by an OUTER component,
 * with a SEPARATE inner component below it doing the actual `useTheme()` read.
 * This is the exact structure the fix in finding #1 establishes — this test exists
 * so a future regression (someone reading useTheme() back in the outer component)
 * fails a test instead of only being caught by code review. */
function Outer({ productId }: { productId: 'strength' | 'conditioning' }) {
  return (
    <ThemeProvider productId={productId}>
      <Inner />
    </ThemeProvider>
  );
}

function Inner() {
  const { color } = useTheme();
  return <Text testID="bg">{color.bg}</Text>;
}

describe('provider-above-consumer wiring (regression for App.tsx bug)', () => {
  it.each(['strength', 'conditioning'] as const)('resolves the %s palette when the consumer is BELOW the provider', (productId) => {
    render(<Outer productId={productId} />);
    const expected = productId === 'conditioning' ? conditioningColor.bg : strengthColor.bg;
    expect(screen.getByTestId('bg').props.children).toBe(expected);
  });
});
