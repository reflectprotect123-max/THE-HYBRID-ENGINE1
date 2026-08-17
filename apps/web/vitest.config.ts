import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Historically needed because `@hybrid/session-authoring` carried its own
  // `react` devDependency at a different pinned version than this app's, and
  // Vite resolves a workspace package's imports from its REAL path — so
  // without this, a shared hook's `react` import found that copy instead of
  // the app's, and every hook inside it threw "Invalid hook call". That
  // package was deleted 17 August 2026 with the rest of strength; `dedupe`
  // is kept as cheap insurance against the same class of bug from any other
  // workspace package that pins its own `react`.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
