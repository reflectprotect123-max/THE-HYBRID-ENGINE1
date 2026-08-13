/*
 * The harness gate.
 *
 * Both parity gates drive a browser. `apps/mobile` is React Native, which is
 * not a browser, so they cannot drive it directly. The bridge is
 * `apps/mobile/parity/Harness.tsx`, exported to web by Metro through
 * `src/root.web.tsx` and served here as a static site.
 *
 * This check exists to prove the ONE assumption the whole mobile gate strategy
 * rests on: that a React Native `testID` arrives in the DOM as `data-testid`
 * through react-native-web. Every `data-parity` hook in the vocabulary becomes
 * a `testID` with the identical value on mobile, and if that translation did
 * not happen, six screens would be built on a gate that could never see them.
 *
 * It also asserts the harness graph stays clean: the export must not contain
 * the native-only modules that make a full web export of this app impossible.
 * That is not a size check — it is what makes the export possible at all, and
 * a stray `import` from `src/App` would put every one of them back.
 *
 * Usage:
 *   node checks/parity-harness.mjs [--no-build] [--android]
 *
 *   --no-build   serve whatever is already in apps/mobile/.expo-parity
 *   --android    also export the ANDROID bundle and prove the harness stayed
 *                out of it. Off by default because it costs about half a
 *                minute; run it whenever the harness graph changes.
 *
 * Exit 0 pass, 1 fail, 0 with a SKIP line when there is no Chromium.
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_chromium.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'apps/mobile/.expo-parity');
const PORT = 4321;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

/* Modules with no web implementation. A full `expo export --platform web` of
 * this app fails on them; the harness only works because nothing it imports
 * reaches them. Asserted against the bundle text so the guarantee is measured
 * rather than assumed. */
const NATIVE_ONLY = ['react-native-ble-plx', 'expo-mlkit-ocr', 'react-native-maps'];

function serve(port, dir) {
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = join(dir, p);
      if (p === '/' || !existsSync(file)) file = join(dir, 'index.html');
      try {
        const buf = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(buf);
      } catch {
        res.writeHead(404).end('nope');
      }
    });
    s.listen(port, () => ok(s));
  });
}

/** Every emitted JS chunk, concatenated. */
async function bundleText(dir) {
  const jsDir = join(dir, '_expo/static/js/web');
  const names = existsSync(jsDir) ? await readdir(jsDir) : [];
  const parts = [];
  for (const name of names) {
    if (name.endsWith('.js')) parts.push(await readFile(join(jsDir, name), 'utf8'));
  }
  if (parts.length === 0) throw new Error(`no JS bundle under ${jsDir}`);
  return parts.join('\n');
}

const build = !process.argv.includes('--no-build');
const android = process.argv.includes('--android');
const unknown = process.argv.slice(2).filter((a) => a !== '--no-build' && a !== '--android');
if (unknown.length) {
  console.error(`parity-harness: unrecognised argument \`${unknown[0]}\``);
  process.exit(1);
}

if (build) {
  console.log('Exporting the harness…');
  execFileSync('pnpm', ['--filter', '@hybrid/mobile', 'run', 'parity:build'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

if (!existsSync(OUT_DIR)) {
  console.error(`parity-harness: ${OUT_DIR} does not exist — run without --no-build`);
  process.exit(1);
}

const failures = [];

const bundle = await bundleText(OUT_DIR);
for (const mod of NATIVE_ONLY) {
  if (bundle.includes(mod)) {
    failures.push(
      `the harness bundle references \`${mod}\`, which has no web implementation — ` +
        'something in the harness graph is importing the app itself',
    );
  }
}

/*
 * The android side of the same guarantee. react-native-web and react-dom are
 * DEV dependencies of apps/mobile, and a dev dependency that silently ships is
 * real APK weight and real risk.
 *
 * Two canaries, both read out of the Hermes bytecode:
 *
 *  - `react-native-web`, the package the harness needs and the app must not
 *    have. Metro only swaps `react-native` for it on the web platform.
 *  - `parity-harness-ready`, the harness's own marker string. It is the sharper
 *    of the two: it exists nowhere else in the repo, so if the android graph
 *    ever reached `src/root.web.tsx` it would appear here even if the swap
 *    happened to leave no other trace.
 *
 * `react-dom` is deliberately NOT a canary. That substring is already in the
 * android bundle and always was, from @react-navigation's ServerContainer
 * error text and react-native's own `createReactDOMStyle` symbol — neither is
 * the package. A canary that matches unrelated prose is a canary that either
 * cries wolf or gets deleted.
 */
if (android) {
  console.log('Exporting the android bundle…');
  execFileSync('pnpm', ['--filter', '@hybrid/mobile', 'run', 'bundle'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const androidDir = resolve(ROOT, 'apps/mobile/.expo-export/_expo/static/js/android');
  const names = existsSync(androidDir) ? await readdir(androidDir) : [];
  const bundles = names.filter((n) => n.endsWith('.hbc') || n.endsWith('.js'));
  if (bundles.length === 0) {
    failures.push(`no android bundle under ${androidDir}`);
  }
  for (const name of bundles) {
    const buf = await readFile(join(androidDir, name), 'latin1');
    for (const canary of ['react-native-web', 'parity-harness-ready']) {
      if (buf.includes(canary)) {
        failures.push(
          `the ANDROID bundle ${name} contains \`${canary}\` — the parity harness has leaked ` +
            'into the shipped app',
        );
      }
    }
  }
}

const { browser, skip } = await launchChromium();
if (skip) {
  console.log(`SKIP parity-harness: ${skip}`);
  process.exit(0);
}

const server = await serve(PORT, OUT_DIR);
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(String(err)));

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  const marker = page.locator('[data-testid="parity-harness-ready"]');
  try {
    await marker.first().waitFor({ state: 'attached', timeout: 10_000 });
  } catch {
    failures.push(
      'no `[data-testid="parity-harness-ready"]` in the harness DOM — either the harness did ' +
        'not mount, or react-native-web did not translate `testID` into `data-testid`. ' +
        'Everything downstream of this check assumes it does.',
    );
  }
  for (const err of consoleErrors) failures.push(`page error: ${err}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('OK  parity harness serves, mounts, and speaks data-testid');
