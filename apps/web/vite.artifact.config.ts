import { defineConfig, mergeConfig, type PluginOption } from 'vite';
import baseConfig from './vite.config';

/*
 * The athlete app as ONE self-contained HTML file.
 *
 * This is the `dist-single` idea (vite.single-html.config.ts) taken all the way:
 * that config still emits index.html + a separate .js + a separate .css, which is
 * fine for a file:// artifact served from a folder but not for a single document.
 * scripts/build-artifact.mjs does the final inlining; this config's job is to make
 * that inlining POSSIBLE — one JS chunk, one CSS file, every asset already a data
 * URI — and to bake in the two settings that must not depend on shell env vars.
 *
 * The PWA plugin is filtered out rather than left to emit an unused worker. A
 * single-document build has no origin to scope a service worker to, no /sw.js to
 * fetch, and no manifest URL that resolves; shipping them would only give the
 * runtime three things to fail at. `UpdateBanner.tsx` guards on
 * `'serviceWorker' in navigator`, which the boot shim uses to switch it off
 * cleanly (see build-artifact.mjs).
 */
const withoutPwa = (plugins: PluginOption[]): PluginOption[] =>
  plugins.filter((p) => {
    /* VitePWA returns an ARRAY of plugins, so a flat name check misses it —
       recurse, and drop any nested group that is entirely PWA. */
    if (Array.isArray(p)) {
      const kept = withoutPwa(p);
      return kept.length > 0;
    }
    const name = p && typeof p === 'object' && 'name' in p ? String(p.name) : '';
    return !name.startsWith('vite-plugin-pwa') && !name.startsWith('vite-plugin-workbox');
  });

export default mergeConfig(
  { ...baseConfig, plugins: withoutPwa((baseConfig.plugins ?? []) as PluginOption[]) },
  defineConfig({
    /* Intrinsic to the build, never read from the shell: a caller who forgets
       VITE_SINGLE_HTML would emit a BrowserRouter document, and a BrowserRouter
       inside an artifact frame cannot navigate — every route would render the
       catch-all and the file would look broken for a reason nothing explains. */
    define: {
      'import.meta.env.VITE_SINGLE_HTML': JSON.stringify('true'),
      /* `/` redirects to the coach bench on this (unscoped) build, and that
         route is therefore reachable inside the document. CoachAccess denies an
         unknown user by navigating to `/` — which redirects to `/coach` again.
         Without demo mode that is a redirect loop, so the one door the athlete
         can accidentally open would hang the file. */
      'import.meta.env.VITE_COACH_DEMO_MODE': JSON.stringify('true'),
    },
    build: {
      outDir: 'dist-artifact',
      emptyOutDir: true,
      /* One CSS file and one JS chunk, so the inliner has exactly two things to
         fold in and cannot silently miss a third. */
      cssCodeSplit: false,
      /* Fonts and icons become data: URIs at build time. The artifact CSP blocks
         every external host, and there is no origin to serve /fonts from either. */
      assetsInlineLimit: 10_000_000,
      sourcemap: false,
      rollupOptions: {
        output: {
          /* The coach bench is a lazy import(). In a single document there is
             nothing to load it FROM, so it has to be part of the one chunk. */
          inlineDynamicImports: true,
        },
      },
    },
  }),
);
