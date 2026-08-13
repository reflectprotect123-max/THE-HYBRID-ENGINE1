/*
 * Component tests for the phone app.
 *
 * These exist because the engine was the most tested part of this system and
 * also the part that broke least. Every mobile regression of the last stretch —
 * a set that would not log, a conditioning block that never completed, a hook
 * added below an early return, a screen that rendered blank — was invisible to
 * 110 engine tests and to `tsc`, and was found by the owner looking at their
 * phone. Bundling proves the app PARSES. This proves it works.
 *
 * jest-expo rather than the vitest the rest of the workspace uses: it ships the
 * React Native transformer, the module mocks for every `expo-*` package, and
 * the haste config that RN's own source depends on. Reimplementing that on top
 * of vitest is a project, not a config file.
 */
const path = require('node:path');

module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: [path.resolve(__dirname, 'test/setup.ts')],
  /* Both trees: tests are colocated with the module they cover in src/, and
     test/ still holds the setup, the stubs and the shared harness. Dropping
     either half here does not fail — it silently collects fewer tests. */
  testMatch: [
    '<rootDir>/src/**/*.test.tsx',
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/test/**/*.test.tsx',
    '<rootDir>/test/**/*.test.ts',
  ],
  /*
   * Every `jest.spyOn` in this suite (mostly `Alert.alert`) used to accumulate
   * call history across tests: `jest.spyOn` on an already-mocked method
   * returns the SAME mock rather than a fresh one, so a later test's
   * `mock.calls[0]` could actually be an earlier test's call, invoking the
   * wrong `onPress`. Task 4's folder-delete test hit this and worked around it
   * locally with a `.mockClear()`. `restoreMocks` fixes the whole class of bug
   * once, for every spy in every file, by restoring each mock/spy to its
   * original (un-mocked) implementation after every test — no per-test
   * cleanup required.
   */
  restoreMocks: true,
  /*
   * 20s, not jest's default 5s.
   *
   * That default is a local-machine assumption. On GitHub's runners this
   * suite takes ~25s where it takes ~2.7s here — roughly 9x — and the FIRST
   * test in `nutrition-label-ocr.test.tsx`'s "photographing a label" block
   * paid the module-init cost for the whole file and blew the 5s budget on
   * every CI run for a day, while passing locally in 353ms. The test was
   * never wrong; the budget was measured on the wrong machine.
   *
   * Raised at the CONFIG level rather than on that one test, because the next
   * marginal test hits exactly the same wall and would be diagnosed from
   * scratch. This does not hide a hang: a genuinely stuck test still fails,
   * 15s later.
   */
  testTimeout: 20_000,
  /*
   * React Native and every expo-* package ship untranspiled ESM, and the
   * workspace packages export TypeScript SOURCE rather than a built dist — all
   * of it has to go through babel, and node_modules is ignored by default.
   *
   * The `.*` before the alternation is what makes this work under pnpm. The
   * stock Expo pattern expects the package name as the FIRST segment after
   * node_modules/; pnpm's real path is
   *
   *   node_modules/.pnpm/react-native@0.81.4_<peer-hash>/node_modules/react-native/…
   *
   * so the name never appears where that pattern looks, every RN file stayed
   * ignored, and the suite died on `import` in react-native/jest/setup.js.
   * Matching the name ANYWHERE in the path is the pnpm-correct form.
   */
  transformIgnorePatterns: [
    'node_modules/(?!.*(?:react-native|@react-native|expo|@expo|@expo-google-fonts|@react-navigation|nativewind|react-native-css-interop|@hybrid))',
  ],
  moduleNameMapper: {
    '^@hybrid/engine$': path.resolve(__dirname, '../../packages/engine/src/index.ts'),
    '^@hybrid/design$': path.resolve(__dirname, '../../packages/design/src/index.ts'),
    '^@hybrid/session-authoring$': path.resolve(__dirname, '../../packages/session-authoring/src/index.ts'),
    '^@hybrid/config$': path.resolve(__dirname, '../../packages/config/src/index.ts'),
    // Imported for its side effect only; there is no CSS in a jest environment.
    '\\.css$': path.resolve(__dirname, 'test/style-stub.js'),
  },
};
