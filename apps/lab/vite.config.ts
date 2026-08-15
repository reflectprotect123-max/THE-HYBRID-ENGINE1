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
/*
 * `base` is a build input because the lab is published two ways: as its own
 * Netlify site at the origin root, and as a subdirectory of the conditioning
 * site at `/lab/`. Vite writes ABSOLUTE asset URLs into index.html, so a build
 * made for the root and copied into `/lab/` asks the server for `/assets/...`
 * — which on the conditioning site is a real directory belonging to a
 * different app. The page would load someone else's bundle rather than 404,
 * which is why this is set rather than left to a rewrite rule.
 */
export default defineConfig({
  base: process.env.HYBRID_LAB_BASE || '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  plugins: [react()],
});
