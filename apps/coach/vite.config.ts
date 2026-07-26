import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* Same CSP constraint as the athlete app: script-src 'self' with no
   'unsafe-inline', so the build must emit no inline <script>. */
export default defineConfig({
  base: '/coach/',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
});
