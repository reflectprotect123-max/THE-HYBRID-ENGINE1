import { View } from 'react-native';
import { ThemeProvider } from '@hybrid/design';
import { SessionLogger } from '../src/screens/logger/SessionLogger';

/*
 * The parity harness.
 *
 * Reached only through `src/root.web.tsx`, which is only in the module graph
 * when Metro bundles for web. It mounts the app's REAL logger — the same
 * `SessionLogger` the navigator renders — over the session
 * `checks/parity/drive.mjs` seeds into storage, so the two browser-driven
 * parity gates can judge it.
 *
 * What is deliberately absent: the navigator, the tab bar, the safe-area
 * insets and every provider the app wraps itself in. The logger reads none of
 * them — its one seam on the app is `src/screens/logger/bridge.ts`, and the
 * web resolution of that file supplies the session and no-ops the rest. What
 * IS here is `ThemeProvider`, because the screens read `useTheme()` for every
 * colour and an unwrapped consumer would silently take the strength palette
 * from the context default rather than because anything chose it.
 *
 * See `README.md` beside this file for what this proves and what it does not.
 */
export function Harness() {
  return (
    <ThemeProvider world="strength">
      <View testID="parity-harness-ready" style={{ flex: 1 }}>
        <SessionLogger />
      </View>
    </ThemeProvider>
  );
}
