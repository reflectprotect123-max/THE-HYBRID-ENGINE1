import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/*
 * Three builds, not two.
 *
 * `strength` and `conditioning` are the branded athlete builds; NO product set
 * is the unfiltered dashboard, which is what the live site deploys. The
 * earlier form of this was `conditioning ? … : dashboard`, copied from
 * apps/mobile/app.config.js — but there the fallback arm IS strength's real
 * identity (app.json's name/slug/package), whereas here the fallback is the
 * dashboard. So `build:strength` silently produced a manifest named "THE
 * Hybrid System — Dashboard" and the branded strength web build never
 * actually existed. Switch on the value; do not infer it from the absence of
 * the other one.
 */
const product = process.env.VITE_HYBRID_PRODUCT;
const productName =
  product === 'conditioning' ? 'THE Conditioning System'
  : product === 'strength' ? 'THE Strength System'
  : 'THE Hybrid System';
const productShortName =
  product === 'conditioning' ? 'Conditioning'
  : product === 'strength' ? 'Strength'
  : 'Hybrid';

/*
 * The deployed CSP (see _headers, asserted by checks/pentest.mjs) is
 *   script-src 'self' 'wasm-unsafe-eval'
 * with no 'unsafe-inline'. Anything Vite would otherwise inline into
 * index.html — the modulepreload polyfill, a small runtime chunk, the PWA
 * registration snippet — would be blocked at runtime and the app would show a
 * blank page in production while working perfectly in dev. Every setting below
 * that looks like a micro-optimisation is actually there to keep the output
 * free of inline <script>.
 */
export default defineConfig({
  // See vitest.config.ts's matching comment: `@hybrid/session-authoring`
  // carries its own `react` devDependency at a different pinned version, and
  // Vite resolves a workspace package's imports from its real path — so
  // without this the bundle would carry two React instances.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      /* null, not 'script-defer': src/UpdateBanner.tsx calls registerSW()
         itself so it can hold the activator until the athlete taps. Leaving the
         plugin's own registration script in place registers the worker twice —
         two registrations racing for the same scope, and the one that wins is
         the one with no update handler attached. */
      injectRegister: null,
      manifest: {
        name: productName,
        short_name: productShortName,
        description:
          product === 'conditioning' ? 'Conditioning training — run, ride, row, recover.'
          : product === 'strength' ? 'Strength training — lift, progress, track.'
          : 'Train, program, and track — strength and conditioning in one place.',
        theme_color: '#070706',
        background_color: '#070706',
        display: 'standalone',
        /* THIS MANIFEST IS NO LONGER OFFERED TO ANYONE, and the reasoning
           below is kept as the design to restore rather than as a live
           description.

           It read: "`/home`, not `/`, so launching the installed app does not
           spend its first paint on a redirect… a `/home` scope would push
           /training, /log and /progress out of the installed app and into a
           browser tab." Every route it names was removed when the athlete web
           app was parked on 13 August 2026, and `/home` IS a redirect now —
           the exact thing the choice of start_url existed to avoid.

           `src/manifestLink.tsx` therefore offers the coach manifest on every
           path, so nothing installs from this one. It is still emitted because
           parked means restorable and the service worker's precache scope
           depends on it. Restoring the athlete app means restoring the routes,
           the manifest swap, and the nested `/` + `/coach` scopes together. */
        id: '/',
        start_url: '/home',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        /* tesseract.js's WASM core (self-hosted, see labelOcr.ts) is a 3.9 MB
           single file — its base64-inlined WASM binary makes it far bigger
           than Workbox's 2 MiB default precache limit, and bumping that
           limit would put 3.9 MB into EVERY install's initial precache for a
           screen most athletes never open. It stays a normal same-origin
           static asset instead: fetched (and cached by the browser's HTTP
           cache, see `_headers`) only the first time OCR actually runs. */
        globIgnores: ['tesseract/tesseract-core-simd-lstm.wasm.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          // Serverless functions are never a navigation.
          /^\/\.netlify\//,
          // Review routes are part of this SPA and are safe to reopen from its
          // precached shell. Progression decisions are explicitly local demo
          // records; the screen labels that boundary. Keep authoring and the
          // mutation-heavy legacy bench online-only until a real outbox exists.
          /^\/coach(?:\/?$|\/(?!(?:review|nutrition|progression)(?:\/|$)).*)/,
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    /* OFF for the published build.
       Maps were 5.3MB of a 6.4MB deploy — 83% of everything uploaded — and
       nothing consumed them: there is no error-reporting service wired up, and
       the service worker never precached them. They also published the full
       original TypeScript, comments and all, to anyone who guessed the URL.
       Turn back on locally when you need to read a production stack trace. */
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keeping the runtime out of index.html: no inline chunk, ever.
        inlineDynamicImports: false,
      },
    },
  },
});
