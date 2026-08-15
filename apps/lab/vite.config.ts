import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * The conditioning lab.
 *
 * Deliberately the smallest Vite config in this repository. No PWA, no
 * Tailwind, no service worker, no product switch — every one of those exists
 * in apps/web because a SHIPPED athlete or coach surface needed it, and this
 * app ships to nobody. It is a bench for looking at @hybrid/engine's
 * conditioning decisions directly.
 *
 * `dedupe` is the one thing carried over, for the same reason apps/web needs
 * it: workspace packages resolve their imports from their real path, so two
 * copies of React can end up in one bundle if any dependency carries its own.
 */
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  plugins: [react()],
});
