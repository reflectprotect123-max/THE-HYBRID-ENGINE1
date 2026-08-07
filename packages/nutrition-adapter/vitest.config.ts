import { defineConfig } from 'vitest/config';

/*
 * The same include as every other nutrition package. Without a config at all
 * this package still ran its tests — vitest's default glob happens to find
 * `test/context.test.ts` — but "happens to" is the whole problem: a package
 * that silently runs no tests is worse than a package with none, and the
 * default is not a contract this repo controls.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
