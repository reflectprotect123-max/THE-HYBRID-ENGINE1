import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    /* This config produces a file:// artifact. Keep its router and access mode
       intrinsic to the build so a caller cannot accidentally emit a blank
       BrowserRouter/auth-gated HTML file by forgetting shell environment vars. */
    define: {
      'import.meta.env.VITE_SINGLE_HTML': JSON.stringify('true'),
      'import.meta.env.VITE_COACH_DEMO_MODE': JSON.stringify('true'),
    },
    build: {
      outDir: 'dist-single',
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: 10_000_000,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  }),
);
