import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

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
        name: 'THE Hybrid System',
        short_name: 'Hybrid',
        description: 'Hybrid training — lift, condition, recover.',
        theme_color: '#070706',
        background_color: '#070706',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          // Serverless functions are never a navigation.
          /^\/\.netlify\//,
          // THE COACH SITE IS A DIFFERENT APP AT THE SAME ORIGIN. Without this
          // the athlete shell's service worker answers every /coach/ navigation
          // with the athlete's index.html, and the builder simply never loads
          // for anyone who has opened the athlete app first. The old hand-rolled
          // service worker carried the same bypass; it is not optional.
          /^\/coach(\/|$)/,
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
