import { View } from 'react-native';
import { useFonts } from 'expo-font';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { Inter_900Black } from '@expo-google-fonts/inter/900Black';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
 * web resolution of that file supplies the session and no-ops the rest.
 *
 * Two things ARE here, and both are here because the visual gate would
 * otherwise be measuring the harness rather than the screen:
 *
 *  - `ThemeProvider`, because the screens read `useTheme()` for every colour
 *    and an unwrapped consumer takes the strength palette from a context
 *    default rather than because anything chose it.
 *  - The same five Inter faces `App.tsx` loads. Without them every glyph falls
 *    back to the browser's serif, and a shot compared against the prototype is
 *    then reporting a missing font on every line of text — which drowns out
 *    any real difference underneath. Nothing renders until they are in, for
 *    the same reason: a screenshot taken mid-load is a screenshot of the
 *    fallback.
 *
 * See `README.md` beside this file for what this proves and what it does not.
 */
export function Harness() {
  const [fontsReady] = useFonts({
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });

  if (!fontsReady) return <View />;

  return (
    /* `SafeAreaProvider` is here for one reason: the screen reads
       `useSafeAreaInsets`, and without a provider that hook has nothing to
       read. A browser viewport has no notch, so it reports zeros — which is
       exactly what keeps the shots comparable with the prototype's. */
    <SafeAreaProvider>
      <ThemeProvider world="strength">
        <View testID="parity-harness-ready" style={{ flex: 1 }}>
          <SessionLogger />
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
