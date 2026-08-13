import { View } from 'react-native';

/*
 * The parity harness.
 *
 * Reached only through `src/root.web.tsx`, which is only in the module graph
 * when Metro bundles for web. Its job is to mount the app's REAL logger over
 * the fixed session in `checks/fixtures/session.json` so the two browser-driven
 * parity gates can judge it. See `README.md` beside this file.
 *
 * Until the logger exists (task 7 of the mobile-logger plan points this at it),
 * the harness mounts its own liveness marker instead. That marker is not a
 * placeholder standing in for shipped code: it lives outside `src/`, it can
 * never reach the android bundle, and it exists so that task 1 can prove the
 * one assumption everything downstream rests on — that a React Native `testID`
 * really does arrive in the DOM as `data-testid` through react-native-web.
 */
export function Harness() {
  return <View testID="parity-harness-ready" />;
}
