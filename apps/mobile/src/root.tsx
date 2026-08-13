import { App } from './App';

/*
 * The root component Metro resolves per platform.
 *
 * `index.js` imports `./src/root` without an extension, so Metro picks
 * `root.web.tsx` when bundling for web and THIS file for android and ios.
 * That is the whole mechanism behind the parity harness: the harness is a
 * separate module graph, entered only on web, and the android bundle can
 * never reach it — not by convention, but because the file that imports it
 * is not part of the android graph at all.
 *
 * The alternative was to fork on `package.json`'s `main` field, which
 * `@expo/config`'s `resolveEntryPoint` also supports. It was rejected: `main`
 * is read by EAS and by the native build, and repointing it to an
 * extensionless path to unlock platform extensions is a change to the release
 * path in order to serve a check. This fork touches nothing native.
 */
export const Root = App;
