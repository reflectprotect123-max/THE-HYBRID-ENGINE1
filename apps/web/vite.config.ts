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
      injectRegister: 'script-defer', // emits a real file, not an inline snippet
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
        // Supabase must never be served from cache — a stale session or a stale
        // sync response is worse than an offline error.
        navigateFallbackDenylist: [/^\/\.netlify\//],
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
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keeping the runtime out of index.html: no inline chunk, ever.
        inlineDynamicImports: false,
      },
    },
  },
});
