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
    /* OFF for the published build.
       Maps were 5.3MB of a 6.4MB deploy — 83% of everything uploaded — and
       nothing consumed them: there is no error-reporting service wired up, and
       the service worker never precached them. They also published the full
       original TypeScript, comments and all, to anyone who guessed the URL.
       Turn back on locally when you need to read a production stack trace. */
    sourcemap: false,
  },
});
