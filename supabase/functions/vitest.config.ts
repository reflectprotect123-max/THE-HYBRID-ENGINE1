import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the pure, Node-importable pieces of each Edge Function are
    // collected here — never `index.ts` files themselves, which use
    // `jsr:` imports and `Deno.*` globals that only resolve under the
    // Deno runtime Supabase actually deploys to. See
    // embed-coaching-note/index.test.ts and embed-coaching-note/
    // _requestShape.ts for why the split exists.
    include: ['**/*.test.ts'],
  },
});
