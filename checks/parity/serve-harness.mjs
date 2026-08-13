/*
 * Serving the mobile parity harness to the gates.
 *
 * `--target=harness` exists so that running the mobile side of either gate is
 * one command. Before this, it meant exporting `apps/mobile` for web by hand
 * and starting a static server by hand, then passing its URL in — which worked
 * exactly once, on the machine that did it, and was not something CI or the
 * next person could reproduce. A gate nobody else can run is a gate that stops
 * being run.
 *
 * The export is skipped when `.expo-parity` is already there and `--no-build`
 * was asked for; otherwise it is rebuilt, because a stale bundle passing a
 * gate is worse than a slow one failing it.
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = resolve(ROOT, 'apps/mobile/.expo-parity');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.map': 'application/json',
};

/**
 * Export the harness (unless told not to), serve it, and hand back its URL
 * plus the `close` that stops it.
 *
 * Any path that is not a real file falls through to `index.html`, because the
 * driver navigates to the app's own logger route and there is no router on
 * this server — the app does its own routing once it has booted.
 */
export async function serveHarness({ build = true, port = 4310 } = {}) {
  if (build) {
    execFileSync('pnpm', ['--filter', '@hybrid/mobile', 'run', 'parity:build'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }
  if (!existsSync(OUT_DIR)) {
    throw new Error(`no harness export at ${OUT_DIR} — run without --no-build`);
  }

  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(OUT_DIR, path);
    if (path === '/' || !existsSync(file)) file = join(OUT_DIR, 'index.html');
    try {
      const buf = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404).end('nope');
    }
  });

  await new Promise((ok) => server.listen(port, ok));
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}
