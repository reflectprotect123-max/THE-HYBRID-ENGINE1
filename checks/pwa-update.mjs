/*
 * The update loop, end to end.
 *
 * The PWA is `registerType: 'prompt'`: a new service worker installs and then
 * WAITS to be told to take over. Nothing in the app ever told it, so every
 * deploy reached the site and never reached an installed app — a fully
 * downloaded new version sitting behind a worker with no activator. Silent,
 * permanent, and invisible from the deploy side.
 *
 * This serves a real build, then serves a DIFFERENT real build underneath the
 * running page, and asserts the three things that matter:
 *   - nothing is announced when there is nothing new
 *   - the new version is announced when there is
 *   - it does NOT swap itself in until asked (a live logger must survive)
 *   - and it does swap when asked
 *
 * Two genuine `vite build` outputs, not a patched asset: the precache manifest
 * carries revision hashes, so hand-editing a file leaves the worker correctly
 * serving what its manifest says and the test lies.
 */
import { createServer } from 'node:http';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { launchChromium } from './_chromium.mjs';

const TMP = process.env.PWA_TMP || join(tmpdir(), 'pwa-update-check');
const MARKER = 'PWA UPDATE CHECK V2';
const SCREEN = 'apps/web/src/screens/Library.tsx';
const TITLE = '<ScreenTitle>Your library</ScreenTitle>';

/*
 * Two real builds, so the precache manifest carries genuine revision hashes.
 *
 * Reaching pnpm is the fiddly part. When this check is run through a pnpm
 * script, npm_execpath points at pnpm's own entry script, and running it with
 * this Node finds it no matter what PATH looks like. Run directly as
 * `node checks/pwa-update.mjs` that variable is unset, so fall back to the
 * PATH lookup through a shell, because on Windows pnpm is a .cmd and
 * execFileSync will not apply PATHEXT for you: without a shell this check died
 * at `spawnSync pnpm ENOENT` before it ever opened a browser. The command is a
 * fixed string, so execSync's shell costs nothing here.
 */
const PNPM = process.env.npm_execpath;
const build = () =>
  PNPM
    ? execFileSync(process.execPath, [PNPM, '--filter', '@hybrid/web', 'build'], { stdio: 'ignore' })
    : execSync('pnpm --filter @hybrid/web build', { stdio: 'ignore' });

/* v2 differs by one visible string. The source is restored in `finally` even
   if the build throws — leaving a test marker in a screen would be a far worse
   bug than the one this check exists for. */
const original = await readFile(SCREEN, 'utf8');
let ok = false;
await rm(TMP, { recursive: true, force: true }).catch(() => {});
try {
  build();
  await cp('apps/web/dist', `${TMP}/v1`, { recursive: true });
  await writeFile(SCREEN, original.replace(TITLE, `<ScreenTitle>${MARKER}</ScreenTitle>`));
  build();
  await cp('apps/web/dist', `${TMP}/v2`, { recursive: true });
} finally {
  await writeFile(SCREEN, original);
}

let root = `${TMP}/v1`;
const TYPES = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p) || !extname(p)) p = join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(await readFile(p));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const { browser, skip } = await launchChromium();
if (skip) {
  console.log('SKIP — pwa-update: ' + skip + '.');
  server.close();
  process.exit(0);
}
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const fail = (m) => { console.error('FAIL: ' + m); process.exitCode = 1; };

try {
  await page.goto(base + '/library');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // a first-visit worker activates but does not control until reload
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });

  if (await page.locator('text=A new version is ready').count()) fail('announced an update with nothing deployed');

  root = `${TMP}/v2`;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForSelector('text=A new version is ready', { timeout: 25000 });

  if (await page.locator(`text=${MARKER}`).count()) fail('activated itself before being asked — a live logger would have been reloaded mid-set');

  await page.locator('button', { hasText: 'Reload' }).click();
  await page.waitForFunction((m) => document.body.innerText.includes(m), MARKER, { timeout: 25000 });
  ok = true;
} catch (e) {
  fail(String(e).split('\n')[0]);
} finally {
  await browser.close();
  server.close();
  await rm(TMP, { recursive: true, force: true }).catch(() => {});
}
if (ok && !process.exitCode) console.log('PWA update check passed — announced, waited, then activated on request.');
