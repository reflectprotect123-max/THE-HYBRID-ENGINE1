# The parity harness

Both parity gates — `checks/parity-behaviour.mjs` and `checks/parity-visual.mjs`
— drive a browser. This app is React Native, which is not a browser, so they
cannot drive it directly. This directory is the bridge.

## How it is reached

`index.js` imports `./src/root` with no extension. Metro resolves that to
`src/root.web.tsx` when bundling for web and `src/root.tsx` for android and ios.
The web root exports `Harness`; the native root exports `App`. Nothing native
imports this directory, and nothing here imports `src/App`.

That fork is the whole isolation mechanism. It is not a convention — the android
module graph does not contain the file that imports the harness, so it cannot
reach it. `checks/parity-harness.mjs --android` proves that against the Hermes
bytecode rather than trusting it.

## Why not just export the whole app to web

Because it does not build. `apps/mobile` depends on `react-native-ble-plx`,
`expo-mlkit-ocr`, `react-native-maps` and `expo-notifications`' native paths,
none of which have a web implementation. The harness works precisely because it
mounts the logger and nothing else, so none of them enter the graph.

Storage is not a problem: `src/store/storage.ts` already falls back to an
in-memory shim when MMKV cannot load, and that shim answers a read-after-write
exactly as MMKV does.

## What it proves, and what it does not

**Proves:** that the app's real logger screens, rendered from
`@hybrid/session-authoring`, produce the same behaviour and the same layout as
the prototype at `checks/fixtures/prototype/rolling-logger.html` — the same
coaching strings, the same rotation outcomes, the same 412px composition.

**Does not prove:** that Android renders identically to react-native-web. Fonts,
shadows and text metrics differ. The visual gate against this harness is a
strong signal, not a device guarantee. The APK still wants one human look before
release.

## Running it

```
node checks/parity-harness.mjs            # export, serve, assert it mounts
node checks/parity-harness.mjs --android  # also prove the android bundle is clean
pnpm --filter @hybrid/mobile run parity:build   # just the export
```

`react-native-web` and `react-dom` are DEV dependencies of `apps/mobile` for
this reason and only this reason. They must never move to `dependencies`.
