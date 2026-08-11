/*
 * Drive the single-file athlete artifact the way the artifact host will.
 *
 * "It built" and "it works" are different claims, and for this output they fail
 * apart in ways a build cannot see: the bundle can be perfect while the document
 * still boots blank because a service worker rejected, a fetch to a backend that
 * is not there threw, or a route rendered the catch-all. So this loads the real
 * file, walks every athlete route, and fails on a console error, a page error,
 * or a screen that came up empty.
 *
 * Two details that make this a real rehearsal rather than a friendly one:
 *   - The file is WRAPPED in a <!doctype>/<head>/<body> skeleton first, because
 *     that is what the host does to it. Testing the bare fragment would test a
 *     document that never ships.
 *   - It is SERVED over http rather than opened over file://, because file:// is
 *     an opaque origin where localStorage throws — the app would look broken
 *     here for a reason that would never happen in the artifact.
 *
 * Run: node checks/artifact-smoke.mjs [artifactFile] [outDir]
 */
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchChromium } from './_chromium.mjs';

const root = resolve(process.cwd(), '.');
const FILE = resolve(root, process.argv[2] || 'apps/web/dist-artifact/athlete.html');
const OUT = resolve(root, process.argv[3] || '.artifact-screens');
/* 6 on the hybrid build, which carries both training tabs; 5 on the two
   branded builds, which each own one discipline. See navTabs (BottomNav.tsx). */
const EXPECTED_TABS = Number(process.argv[4] || 6);

if (!existsSync(FILE)) {
  console.error('Build first: node scripts/build-artifact.mjs');
  process.exit(1);
}

/* The host's wrapper, reproduced. Nothing else is added — if the page needs
   something this skeleton does not provide, that is a real defect in the file. */
const fragment = await readFile(FILE, 'utf8');
const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${fragment}</body></html>`;

const PORT = 4521;
const server = await new Promise((ok) => {
  const s = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(doc);
  });
  s.listen(PORT, () => ok(s));
});
const base = 'http://127.0.0.1:' + PORT;

const { browser, skip } = await launchChromium();
if (skip) {
  console.error('the artifact smoke test needs a browser: ' + skip + '.');
  server.close();
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text());
});
/* An unanswered request is the failure mode this whole build exists to prevent:
   in the real artifact the CSP blocks it outright. Anything leaving the document
   is a bug regardless of whether the app happens to survive it. */
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) {
    problems.push('external request: ' + u);
  }
});

/* HashRouter, because the build sets VITE_SINGLE_HTML. Every route is a #/path. */
const ROUTES = [
  /* Home's own address. `#/` is the coach bench on this unscoped build, and the
     boot shim redirects an empty hash here — asserted separately below. */
  ['home', '#/home', 'Train today'],
  ['training', '#/training', null],
  ['library', '#/library', 'Your library'],
  ['conditioning', '#/conditioning', 'Set up'],
  ['history', '#/history', null],
  ['progress', '#/progress', 'Is the training working?'],
  ['calendar', '#/calendar', null],
  ['settings', '#/settings', null],
  ['nutrition', '#/nutrition', null],
  ['logger', '#/log/0/0', null],
  ['planner', '#/planner/w1', null],
];

let failed = 0;
for (const [label, hash, expect] of ROUTES) {
  try {
    await page.goto(base + '/' + hash, { waitUntil: 'load' });
    await page.waitForTimeout(400);

    /* Did anything actually mount? A blank #root is the exact symptom of a
       document that built cleanly and died on boot. */
    const text = (await page.locator('#root').innerText().catch(() => '')).trim();
    if (text.length < 20) {
      problems.push(`${label}: #root is empty — the app did not mount on this route`);
      failed++;
    } else if (expect && !text.includes(expect)) {
      problems.push(`${label}: expected to find ${JSON.stringify(expect)} on this screen`);
      failed++;
    }

    await page.screenshot({ path: join(OUT, label + '.png'), fullPage: true });
    console.log('  ' + label + (text.length < 20 ? '  — EMPTY' : ''));
  } catch (e) {
    problems.push(label + ': ' + e.message);
    failed++;
    console.log('  ' + label + ' — FAILED: ' + e.message);
  }
}

/* The nav is the claim that this is the whole app and not one screen.
   Checked from Home specifically: the Logger and the plan editor sit OUTSIDE the
   shell by design (App.tsx) so nothing competes with the work in front of you,
   and the loop above ends on the planner — asserting from wherever it stopped
   would report a missing nav bar as a defect when it is the intended layout. */
/* Opening the document cold: no hash at all, exactly as a reader arrives. The
   shim must land this on the ATHLETE app — on this build a bare `/` is the coach
   bench, which is the one thing this artifact must not open on. */
await page.evaluate(() => localStorage.clear());
await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(600);
const landedHash = await page.evaluate(() => location.hash);
const landedText = (await page.locator('#root').innerText().catch(() => '')).trim();
console.log('\n  cold open lands on: ' + (landedHash || '(no hash)'));
/* Asserted on what RENDERED, not on the hash: the unscoped build lands on
   `#/home` and the two scoped builds on `#/`, and both are correct. What must
   never happen on any of them is landing on the coach bench. */
if (!landedText.includes('Train today')) {
  problems.push(`cold open did not land on the athlete Home screen (hash ${landedHash || '(none)'})`);
}

const tabs = (await page.locator('nav[aria-label="Main"] a').allInnerTexts().catch(() => [])).map((t) =>
  t.trim().replace(/\s+/g, ' '),
);
console.log('\n  nav tabs: ' + (tabs.length ? tabs.join(' / ') : '(none found)'));
if (tabs.length !== EXPECTED_TABS) {
  problems.push(`expected ${EXPECTED_TABS} nav tabs on Home, found ${tabs.length}: ${tabs.join(' / ')}`);
}

/* The full-screen routes are load-bearing too: a bottom nav appearing over a
   live set would be a regression, so assert the absence rather than assume it. */
await page.goto(base + '/#/log/0/0', { waitUntil: 'load' });
await page.waitForTimeout(400);
if (await page.locator('nav[aria-label="Main"]').count()) {
  problems.push('the Logger is showing the bottom nav — it is meant to be full-screen');
}

/*
 * The nutrition world is the third surface in this one document, and it is not
 * a route under the training nav — it is a hard swap of the whole route tree
 * and nav bar (App.tsx forks on `world`). "Everything in one file" is only true
 * if that swap actually works here, so drive it the way an athlete would:
 * through the switch on Settings, and back again.
 */
await page.goto(base + '/#/settings', { waitUntil: 'load' });
await page.waitForTimeout(400);
const toNutrition = page.getByRole('button', { name: /Go to Nutrition/i });
if (!(await toNutrition.count())) {
  problems.push('Settings has no way into the nutrition world');
} else {
  await toNutrition.first().click();
  await page.waitForTimeout(600);
  const nutritionText = (await page.locator('#root').innerText().catch(() => '')).trim();
  const nutritionTabs = await page.locator('nav a').allInnerTexts().catch(() => []);
  console.log('  nutrition world tabs: ' + nutritionTabs.map((t) => t.trim()).join(' / '));
  if (nutritionTabs.length !== 5) {
    problems.push(`nutrition world should have 5 tabs, found ${nutritionTabs.length}`);
  }
  if (nutritionText.length < 20) problems.push('the nutrition world mounted empty');
  await page.screenshot({ path: join(OUT, 'nutrition-world.png'), fullPage: true });

  /* Back out again. A one-way door would strand the athlete in a world with no
     training in it, which is worse than not having the door. */
  await page.goto(base + '/#/nutrition/settings', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  /* "← Back to training", not "Go to training": one shared WorldSwitch renders
     in both directions and labels itself by destination (WorldSwitch.tsx). */
  const toTraining = page.getByRole('button', { name: /Back to training/i });
  if (!(await toTraining.count())) {
    problems.push('the nutrition world has no way back to training');
  } else {
    await toTraining.first().click();
    await page.waitForTimeout(600);
    const backText = (await page.locator('#root').innerText().catch(() => '')).trim();
    if (!backText.includes('Train today') && !(await page.locator('nav[aria-label="Main"]').count())) {
      problems.push('switching back from nutrition did not return to the training world');
    }
  }
}

/* The coach bench is reachable at #/coach on this build, so it is part of the
   document whether or not it is the point of it. CoachAccess denies by
   navigating to `/`, which redirects to `/coach` — a loop that would hang the
   file. Demo mode is compiled in to prevent that; this proves it. */
await page.goto(base + '/#/coach', { waitUntil: 'load' });
await page.waitForTimeout(900);
const coachText = (await page.locator('#root').innerText().catch(() => '')).trim();
if (coachText.length < 20) problems.push('#/coach renders empty — likely the deny/redirect loop');

await browser.close();
server.close();

const unique = [...new Set(problems)];
if (unique.length) {
  console.log('\nProblems (these are real — the artifact ships broken until they are fixed):');
  for (const p of unique) console.log('  ' + p);
  process.exit(1);
}
console.log(`\nAll ${ROUTES.length} athlete routes mount and render, no console errors, nothing left the document.`);
