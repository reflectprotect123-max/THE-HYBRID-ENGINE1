import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `@hybrid/session-authoring` carries its own `react` devDependency (for its
  // own package-local test run) at a different pinned version than this app's.
  // Vite resolves a workspace package's imports from its REAL path, so without
  // this its `react` import found that copy instead of the app's — two React
  // instances in one test, and every hook inside the shared hook throws
  // "Invalid hook call". `dedupe` forces both to resolve to the one instance
  // this app itself depends on.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
