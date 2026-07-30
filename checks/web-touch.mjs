/*
 * Touch targets in the built web apps, measured in a real browser.
 *
 * The athlete app is an installable PWA used on a phone in a gym, and its
 * `Button` renders 32px at `sm` and 40px at `md` — both under the 44pt
 * minimum. tokens.css fixes that under `@media (pointer: coarse)` so fingers
 * get 44px and a mouse does not, since a dense desktop layout padded out to
 * finger size would look broken.
 *
 * That media query is exactly the kind of thing that is easy to write and easy
 * to get wrong — it can match nothing, or match everything. The other browser
 * suites run with a default fine pointer and would never enter the branch, so
 * this drives both emulations and measures.
 *
 * Originally only visited `/` and only measured `<button>`s — real enough to
 * catch the rule breaking, but not the gym path: Training's in-progress list
 * and Library's session cards are where an athlete's thumb actually lands, and
 * both have anchors and a `select` alongside plain buttons. Seeds one workout
 * and one active session so `/training` renders in-progress rather than the
 * empty "Start a session" state, then walks `/`, `/training`, `/library` and
 * measures every `button, a, [role="button"], select` that is actually visible.
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

// The gym path: Home (nothing live), Training (a session actually in
// progress — different controls than the empty state), and Library (the
// session list, with its arm-to-delete buttons). One workout plus one active
// session seeded before the app boots so Training renders the in-progress
// list instead of "Start a session" and Library has a card to act on.
const SEED = {
  workouts: [
    {
      id: 'w1',
      name: 'Lower A',
      days: [0, 1, 2, 3, 4, 5, 6],
      updatedAt: 1,
      blocks: [
        {
          id: 'b1',
          heading: 'Main',
          superset: false,
          exercises: [
            {
              id: 'e1',
              name: 'Back Squat',
              mode: 'reps_kg',
              rest: 120,
              sets: [
                { t: 'W10', rpe: '' },
                { t: '5', rpe: '8' },
              ],
            },
          ],
        },
      ],
    },
  ],
  sessions: [
    {
      id: 's1',
      date: new Date().toISOString().slice(0, 10),
      name: 'Lower A',
      status: 'active',
      workoutId: 'w1',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      blocks: [
        {
          id: 'b1s',
          heading: 'Main',
          superset: false,
          exercises: [
            {
              id: 'e1s',
              name: 'Back Squat',
              mode: 'reps_kg',
              rest: 120,
              sets: [
                { t: 'W10', rpe: '' },
                { t: '5', rpe: '8' },
              ],
            },
          ],
        },
      ],
    },
  ],
  settings: { profile: { age: 30, restingHr: 50 } },
};

const ROUTES = ['/', '/training', '/library'];
const SELECTOR = 'button, a, [role="button"], select';

/** Every visible control's height on every gym-path route, under a given
 *  input-device emulation. */
async function heights({ hasTouch }) {
  const ctx = await browser.newContext({
    hasTouch,
    isMobile: hasTouch,
    viewport: hasTouch ? { width: 390, height: 844 } : { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  // Seeded once per context, before the first navigation — addInitScript
  // re-runs on every subsequent goto too, but the store is written once and
  // read from then on, so re-seeding the identical object is a no-op.
  await page.addInitScript((seed) => {
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(seed));
  }, SEED);
  let coarse = false;
  const hs = [];
  for (const route of ROUTES) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const rh = await page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .filter((el) => el.offsetParent !== null)
          .map((el) => Math.round(el.getBoundingClientRect().height)),
      SELECTOR,
    );
    hs.push(...rh);
  }
  await ctx.close();
  return { hs, coarse };
}

const touch = await heights({ hasTouch: true });
const mouse = await heights({ hasTouch: false });

// If the emulation does not actually flip the media query, everything below is
// measuring the same thing twice and passing for the wrong reason.
check(touch.coarse === true, 'touch emulation reports pointer: coarse');
check(mouse.coarse === false, 'desktop emulation reports a fine pointer');
check(touch.hs.length > 0, `found controls to measure across ${ROUTES.join(', ')} (${touch.hs.length} visible)`);

const short = touch.hs.filter((h) => h < MIN);
check(short.length === 0, `every visible control is >=${MIN}px on touch (smallest ${Math.min(...touch.hs)}px)`);

// The whole point of scoping it to coarse pointers: desktop stays compact.
const grew = Math.min(...mouse.hs) < MIN;
check(grew, `a mouse still gets the compact sizes (smallest ${Math.min(...mouse.hs)}px) — the rule is not global`);

await browser.close();
server.close();
console.log(fails ? `\n${fails} failure(s).` : '\nAll web touch checks passed.');
process.exit(fails ? 1 : 0);
