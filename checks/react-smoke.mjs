/*
 * React app smoke test.
 *
 * Serves the BUILT output of apps/web and apps/coach and drives them in a real
 * browser. A green `vite build` only proves the modules resolved; this proves
 * the app renders, the guided set flow logs a set, autoregulation moves the
 * next weight, and the coach's session survives the emit contract.
 *
 * Run: node checks/react-smoke.mjs   (from the repo root)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { launchChromium } from './_chromium.mjs';

const root = resolve(process.cwd(), process.argv[2] || '.');
let failures = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log('PASS — ' + name);
  } catch (e) {
    console.log('FAIL — ' + name + ': ' + e.message);
    failures += 1;
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

/** One server, both apps: / is the athlete app, /coach/ is the builder. */
function serve(port) {
  const web = resolve(root, 'apps/web/dist');
  const coach = resolve(root, 'apps/coach/dist');
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const isCoach = p === '/coach' || p.startsWith('/coach/');
      const base = isCoach ? coach : web;
      if (isCoach) p = p.replace(/^\/coach\/?/, '/') || '/';
      let file = join(base, p);
      if (p === '/' || !existsSync(file)) file = join(base, 'index.html'); // SPA fallback
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

const PORT = 4317;
const server = await serve(PORT);
const base = 'http://127.0.0.1:' + PORT;

const { browser, skip } = await launchChromium();
if (skip) {
  console.log('SKIP — react-smoke: ' + skip + '.');
  server.close();
  process.exit(0);
}

const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/service worker|manifest|favicon|icon-/i.test(m.text())) errors.push(m.text());
});

/* ---------- athlete app ---------- */

// Seed a library workout BEFORE the app boots, so the first render already has
// something to start — mirroring an athlete who already uses the app.
//
// addInitScript runs before EVERY document load, not just the first, so this
// must not clobber what the app has since written. Seeding unconditionally
// resets the store on every reload and navigation, which looks exactly like the
// app losing the athlete's live session.
await page.addInitScript(() => {
  if (localStorage.getItem('hybrid-engine-v1')) return;
  localStorage.setItem(
    'hybrid-engine-v1',
    JSON.stringify({
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
                  cue: 'Prescribed load: 100kg',
                  sets: [
                    { t: 'W10', rpe: '' },
                    { t: '5', rpe: '8' },
                    { t: '5', rpe: '8' },
                  ],
                },
              ],
            },
          ],
        },
      ],
      sessions: [],
      settings: { profile: { age: 30, restingHr: 50 } },
    }),
  );
});

await page.goto(base + '/', { waitUntil: 'networkidle' });

await t('athlete app mounts and renders Home', async () => {
  await page.waitForSelector('h1', { timeout: 5000 });
  const txt = await page.textContent('body');
  assert(/Readiness/.test(txt), 'Readiness card missing');
  assert(/Your zones today/.test(txt), 'zone card missing');
});

await t('zones are computed by Karvonen when a resting HR is known', async () => {
  const txt = await page.textContent('body');
  assert(/Karvonen · resting 50/.test(txt), 'expected Karvonen method line, got: ' + txt.slice(0, 400));
});

await t("today's plan surfaces the seeded workout", async () => {
  const txt = await page.textContent('body');
  assert(/Lower A/.test(txt), 'seeded workout not shown on Home');
});

await t('Training starts a session without one existing beforehand', async () => {
  await page.click('a[href="/training"]');
  await page.waitForSelector('text=Start a session');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.length);
  assert(before === 0, 'a session existed before Start was pressed — phantom session regression');
  await page.click('button:has-text("Start")');
  await page.waitForSelector('text=In progress');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.length);
  assert(after === 1, 'Start did not create exactly one session, got ' + after);
});

await t('the coach cue reaches the athlete card', async () => {
  const txt = await page.textContent('body');
  assert(/Prescribed load: 100kg/.test(txt), 'ex.cue not rendered on the session list');
});

await t('opening an exercise goes full-screen with no bottom nav', async () => {
  await page.click('button:has-text("Back Squat")');
  await page.waitForURL(/\/log\/0\/0/);
  // Wait for the stage to actually commit before asserting what is NOT on
  // screen — the URL changes before React finishes rendering, so checking too
  // early tests the previous screen.
  await page.waitForSelector('button:has-text("Finish Set")');
  const nav = await page.$('nav[aria-label="Main"]');
  assert(!nav, 'bottom nav is visible on the logger — the stage is meant to be full-screen');
  const txt = await page.textContent('body');
  assert(/Set 1 of 3/.test(txt), 'set tracker missing');
  assert(/warm-up/.test(txt), 'W10 was not recognised as a warm-up');
});

await t('a warm-up does NOT move the working weight', async () => {
  await page.fill('input[aria-label="Weight"]', '40');
  await page.fill('input[aria-label="Reps"]', '10');
  await page.click('button:has-text("Finish Set")');
  await page.click('button:has-text("Confirm Set")');
  const next = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return db.sessions[0].blocks[0].exercises[0].sets[1].aVal;
  });
  assert(!next, 'a warm-up wrote a prescription onto the next set: ' + next);
});

await t('a working set is logged and autoregulation moves the next one', async () => {
  // The warm-up had rest 120, so the stage is mid-rest; skip it.
  const skip = await page.$('button:has-text("Skip Rest")');
  if (skip) await skip.click();
  await page.waitForSelector('text=Set 2 of 3');
  await page.fill('input[aria-label="Weight"]', '100');
  await page.fill('input[aria-label="Reps"]', '5');
  await page.click('button:has-text("Finish Set")');
  // Rate it easy (RPE 6.5 against a target of 8) so the weight must go UP.
  await page.fill('input[aria-label="RPE from 1 to 10"]', '6.5');
  await page.click('button:has-text("Confirm Set")');

  const state = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const sets = db.sessions[0].blocks[0].exercises[0].sets;
    return { logged: sets[1], next: sets[2].aVal };
  });
  assert(state.logged.done === true, 'set 2 not marked done');
  assert(state.logged.aVal === '100' && state.logged.aVal2 === '5', 'values not stored: ' + JSON.stringify(state.logged));
  assert(state.logged.felt === '6.5', 'felt RPE not stored: ' + state.logged.felt);
  // 100 × (1 + (8 − 6.5) × 2.5/100) = 103.75, snapped to the 2.5kg increment:
  // 103.75 / 2.5 = 41.5, and Math.round rounds a half up, so 42 × 2.5 = 105.
  // This is the shipped app's arithmetic exactly — the golden vectors pin all
  // 672 combinations of it.
  assert(state.next === '105', 'expected next set prefilled at 105, got ' + state.next);
});

await t('the rest timer survives a reload', async () => {
  const running = await page.evaluate(() => Number(localStorage.getItem('hybrid-engine-v1-rest-ends')) > Date.now());
  assert(running, 'rest end time was not persisted');
  await page.reload({ waitUntil: 'networkidle' });
  const still = await page.evaluate(() => Number(localStorage.getItem('hybrid-engine-v1-rest-ends')) > Date.now());
  assert(still, 'rest did not survive the reload');
});

await t('a weight of 1e309 cannot poison the record', async () => {
  await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Skip Rest"), button:has-text("Finish Set")');
  const skip = await page.$('button:has-text("Skip Rest")');
  if (skip) await skip.click();
  await page.waitForSelector('input[aria-label="Weight"]');
  await page.fill('input[aria-label="Weight"]', '1e309');
  await page.fill('input[aria-label="Reps"]', '3');
  await page.click('button:has-text("Finish Set")');
  await page.click('button:has-text("Confirm Set")');
  const stored = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return db.sessions[0].blocks[0].exercises[0].sets[2].aVal;
  });
  assert(Number.isFinite(Number(stored)), 'a non-finite weight reached storage: ' + stored);
});

await t('finishing a session lands on the recap, with the numbers', async () => {
  await page.goto(base + '/training', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Finish session")');
  await page.waitForURL(/\/recap\//);
  await page.waitForSelector('text=Volume', { timeout: 5000 }).catch(() => {});
  const txt = await page.textContent('body');
  assert(
    /Volume/.test(txt) && /Working sets/.test(txt),
    'recap stats missing at ' + page.url() + ' — body: ' + txt.slice(0, 200),
  );
  // The warm-up must not be counted as a working set.
  assert(!/Working sets[\s\S]{0,40}\b3\b/.test(txt), 'warm-up appears to have been counted as working');
});

await t('History shows the finished work', async () => {
  await page.goto(base + '/history', { waitUntil: 'networkidle' });
  const txt = await page.textContent('body');
  assert(/Lower A/.test(txt), 'finished session missing from History');
});

await t('Progress renders trends without a chart library', async () => {
  await page.goto(base + '/progress', { waitUntil: 'networkidle' });
  const txt = await page.textContent('body');
  assert(/Weekly volume|Top lifts|Not enough logged/.test(txt), 'Progress rendered nothing: ' + txt.slice(0, 200));
});

await t('Calendar marks a trained day differently from a planned one', async () => {
  await page.goto(base + '/calendar', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=trained');
  const trained = await page.$$('[title="trained"]');
  assert(trained.length >= 1, 'the session logged above should mark today as trained');
});

await t('Settings offers cloud sign-in and a WHOOP connect', async () => {
  await page.goto(base + '/settings', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Cloud sync');
  const txt = await page.textContent('body');
  assert(/Sign in/.test(txt), 'no sign-in control');
  assert(/Connect WHOOP/.test(txt), 'no WHOOP connect control');
  // The functions are not served here, so the status call fails. That must
  // degrade to "not connected", never to a broken screen.
  assert(/Karvonen|percent of max/.test(txt), 'zone summary missing after a failed WHOOP status call');
});

/* ---------- planner ---------- */

await t('the Library creates a session and opens it in the plan editor', async () => {
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('button:has-text("New session")');
  await page.waitForURL(/\/planner\//);
  await page.waitForSelector('input[aria-label="session name"]');
  const made = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts.some((w) => w.name === 'New session'),
  );
  assert(made, 'the Library did not write the session it navigated to');
});

await t('the plan editor edits a target and it persists', async () => {
  await page.waitForSelector('input[aria-label="target for set 1"]');
  await page.fill('input[aria-label="target for set 1"]', 'W10');
  await page.fill('input[aria-label="target for set 2"]', '3');
  const stored = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const w = db.workouts.find((x) => x.name === 'New session');
    return w.blocks[0].exercises[0].sets.slice(0, 2).map((s) => s.t);
  });
  assert(stored[0] === 'W10' && stored[1] === '3', 'targets not saved: ' + JSON.stringify(stored));
});

await t('a coach-assigned session is read-only in the plan editor', async () => {
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.workouts.push({
      id: 'coach:zz', origin: 'coach', assignmentId: 'zz', name: 'Coach Session', updatedAt: 1,
      blocks: [{ id: 'b', heading: 'Main', exercises: [{ id: 'e', name: 'Bench', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] }] }],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/planner/coach:zz', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=read-only');
  const ro = await page.getAttribute('input[aria-label="session name"]', 'readonly');
  assert(ro !== null, 'a coach session must not be locally editable');
});

/* ---------- coach app ---------- */

await t('coach builder mounts on the grid', async () => {
  await page.goto(base + '/coach/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=THE Hybrid System');
  // It OPENS on Home — a dashboard of what actually happened — so the
  // authoring tests below have to ask for the week board. Landing on Home is
  // the point of the change, not an accident to work around.
  await page.click('button[aria-label="Plan"]');
  await page.waitForSelector('text=Week 1');
  const txt = await page.textContent('body');
  assert(/Day 1/.test(txt), 'day rows missing from the grid');
  assert(/Create a session/.test(txt), 'empty-cell action missing');
});

await t('creating a session opens the guided flow, and a lift can be authored end to end', async () => {
  await page.click('button:has-text("Create a session")');
  await page.waitForSelector('text=What are we doing?');
  await page.click('button:has-text("Lift")');
  await page.waitForSelector('text=Choose a movement');
  await page.click('button:has-text("Back Squat")');
  await page.waitForSelector('text=How many sets?');
  // Each numeric step's inline "Next" only confirms the value; the control
  // that ADVANCES the flow is the footer's "Next ›", so scope to the footer.
  await page.click('footer button:has-text("Next")');
  await page.waitForSelector('text=How many reps?');
  await page.click('button:has-text("8")');
  await page.click('footer button:has-text("Next")');
  await page.waitForSelector('text=How hard should it feel?');
  await page.click('button:has-text("RPE 8")');
  await page.click('footer button:has-text("Next")');
  await page.waitForSelector('text=Anything else?');
  await page.click('button:has-text("Done")');
  // Committing lands on the review screen — its add-block control (fullwidth
  // ＋ in the label, so match on the words) is the tell.
  await page.waitForSelector('button:has-text("Add another block")');
  const txt = await page.textContent('body');
  assert(/Back Squat/.test(txt), 'authored exercise missing from the review screen');
});

await t('a warm-up set skips the RPE step', async () => {
  await page.click('button:has-text("Add another block")');
  await page.waitForSelector('text=What are we doing?');
  await page.click('button:has-text("Lift")');
  await page.waitForSelector('text=Choose a movement');
  await page.click('button:has-text("Back Squat")');
  await page.waitForSelector('text=How many sets?');
  await page.click('footer button:has-text("Next")');
  await page.waitForSelector('text=How many reps?');
  // The only checkbox on this step is "This is a warm-up".
  await page.click('input[type="checkbox"]');
  await page.click('button:has-text("5")');
  await page.click('footer button:has-text("Next")');
  // Nothing in a warm-up counts toward autoregulation, so the flow must land
  // straight on the "more" step — never the RPE question.
  await page.waitForSelector('text=Anything else?');
  const txt = await page.textContent('body');
  assert(!/How hard should it feel\?/.test(txt), 'a warm-up set should skip straight past the RPE step');
  // Commit this block too, so the publish test starts from the review screen.
  await page.click('button:has-text("Done")');
  await page.waitForSelector('button:has-text("Add another block")');
});

await t('publish reachable, and validates against the emit contract signed out', async () => {
  await page.click('button:has-text("Continue to publish")');
  await page.waitForSelector('text=Ready to send');
  // Signed out, publish degrades to validate-only — the coach still learns
  // whether the session would cross the boundary cleanly. The result lands in
  // the status line, so read THAT rather than the whole body: the screen's
  // static copy already says "Ready to send" / "Sign in to send…" before the
  // button is pressed, and matching it would prove nothing.
  await page.click('button:has-text("Validate & publish")');
  await page.waitForSelector('[role="status"]');
  const status = await page.textContent('[role="status"]');
  assert(!/Could not validate/.test(status), 'emit contract rejected a valid session: ' + status);
  assert(/Ready to send/.test(status), 'validation did not report success: ' + status);
  assert(/sign in to send this to an athlete/i.test(status), 'signed-out state should explain what is missing');
});

await t('no uncaught page errors across either app', async () => {
  assert(errors.length === 0, errors.join(' | '));
});

await browser.close();
server.close();
console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll React smoke checks passed.');
process.exit(failures ? 1 : 0);
