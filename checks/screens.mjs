/*
 * Screenshot every screen of the athlete web app, against a realistically
 * populated database.
 *
 * This is not a test — nothing here can fail except the harness itself. It
 * exists so a visual change can be judged by looking at it, before and after,
 * instead of by reading a diff and imagining the result.
 *
 * The seed matters as much as the harness. An app screenshotted with an empty
 * store shows nothing but empty states, which is the one thing a design pass must
 * NOT be tuned against — every screen looks calm when there is nothing in it.
 * So this seeds eight weeks of plausible training: logged sessions with real
 * set data, conditioning with HR traces, a WHOOP reading, and PR-worthy lifts.
 *
 * Run: node checks/screens.mjs [outDir]     (after `pnpm run build`)
 */
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { launchChromium } from './_chromium.mjs';
import { buildSeed } from './_seed.mjs';

const root = resolve(process.cwd(), '.');
const OUT = resolve(root, process.argv[2] || '.screens');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

function serve(port) {
  const web = resolve(root, 'apps/web/dist');
  if (!existsSync(web)) {
    console.error('Build first: pnpm run build');
    process.exit(1);
  }
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = join(web, p);
      if (p === '/' || !existsSync(file)) file = join(web, 'index.html');
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


const SHOTS = [
  // [label, path, waitForText]
  // `/home`, not `/`: the unscoped dashboard build this shoots sends `/` to
  // the coach bench, and Home's own path is the one address that renders the
  // athlete Home screen on every build.
  ['01-home', '/home', null],
  ['02-training', '/training', null],
  ['03-library', '/library', null],
  ['04-conditioning', '/conditioning', null],
  ['05-history', '/history', null],
  ['06-progress', '/progress', null],
  ['07-calendar', '/calendar', null],
  ['08-settings', '/settings', null],
  ['09-planner', '/planner/w1', null],
  ['10-logger', '/log/0/0', null],
  // The third world's web surface. Home (01) carries the nutrition card above
  // it, so the two are judged together.
  ['11-nutrition', '/nutrition', null],
];

const PORT = 4519;
const server = await serve(PORT);
const base = 'http://127.0.0.1:' + PORT;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Fatal here, unlike the other checks: a screenshot run with no browser has
// nothing to produce, so skipping would report success and write no images.
const { browser, skip } = await launchChromium();
if (skip) {
  console.error('screenshots need a browser: ' + skip + '.');
  server.close();
  process.exit(1);
}

const seed = buildSeed();

/* Phone-sized, because that is where this app is actually used. deviceScaleFactor
   2 so hairlines and the brass edge survive being looked at. */
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text());
});

/*
 * addInitScript runs before EVERY document load, not just the first. Seeding
 * unconditionally would reset the store on every navigation — which is exactly
 * what a lost session looks like.
 */
await page.addInitScript((s) => {
  if (!localStorage.getItem('hybrid-engine-v1')) {
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(s.db));
  }
  // Its own key, checked independently: the two slices are separate stores and
  // seeding them together under one guard would make a nutrition-only reset
  // look like a training reset.
  if (!localStorage.getItem('hybrid-nutrition-v1')) {
    localStorage.setItem('hybrid-nutrition-v1', JSON.stringify(s.nutrition));
  }
}, seed);

await page.route('**/.netlify/functions/integrations-status*', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seed.whoopStatus) }),
);
// refresh() calls sync() when today's sample looks stale; answer it so the card
// does not screenshot mid-error.
await page.route('**/.netlify/functions/whoop-sync*', (r) =>
  r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ connected: true, normalized: seed.whoopStatus.whoop.normalized }),
  }),
);

for (const [label, path] of SHOTS) {
  try {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350); // let entrance transitions settle
    await page.screenshot({ path: join(OUT, label + '.png'), fullPage: true });
    console.log('  ' + label);
  } catch (e) {
    console.log('  ' + label + ' — FAILED: ' + e.message);
    problems.push(label + ': ' + e.message);
  }
}

await browser.close();
server.close();

console.log('\nWrote ' + SHOTS.length + ' athlete screens to ' + OUT);
if (problems.length) {
  console.log('\nProblems observed while capturing (these are real, fix them):');
  for (const p of [...new Set(problems)]) console.log('  ' + p);
}
