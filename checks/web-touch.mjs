/*
 * Touch targets in the built web apps, measured in a real browser.
 *
 * The athlete app is an installable PWA used on a phone in a gym, and its
 * `Button` renders 32px at `sm` and 40px at `md` — both under the 44pt
 * minimum. tokens.css fixes that under `@media (pointer: coarse)` so fingers
 * get 44px and a mouse does not, since a dense coach builder padded out to
 * finger size would look broken on a desktop.
 *
 * That media query is exactly the kind of thing that is easy to write and easy
 * to get wrong — it can match nothing, or match everything. The other browser
 * suites run with a default fine pointer and would never enter the branch, so
 * this drives both emulations and measures.
 *
 *   node checks/web-touch.mjs        (skips cleanly without playwright)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { launchChromium } from './_chromium.mjs';

const root = resolve(process.cwd(), process.argv.slice(2).find((a) => !a.startsWith('-')) || '.');
const PUB = resolve(root, 'apps/web/dist');
const MIN = 44;

if (!existsSync(PUB)) {
  console.error('apps/web/dist missing — run `pnpm run build:site` first.');
  process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = normalize(join(PUB, p === '/' ? 'index.html' : p));
  if (!f.startsWith(PUB) || !existsSync(f) || !extname(f)) f = join(PUB, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const { browser, skip } = await launchChromium();
if (skip) {
  console.log('SKIP — web-touch: ' + skip + '.');
  server.close();
  process.exit(0);
}

let fails = 0;
const check = (ok, msg) => {
  console.log((ok ? 'PASS — ' : 'FAIL — ') + msg);
  if (!ok) fails++;
};

/** Every rendered button's height, under a given input-device emulation. */
async function heights({ hasTouch }) {
  const ctx = await browser.newContext({
    hasTouch,
    isMobile: hasTouch,
    viewport: hasTouch ? { width: 390, height: 844 } : { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const hs = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => Math.round(b.getBoundingClientRect().height)),
  );
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  await ctx.close();
  return { hs, coarse };
}

const touch = await heights({ hasTouch: true });
const mouse = await heights({ hasTouch: false });

// If the emulation does not actually flip the media query, everything below is
// measuring the same thing twice and passing for the wrong reason.
check(touch.coarse === true, 'touch emulation reports pointer: coarse');
check(mouse.coarse === false, 'desktop emulation reports a fine pointer');
check(touch.hs.length > 0, `found buttons to measure (${touch.hs.length} visible)`);

const short = touch.hs.filter((h) => h < MIN);
check(short.length === 0, `every visible button is >=${MIN}px on touch (smallest ${Math.min(...touch.hs)}px)`);

// The whole point of scoping it to coarse pointers: desktop stays compact.
const grew = Math.min(...mouse.hs) < MIN;
check(grew, `a mouse still gets the compact sizes (smallest ${Math.min(...mouse.hs)}px) — the rule is not global`);

await browser.close();
server.close();
console.log(fails ? `\n${fails} failure(s).` : '\nAll web touch checks passed.');
process.exit(fails ? 1 : 0);
