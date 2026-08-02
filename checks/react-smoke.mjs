/*
 * React app smoke test.
 *
 * Serves the BUILT output of apps/web and drives it in a real browser. A
 * green `vite build` only proves the modules resolved; this proves the app
 * renders, the guided set flow logs a set, and autoregulation moves the
 * next weight.
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

/** Serves the athlete app's built output. */
function serve(port) {
  const web = resolve(root, 'apps/web/dist');
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = join(web, p);
      if (p === '/' || !existsSync(file)) file = join(web, 'index.html'); // SPA fallback
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
  await Promise.all([
    page.click('button:has-text("Start")'),
    page.click('button:has-text("Start")').catch(() => {}),
  ]);
  await page.waitForSelector('text=In progress');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.length);
  assert(after === 1, 'Start did not create exactly one session, got ' + after);
});

await t('the exercise cue reaches the athlete card', async () => {
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

await t('a warm-up confirms in one tap, records no felt RPE, and does NOT move the working weight', async () => {
  await page.fill('input[aria-label="Weight"]', '40');
  await page.fill('input[aria-label="Reps"]', '10');
  // A warm-up is never rated: Finish Set confirms directly — no RPE stage,
  // no Confirm Set. The stored set must carry no `felt` either.
  await page.click('button:has-text("Finish Set")');
  // The RPE question must never have rendered for a warm-up — not "flashed
  // and moved on", never appeared at all.
  const txtAfterFinish = await page.textContent('body');
  assert(!/How hard was that/.test(txtAfterFinish), 'the RPE stage appeared for a warm-up set');
  const after = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const sets = db.sessions[0].blocks[0].exercises[0].sets;
    return { felt: sets[0].felt, done: sets[0].done, next: sets[1].aVal };
  });
  assert(after.done === true, 'the warm-up set should be logged by Finish Set alone');
  assert(after.felt === undefined, 'a warm-up must not record a felt RPE, got: ' + after.felt);
  assert(!after.next, 'a warm-up wrote a prescription onto the next set: ' + after.next);
});

await t('the rest control reads "Skip rest", lowercase r', async () => {
  // The warm-up had rest 120, so the stage is mid-rest. Playwright's
  // :has-text() is a case-insensitive substring match, so it would happily
  // click "Skip Rest" too — read the literal DOM text instead to pin the
  // casing consistency batch actually landed.
  await page.waitForSelector('button:has-text("Skip rest")');
  const txt = await page.textContent('body');
  // No word boundary after "rest": the DOM's text nodes butt straight up
  // against the next element's text with no space, so \b there never matches.
  assert(txt.includes('Skip rest'), 'expected the literal "Skip rest" control, got: ' + txt.slice(0, 200));
  assert(!txt.includes('Skip Rest'), 'the rest control regressed to title-case "Skip Rest"');
});

await t('a working set is logged and autoregulation moves the next one', async () => {
  const skip = await page.$('button:has-text("Skip rest")');
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

await t('a working weight shown with no WHOOP data connected names the missing reason', async () => {
  // No WHOOP sample exists anywhere in this file's seed data, so this is the
  // default state for any athlete without a connected strap — not a
  // special-cased fixture.
  //
  // This scenario requires the session to be sitting on Set 3 of 3 (the
  // second, un-warmed-up working set) — the earlier scenarios in this file
  // log the warm-up and Set 2 in sequence, leaving Set 3 as the only set
  // still open when this runs. Moving this test earlier would land on the
  // warm-up (isWarmup === true), which never renders this note at all.
  //
  // The settings.liftProgress write below is permanent for the rest of this
  // script (every later Logger visit sees this earned weight) — traced
  // against every remaining scenario and confirmed harmless: nothing after
  // this reads liftProgress except by filling the weight field explicitly.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.settings.liftProgress = Object.assign({}, db.settings.liftProgress, {
      'back squat': { kg: 105, at: Date.now() - 1000 },
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Skip rest"), button:has-text("Finish Set")');
  const skip = await page.$('button:has-text("Skip rest")');
  if (skip) await skip.click();
  await page.waitForSelector('input[aria-label="Weight"]');
  const txt = await page.textContent('body');
  assert(/earned 105kg last time · no recovery data today/.test(txt), 'expected the composed earned-weight-plus-reason note, got: ' + txt.slice(0, 400));
});

await t('a working weight shown with a connected WHOOP is NOT marked with a recovery-data reason', async () => {
  // Mirrors checks/screens.mjs's WHOOP-connected mock (route interception,
  // not localStorage — WHOOP state is fetched on mount, never persisted).
  await page.route('**/.netlify/functions/integrations-status*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        whoop: {
          connected: true,
          lastSyncAt: new Date().toISOString(),
          normalized: { recoveryScore: 68, restingHr: 48, strain: 12.4, date: new Date().toISOString().slice(0, 10), at: Date.now() },
        },
      }),
    }),
  );
  await page.route('**/.netlify/functions/whoop-sync*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        connected: true,
        normalized: { recoveryScore: 68, restingHr: 48, strain: 12.4, date: new Date().toISOString().slice(0, 10), at: Date.now() },
      }),
    }),
  );
  try {
    await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
    await page.waitForSelector('button:has-text("Skip rest"), button:has-text("Finish Set")');
    const skip = await page.$('button:has-text("Skip rest")');
    if (skip) await skip.click();
    await page.waitForSelector('input[aria-label="Weight"]');
    const txt = await page.textContent('body');
    assert(/earned 105kg last time/.test(txt), 'expected the earned-weight note with a connected WHOOP, got: ' + txt.slice(0, 400));
    assert(!/no recovery data today/.test(txt), 'a connected WHOOP should never show the no-recovery-data reason, got: ' + txt.slice(0, 400));
  } finally {
    // MUST unroute before the later 'Settings offers cloud sign-in and a
    // WHOOP connect' scenario runs — that test specifically asserts the
    // WHOOP status call FAILS (no functions are served in this static test
    // server) and the app degrades gracefully. A route left active here
    // would silently break that later, unrelated test.
    await page.unroute('**/.netlify/functions/integrations-status*');
    await page.unroute('**/.netlify/functions/whoop-sync*');
  }
});

await t('a consistent 2-session on-target streak surfaces an opt-in load suggestion, and Apply writes it into the field', async () => {
  // Seed 3 completed, standalone sessions for 'Front squat' — independent of
  // the live session state the earlier scenarios in this file built up —
  // each on-target against an 8-10 rep-range target, so the last two count
  // as a consistent streak per decideStrengthProgression's own rule.
  //
  // Logged at TEN reps — the top of that 8-10 range, which is exactly what the
  // Reps field is already prefilled with. A suggestion is only offered when it
  // beats what the fields already show, so a history of 8s produces silence
  // (correctly: "try 9 reps" over a field reading 10 is a downgrade). What is
  // left here is the load axis: 100kg → 102.5kg.
  //
  // The suggestion only ever renders on the FIRST working set of an exercise
  // (`isFirstWorkingSet` in Logger.tsx), but by this point in the suite the
  // shared main session (used by every scenario above and by "a weight of
  // 1e309 cannot poison the record" and "finishing a session..." right
  // after this one) is already sitting on its SECOND working set — Set 3 of
  // 3. Rather than disturb that shared session's position (which those
  // later, order-dependent scenarios rely on), this scenario temporarily
  // swaps in its own isolated active session — a fresh Front squat exercise
  // with no warm-up, so its very first set is already the first working
  // set — then restores the original session's 'active' status and removes
  // its own scratch session/workout before returning, so nothing below is
  // able to tell this ever ran.
  const orig = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const onTargetSet = (reps) => ({
      done: true, aVal: '100', aVal2: String(reps), felt: '8', t: '8-10', rpe: '8',
    });
    const histSession = (id, at, reps) => ({
      id, date: '2026-01-01', status: 'completed', completedAt: at,
      blocks: [{
        id: 'b', heading: 'Main', superset: false,
        exercises: [{ id: 'e', name: 'Front squat', mode: 'reps_kg', rest: 90, sets: [onTargetSet(reps)] }],
      }],
    });
    db.sessions.push(
      histSession('strength-hist-1', 1000, 10),
      histSession('strength-hist-2', 2000, 10),
      histSession('strength-hist-3', 3000, 10),
    );

    const origSession = db.sessions.find((s) => s.status === 'active');
    origSession.status = 'incomplete';

    db.workouts.push({
      id: 'w-strength-scratch', name: 'Strength scratch', days: [], updatedAt: Date.now(),
      blocks: [{
        id: 'sb', heading: 'Main', superset: false,
        exercises: [{ id: 'se', name: 'Front squat', mode: 'reps_kg', rest: 90, sets: [{ t: '8-10', rpe: '8' }] }],
      }],
    });
    db.sessions.push({
      id: 'strength-scratch-session', name: 'Strength scratch', date: '2026-08-02', status: 'active',
      startedAt: Date.now(), workoutId: 'w-strength-scratch',
      blocks: [{
        id: 'sb', heading: 'Main', superset: false,
        exercises: [{ id: 'se', name: 'Front squat', mode: 'reps_kg', rest: 90, sets: [{ t: '8-10', rpe: '8' }] }],
      }],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return { id: origSession.id };
  });

  await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Skip rest"), button:has-text("Finish Set")');
  const skip = await page.$('button:has-text("Skip rest")');
  if (skip) await skip.click();
  await page.waitForSelector('input[aria-label="Weight"]');
  const txt = await page.textContent('body');
  assert(/On target the last 2 sessions/.test(txt), 'expected the strength suggestion note, got: ' + txt.slice(0, 400));
  assert(/Apply/.test(txt), 'expected an Apply control, got: ' + txt.slice(0, 400));

  // What the fields ALREADY show, before anything is applied — a suggestion is
  // only honest if it beats these. ('Front squat' rather than the Back Squat an
  // earlier scenario banked a liftProgress entry for, so this prefill comes from
  // the seeded history above and nothing else.)
  const kgBefore = await page.inputValue('input[aria-label="Weight"]');
  const repsBefore = await page.inputValue('input[aria-label="Reps"]');
  assert(kgBefore === '100', 'expected the weight field prefilled from the seeded history, got: ' + kgBefore);
  assert(repsBefore === '10', 'expected the reps field prefilled at the rep-range top, got: ' + repsBefore);

  // Confirm Apply never touched settings.liftProgress — the write goes
  // through the same local field the athlete's own typing uses, not a
  // separate path. An earlier scenario in this file already permanently set
  // settings.liftProgress['back squat'], so this must compare before/after
  // rather than assert absence.
  const liftProgressBefore = await page.evaluate(
    () => JSON.stringify(JSON.parse(localStorage.getItem('hybrid-engine-v1')).settings.liftProgress || null),
  );

  await page.click('button:has-text("Apply")');
  const kg = await page.inputValue('input[aria-label="Weight"]');
  assert(kg === '102.5', 'expected Apply to write the suggested load into the Weight field, got: ' + kg);
  // And it moved the number FORWARD — the whole point of the fix. The Reps
  // field is untouched at the top of the planned range.
  const reps = await page.inputValue('input[aria-label="Reps"]');
  assert(reps === '10', 'expected the Reps field left at the planned rep top, got: ' + reps);

  const liftProgressAfter = await page.evaluate(
    () => JSON.stringify(JSON.parse(localStorage.getItem('hybrid-engine-v1')).settings.liftProgress || null),
  );
  assert(
    liftProgressAfter === liftProgressBefore,
    'Apply must not write to settings.liftProgress — it only fills the editable field',
  );

  // Restore the shared main session and drop the scratch workout/session, so
  // every scenario below sees exactly the state it would have without this
  // one having run.
  await page.evaluate(({ origId }) => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.sessions = db.sessions.filter(
      (s) => s.id !== 'strength-scratch-session' && !s.id.startsWith('strength-hist-'),
    );
    db.workouts = db.workouts.filter((w) => w.id !== 'w-strength-scratch');
    const origSession = db.sessions.find((s) => s.id === origId);
    if (origSession) origSession.status = 'active';
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  }, { origId: orig.id });
});

await t('a seconds-mode set shows a Start control, and letting it run to zero fills the field', async () => {
  // Isolated scratch session — same technique as the strength-suggestion
  // scenario above: swap the shared main session out to 'incomplete', seed a
  // standalone `seconds`-mode exercise as its own active session, navigate to
  // it, run the assertion, then restore the original session before
  // returning so nothing below can tell this ran.
  const orig = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const origSession = db.sessions.find((s) => s.status === 'active');
    origSession.status = 'incomplete';
    db.workouts.push({
      id: 'w-timer-scratch', name: 'Timer scratch', days: [], updatedAt: Date.now(),
      blocks: [{
        id: 'tb', heading: 'Main', superset: false,
        exercises: [{ id: 'te', name: 'Plank', mode: 'seconds', rest: 0, sets: [{ t: '2', rpe: '' }] }],
      }],
    });
    db.sessions.push({
      id: 'timer-scratch-session', name: 'Timer scratch', date: '2026-08-02', status: 'active',
      startedAt: Date.now(), workoutId: 'w-timer-scratch',
      blocks: [{
        id: 'tb', heading: 'Main', superset: false,
        exercises: [{ id: 'te', name: 'Plank', mode: 'seconds', rest: 0, sets: [{ t: '2', rpe: '' }] }],
      }],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return { id: origSession.id };
  });

  try {
    await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Secs"]');
    await page.click('button:has-text("Start")');
    // Wait past the 2-second target plus tick margin (the countdown polls
    // every 250ms) — padded generously since this is a real-time wait.
    await page.waitForTimeout(3500);
    const after = await page.inputValue('input[aria-label="Secs"]');
    assert(after === '2', 'expected the field to fill with the held duration after running to zero, got: ' + after);
  } finally {
    await page.evaluate(({ origId }) => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      db.sessions = db.sessions.filter((s) => s.id !== 'timer-scratch-session');
      db.workouts = db.workouts.filter((w) => w.id !== 'w-timer-scratch');
      const origSession = db.sessions.find((s) => s.id === origId);
      if (origSession) origSession.status = 'active';
      localStorage.removeItem('hybrid-engine-v1-set-timer-ends');
      localStorage.removeItem('hybrid-engine-v1-set-timer-total');
      localStorage.removeItem('hybrid-engine-v1-set-timer-owner');
      localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    }, { origId: orig.id });
  }
});

await t('stopping a seconds-mode timer early writes the actual elapsed time', async () => {
  // Same isolated-scratch technique, but with a longer target so Stop lands
  // comfortably mid-run rather than racing the natural completion above.
  const orig = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const origSession = db.sessions.find((s) => s.status === 'active');
    origSession.status = 'incomplete';
    db.workouts.push({
      id: 'w-timer-scratch2', name: 'Timer scratch 2', days: [], updatedAt: Date.now(),
      blocks: [{
        id: 'tb', heading: 'Main', superset: false,
        exercises: [{ id: 'te', name: 'Plank', mode: 'seconds', rest: 0, sets: [{ t: '30', rpe: '' }] }],
      }],
    });
    db.sessions.push({
      id: 'timer-scratch-session2', name: 'Timer scratch 2', date: '2026-08-02', status: 'active',
      startedAt: Date.now(), workoutId: 'w-timer-scratch2',
      blocks: [{
        id: 'tb', heading: 'Main', superset: false,
        exercises: [{ id: 'te', name: 'Plank', mode: 'seconds', rest: 0, sets: [{ t: '30', rpe: '' }] }],
      }],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return { id: origSession.id };
  });

  try {
    await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Secs"]');
    const before = await page.inputValue('input[aria-label="Secs"]');
    await page.click('button:has-text("Start")');
    await page.waitForTimeout(1500);
    await page.click('button:has-text("Stop")');
    const after = await page.inputValue('input[aria-label="Secs"]');
    const n = Number(after);
    assert(Number.isFinite(n) && n > 0 && n < 30, 'expected a partial elapsed value strictly between 0 and 30, got: ' + after);
    assert(after !== before, 'the field never changed from its original placeholder value');
  } finally {
    await page.evaluate(({ origId }) => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      db.sessions = db.sessions.filter((s) => s.id !== 'timer-scratch-session2');
      db.workouts = db.workouts.filter((w) => w.id !== 'w-timer-scratch2');
      const origSession = db.sessions.find((s) => s.id === origId);
      if (origSession) origSession.status = 'active';
      localStorage.removeItem('hybrid-engine-v1-set-timer-ends');
      localStorage.removeItem('hybrid-engine-v1-set-timer-total');
      localStorage.removeItem('hybrid-engine-v1-set-timer-owner');
      localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    }, { origId: orig.id });
  }
});

await t('tapping Finish Set mid-countdown logs the seconds actually HELD, not the prefilled target', async () => {
  /*
   * The shipped bug. Finish Set is live for the whole hold, and while the
   * countdown runs the box shows the timer's remaining seconds — but the
   * field's own state was never touched, so it still held the TARGET. An
   * athlete who quit a 30s plank early and tapped Finish Set instead of Stop
   * logged a full 30.
   */
  const orig = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const origSession = db.sessions.find((s) => s.status === 'active');
    origSession.status = 'incomplete';
    const blocks = [{
      id: 'tb3', heading: 'Main', superset: false,
      exercises: [{ id: 'te3', name: 'Plank', mode: 'seconds', rest: 0, sets: [{ t: '30', rpe: '' }] }],
    }];
    db.workouts.push({ id: 'w-timer-scratch3', name: 'Timer scratch 3', days: [], updatedAt: Date.now(), blocks });
    db.sessions.push({
      id: 'timer-scratch-session3', name: 'Timer scratch 3', date: '2026-08-02', status: 'active',
      startedAt: Date.now(), workoutId: 'w-timer-scratch3', blocks: JSON.parse(JSON.stringify(blocks)),
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return { id: origSession.id };
  });

  try {
    await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Secs"]');
    assert(
      (await page.inputValue('input[aria-label="Secs"]')) === '30',
      'the field should open prefilled with the target, which is what made the bug invisible',
    );
    await page.click('button:has-text("Start")');
    await page.waitForTimeout(1500);
    // Finish Set, NOT Stop — the whole point of the regression.
    await page.click('button:has-text("Finish Set")');
    await page.click('button:has-text("Confirm Set")');
    const logged = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      return db.sessions.find((s) => s.id === 'timer-scratch-session3').blocks[0].exercises[0].sets[0];
    });
    assert(logged.done === true, 'the set should be logged');
    const n = Number(logged.aVal);
    assert(Number.isFinite(n) && n > 0 && n < 30, 'expected the seconds actually held, got: ' + logged.aVal);
  } finally {
    await page.evaluate(({ origId }) => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      db.sessions = db.sessions.filter((s) => s.id !== 'timer-scratch-session3');
      db.workouts = db.workouts.filter((w) => w.id !== 'w-timer-scratch3');
      const origSession = db.sessions.find((s) => s.id === origId);
      if (origSession) origSession.status = 'active';
      localStorage.removeItem('hybrid-engine-v1-set-timer-ends');
      localStorage.removeItem('hybrid-engine-v1-set-timer-total');
      localStorage.removeItem('hybrid-engine-v1-set-timer-owner');
      localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    }, { origId: orig.id });
  }
});

await t('a hold that expires while its own field is gone does not write into a different set', async () => {
  /*
   * `finished`/`total` wait in the provider for someone to ack them, and the
   * field's effect runs on MOUNT as well as on the transition — so the hold
   * armed on the Plank used to be claimed by whatever seconds field happened
   * to be on screen when it ran out, against a target it had nothing to do
   * with. Two blocks, one hold each, and deliberately different targets so a
   * duration written into the wrong set is unmistakable.
   */
  const orig = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const origSession = db.sessions.find((s) => s.status === 'active');
    origSession.status = 'incomplete';
    const blocks = [
      {
        id: 'tb4a', heading: 'Plank', superset: false,
        exercises: [{ id: 'te4a', name: 'Plank', mode: 'seconds', rest: 0, sets: [{ t: '3', rpe: '' }] }],
      },
      {
        id: 'tb4b', heading: 'Side plank', superset: false,
        exercises: [{ id: 'te4b', name: 'Side plank', mode: 'seconds', rest: 0, sets: [{ t: '45', rpe: '' }] }],
      },
    ];
    db.workouts.push({ id: 'w-timer-scratch4', name: 'Timer scratch 4', days: [], updatedAt: Date.now(), blocks });
    db.sessions.push({
      id: 'timer-scratch-session4', name: 'Timer scratch 4', date: '2026-08-02', status: 'active',
      startedAt: Date.now(), workoutId: 'w-timer-scratch4', blocks: JSON.parse(JSON.stringify(blocks)),
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return { id: origSession.id };
  });

  try {
    await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Secs"]');
    await page.click('button:has-text("Start")');
    // Move to the other hold while the Plank is still counting down.
    await page.click('button:has-text("Side plank")');
    await page.waitForURL(/\/log\/1\/0/);
    // Now let the Plank run out, with only the Side plank's field mounted.
    await page.waitForTimeout(4000);
    const after = await page.inputValue('input[aria-label="Secs"]');
    assert(after === '45', 'the Side plank field should still show its own target, got: ' + after);
    const stored = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      return db.sessions.find((s) => s.id === 'timer-scratch-session4').blocks[1].exercises[0].sets[0].aVal;
    });
    assert(stored == null || stored === '45', 'the Plank\'s seconds were written onto the Side plank: ' + stored);
  } finally {
    await page.evaluate(({ origId }) => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      db.sessions = db.sessions.filter((s) => s.id !== 'timer-scratch-session4');
      db.workouts = db.workouts.filter((w) => w.id !== 'w-timer-scratch4');
      const origSession = db.sessions.find((s) => s.id === origId);
      if (origSession) origSession.status = 'active';
      localStorage.removeItem('hybrid-engine-v1-set-timer-ends');
      localStorage.removeItem('hybrid-engine-v1-set-timer-total');
      localStorage.removeItem('hybrid-engine-v1-set-timer-owner');
      localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    }, { origId: orig.id });
  }
});

await t("a RANGE target like '20-30s' still arms the timer", async () => {
  // The design doc's own motivating example — "20-30s/side Pec Stretch".
  // `Number('20-30s')` is NaN, which fell through to 0 and left Start
  // permanently disabled with nothing on screen to explain why.
  const orig = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const origSession = db.sessions.find((s) => s.status === 'active');
    origSession.status = 'incomplete';
    const blocks = [{
      id: 'tb5', heading: 'Main', superset: false,
      exercises: [{ id: 'te5', name: 'Pec stretch', mode: 'seconds', rest: 0, sets: [{ t: '20-30s', rpe: '' }] }],
    }];
    db.workouts.push({ id: 'w-timer-scratch5', name: 'Timer scratch 5', days: [], updatedAt: Date.now(), blocks });
    db.sessions.push({
      id: 'timer-scratch-session5', name: 'Timer scratch 5', date: '2026-08-02', status: 'active',
      startedAt: Date.now(), workoutId: 'w-timer-scratch5', blocks: JSON.parse(JSON.stringify(blocks)),
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return { id: origSession.id };
  });

  try {
    await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Secs"]');
    assert(
      !(await page.isDisabled('button:has-text("Start")')),
      'Start is disabled on a range target — Number() made NaN of it again',
    );
    await page.click('button:has-text("Start")');
    // Armed at the TOP of the range, which is what the athlete aims at.
    await page.waitForSelector('button:has-text("Stop")');
    const shown = Number(await page.inputValue('input[aria-label="Secs"]'));
    assert(shown > 0 && shown <= 30, 'expected a countdown from the top of the range, got: ' + shown);
  } finally {
    await page.evaluate(({ origId }) => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      db.sessions = db.sessions.filter((s) => s.id !== 'timer-scratch-session5');
      db.workouts = db.workouts.filter((w) => w.id !== 'w-timer-scratch5');
      const origSession = db.sessions.find((s) => s.id === origId);
      if (origSession) origSession.status = 'active';
      localStorage.removeItem('hybrid-engine-v1-set-timer-ends');
      localStorage.removeItem('hybrid-engine-v1-set-timer-total');
      localStorage.removeItem('hybrid-engine-v1-set-timer-owner');
      localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    }, { origId: orig.id });
  }
});

await t('a weight of 1e309 cannot poison the record', async () => {
  await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Skip rest"), button:has-text("Finish Set")');
  const skip = await page.$('button:has-text("Skip rest")');
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

await t('a conditioning run asks how it felt, then if the work was completed, and banks both', async () => {
  // Seed an active session carrying a conditioning block, and make sure it is
  // the only active one — the result sink resolves through activeSession.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    for (const s of db.sessions) if (s.status === 'active') s.status = 'incomplete';
    db.sessions.push({
      id: 'conds1', name: 'Engine day', date: new Date().toISOString().slice(0, 10),
      status: 'active', updatedAt: Date.now(),
      blocks: [{ id: 'condb1', kind: 'conditioning', heading: 'Conditioning', condFmt: 'intervals', effort: 'hard' }],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/conditioning?block=condb1&bi=0', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Start")');
  // A run under MIN_LOGGABLE_SEC (20s) is discarded, and a real 20s wait would
  // double this suite's runtime — skew the page's clock forward instead. The
  // run's 1s tick reads Date.now(), so the next tick banks ~30s of elapsed.
  await page.evaluate(() => {
    const orig = Date.now;
    Date.now = () => orig.call(Date) + 30_000;
  });
  await page.waitForSelector('text=0:3'); // the live clock has ticked past 20s
  await page.click('button:has-text("Finish")');

  // The rating stage, not the result: nothing may be banked until it answers.
  await page.waitForSelector('text=How did that feel?');
  const mid = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.find((s) => s.id === 'conds1').blocks[0].condResult,
  );
  assert(!mid, 'the run banked before the athlete said how it felt');

  // A tap on the nav bar while the chips are up must not throw the run away —
  // the pending record rides the module RUN object for exactly this reason, so
  // coming back re-asks the question. Client-side navigation only: goto would
  // reload the page and reset the module, which is the documented "a run is
  // over when the tab is" case, not the nav-bar case being pinned here.
  await page.click('nav[aria-label="Main"] a[href="/"]');
  await page.waitForSelector('text=Readiness');
  await page.goBack();
  await page.waitForSelector('text=How did that feel?');

  // Answering RPE advances to the SECOND question — mechanical completion —
  // and still banks nothing: both answers must ride in on the same write.
  await page.click('button:has-text("RPE 7")');
  await page.waitForSelector('text=Did you complete the work?');
  const mid2 = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.find((s) => s.id === 'conds1').blocks[0].condResult,
  );
  assert(!mid2, 'the run banked after the first question, before mechanical completion was answered');

  // The NEW interruption point: between the two questions. The pending record
  // — felt answer included — still rides RUN, so a nav-away and return must
  // land back on the second question, not the first and not the setup screen.
  await page.click('nav[aria-label="Main"] a[href="/"]');
  await page.waitForSelector('text=Readiness');
  await page.goBack();
  await page.waitForSelector('text=Did you complete the work?');

  await page.click('button:has-text("Completed it")');
  await page.waitForSelector('text=Banked');
  const rec = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.find((s) => s.id === 'conds1').blocks[0].condResult,
  );
  assert(rec, 'the rated run never reached the block');
  assert(rec.felt === '7', 'felt RPE not stored on the result, got: ' + JSON.stringify(rec.felt));
  assert(rec.mechanicalCompletion === 'met', 'mechanical completion not stored, got: ' + JSON.stringify(rec.mechanicalCompletion));
  // No strap in this harness, so no zone time was banked — the computed
  // cardio verdict falls to the dur denominator and must read not_met.
  assert(rec.cardioCompletion === 'not_met', 'computed cardio completion wrong, got: ' + JSON.stringify(rec.cardioCompletion));
  assert(rec.dur >= 20, 'the banked duration should clear MIN_LOGGABLE_SEC, got: ' + rec.dur);

  // History's conditioning line renders the felt value the athlete chose.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const s = db.sessions.find((x) => x.id === 'conds1');
    s.status = 'completed';
    s.completedAt = Date.now();
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/history', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Engine day")');
  await page.waitForSelector('text=felt RPE 7');
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

  /* The dots are a visual difference only. Each cell is a button carrying its
     own aria-label, and aria-label wins over everything inside the element —
     so unless the state is spelled into the name, a screen reader hears a
     month of identical dates and the distinction the dots draw is not there. */
  const named = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.grid-cols-7 button')];
    const label = (c) => c.getAttribute('aria-label') || '';
    return {
      total: cells.length,
      trained: cells.filter((c) => label(c).endsWith(', trained')).length,
      planned: cells.filter((c) => label(c).endsWith(', planned')).length,
    };
  });
  assert(
    named.trained === trained.length,
    `${trained.length} trained dot(s) but ${named.trained} cell(s) announced as trained`,
  );
  assert(named.planned >= 1, 'Lower A is scheduled every day, so cells should be announced as planned');
  assert(named.trained + named.planned <= named.total, 'a day was announced as both trained and planned');
});

await t('Day preview shows "Nothing scheduled" for a day with nothing planned', async () => {
  // Day is reached directly by date — Task 5 wires the actual Calendar/Home
  // tap-through, this pins the screen's own two states in isolation.
  // 'Lower A' (seeded at boot) is scheduled on every day of the week, so
  // proving the empty state means clearing workouts for the moment, restored
  // immediately after so nothing below is able to tell this ran.
  const saved = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const workouts = db.workouts;
    db.workouts = [];
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return workouts;
  });
  try {
    await page.goto(base + '/day/2030-06-15', { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Nothing scheduled for this day.');
    const txt = await page.textContent('body');
    assert(!/Invalid Date/.test(txt), 'the date heading failed to format: ' + txt.slice(0, 200));
    assert(!/Back Squat/.test(txt), 'a workout leaked into the empty-day state');
  } finally {
    await page.evaluate((workouts) => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      db.workouts = workouts;
      localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    }, saved);
  }
});

await t('Day preview shows the matched workout for a scheduled day, read-only', async () => {
  // 'Lower A' is scheduled every day of the week, so any date lands on it —
  // picked far enough in the future that no logged session could collide.
  await page.goto(base + '/day/2030-06-15', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Back Squat');
  const txt = await page.textContent('body');
  assert(/Back Squat/.test(txt), 'the matched workout did not render on Day');
  assert(!/Nothing scheduled/.test(txt), 'the empty state showed even though a workout matched');
  // Read-only: no Start/Edit/Delete/Duplicate control — those are
  // Library/Training's job, not this preview's.
  assert(!(await page.$('button:has-text("Start")')), 'Day must not offer a Start control');
  assert(!(await page.$('button:has-text("Edit")')), 'Day must not offer an Edit control');
  assert(!(await page.$('button:has-text("Delete session")')), 'Day must not offer a Delete control');
  assert(!(await page.$('button:has-text("Duplicate")')), 'Day must not offer a Duplicate control');
});

/*
 * Task 5: Calendar's day cells are no longer bare boxes — each one resolves
 * through `resolveDayTarget` and lands on Recap, Training, or the read-only
 * Day preview. All three scenarios pick a date offset from "today" but still
 * inside the CURRENT calendar month (every month has at least 28 days, so an
 * offset up to ~13 always lands on a real day of it) — the Calendar screen
 * opens on the current month and none of these tests page it. The two offsets
 * used below (5, 11) can never coincide with each other, whichever side of
 * the month either one lands on.
 *
 * Computed IN the page (not in Node) so the label matches, character for
 * character, whatever Calendar.tsx itself renders as the cell's aria-label —
 * both run in the same Chromium process, so there is no host/locale drift to
 * account for.
 *
 * A cell's aria-label is that date PLUS its state (", trained" / ", planned"),
 * because aria-label overrides the dots inside the cell and a screen reader
 * would otherwise hear a month of indistinguishable dates. `dayCell` matches
 * the bare date OR the date followed by a state, so these three tap tests stay
 * about routing; the suffix itself is pinned by its own scenario below. The
 * ", " in the prefix form is what stops "June 1" matching "June 15".
 */
const dayCell = (label) => `button[aria-label="${label}"], button[aria-label^="${label}, "]`;

const dayOffsetInPage = (n) =>
  page.evaluate((n) => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const day = now.getDate();
    const candidate = day + n <= lastDay ? day + n : day - n;
    const d = new Date(now.getFullYear(), now.getMonth(), candidate);
    const p = (x) => String(x).padStart(2, '0');
    return {
      iso: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
      label: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    };
  }, n);

/*
 * A rest timer armed by an earlier scenario in this file is still counting
 * down by the time these run (its end time is persisted, not the countdown
 * itself), and its floating chip (`RestChip.tsx`) is `fixed` at the bottom of
 * the viewport on EVERY screen — including Calendar — where it can sit over a
 * cell in a later row and steal the click, unrelated to anything these tests
 * are actually about. `RestProvider` only reads its persisted end time back
 * on mount, so clearing it right before a real `page.goto` (a full
 * navigation, not client-side) is enough to make sure the chip is gone.
 */
const clearRestTimer = () =>
  page.evaluate(() => {
    localStorage.removeItem('hybrid-engine-v1-rest-ends');
    localStorage.removeItem('hybrid-engine-v1-rest-total');
  });

await t("tapping a trained day on Calendar lands on that day's Recap", async () => {
  const { iso, label } = await dayOffsetInPage(5);
  await page.evaluate((iso) => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.sessions.push({
      id: 'calTapRecap1',
      name: 'Tap target',
      date: iso,
      status: 'completed',
      updatedAt: Date.now(),
      completedAt: Date.now(),
      blocks: [
        {
          id: 'ctb1',
          heading: 'Main',
          superset: false,
          exercises: [
            {
              id: 'cte1',
              name: 'Row',
              mode: 'reps_kg',
              rest: 60,
              sets: [{ t: '5', aVal: '50', aVal2: '5', felt: '7', done: true }],
            },
          ],
        },
      ],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  }, iso);
  await clearRestTimer();
  await page.goto(base + '/calendar', { waitUntil: 'networkidle' });
  await page.click(dayCell(label));
  await page.waitForURL(/\/recap\/calTapRecap1/);
});

await t('tapping today on Calendar lands on Training', async () => {
  // Whatever earlier scenarios in this file logged for today would resolve
  // to Recap instead (recap outranks "today" — see resolveDayTarget), so
  // today's sessions are cleared for the duration of this test and restored
  // after, the same save/restore shape the Day-preview empty-state test uses.
  const saved = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const today = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    const removed = db.sessions.filter((s) => s.date === today);
    db.sessions = db.sessions.filter((s) => s.date !== today);
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return removed;
  });
  try {
    await clearRestTimer();
    await page.goto(base + '/calendar', { waitUntil: 'networkidle' });
    const label = await page.evaluate(() =>
      new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    );
    await page.click(dayCell(label));
    await page.waitForURL(/\/training/);
  } finally {
    await page.evaluate((removed) => {
      const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
      db.sessions.push(...removed);
      localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    }, saved);
  }
});

await t('tapping an empty, untrained day on Calendar lands on the Day preview for that date', async () => {
  const { iso, label } = await dayOffsetInPage(11);
  await clearRestTimer();
  await page.goto(base + '/calendar', { waitUntil: 'networkidle' });
  await page.click(dayCell(label));
  await page.waitForURL(new RegExp('/day/' + iso));
  // 'Lower A' (seeded at boot) is scheduled every day of the week, so this
  // always lands on ITS preview, never the "Nothing scheduled" empty state —
  // that state is already pinned in isolation above. The point here is only
  // that it is Day, never Recap or Training. The URL updates synchronously on
  // a client-side navigation, before React has committed the new route's
  // render, so wait for the Day screen's own content rather than reading body
  // text right off the back of waitForURL.
  await page.waitForSelector('text=Back Squat');
  const txt = await page.textContent('body');
  assert(/Back Squat/.test(txt), 'Day preview did not render the matched workout for the tapped day: ' + txt.slice(0, 200));
  assert(!/Nothing scheduled/.test(txt), 'the empty state showed even though Lower A matches every day');
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
  // The WHOOP card's error line must carry the humanized sentence, never the
  // raw fetch/JSON-parse noise the pre-humanizer version leaked.
  await page.waitForSelector('text=WHOOP');
  const whoopTxt = await page.textContent('body');
  assert(!/Unexpected token/.test(whoopTxt), 'raw JSON-parse error reached the WHOOP card: ' + whoopTxt.slice(0, 300));
});

await t('Home\'s "Start today\'s session →" actually starts one', async () => {
  // The earlier "Training starts a session" test drives the CTA that lives on
  // the Training screen itself; this drives the OTHER Start — Home's own
  // button, a separate code path (`Home.tsx`'s `onStart`) that must mint the
  // session and land the same way. The prior session finished (status
  // 'completed'), so `Lower A` — scheduled every day — is offered again.
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.length);
  // The rendered apostrophe is a typographic ’ (’), not the ASCII ' this
  // file is written in — match on the unambiguous half of the label instead.
  // Two taps in quick succession — the guard lives INSIDE the store write,
  // so the second tap must be a no-op rather than a second live session.
  await Promise.all([
    page.click('button:has-text("Start today")'),
    page.click('button:has-text("Start today")').catch(() => {}),
  ]);
  await page.waitForURL(/\/training/);
  await page.waitForSelector('text=In progress');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.length);
  assert(after === before + 1, 'Home\'s Start did not mint exactly one session, got ' + after + ' from ' + before);
});

await t('finishing early with unlogged sets asks for confirmation, and cancelling keeps the session live', async () => {
  // Home's Start (above) just left a fresh active session with none of its
  // sets logged — the "work left" branch mobile guards with an Alert; web
  // must ask the same way, via window.confirm, and a Cancel must leave the
  // session exactly as it was.
  await page.waitForSelector('button:has-text("Finish session early")');
  let dialogMsg = '';
  page.once('dialog', (dialog) => {
    dialogMsg = dialog.message();
    dialog.dismiss(); // "Keep training"
  });
  await page.click('button:has-text("Finish session early")');
  assert(/still unlogged/.test(dialogMsg), 'expected the unlogged-sets warning, got: ' + dialogMsg);
  const txt = await page.textContent('body');
  assert(/In progress/.test(txt), 'the session should still be in progress after cancelling the confirm');
  const status = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return db.sessions.find((s) => s.status === 'active')?.status;
  });
  assert(status === 'active', 'the session should remain active after cancelling the finish confirmation, got ' + status);
});

await t('a completed conditioning block stays clickable, reopening the recap', async () => {
  // Independent of the earlier conditioning-run flow: seed an active session
  // whose conditioning block already carries a condResult — the same shape a
  // finished run leaves it in — and confirm the Training list still lets you
  // tap back into it instead of dead-ending once logged.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    for (const s of db.sessions) if (s.status === 'active') s.status = 'incomplete';
    db.sessions.push({
      id: 'condcard1', name: 'Engine day 2', date: new Date().toISOString().slice(0, 10),
      status: 'active', updatedAt: Date.now(),
      blocks: [{
        id: 'condb2', kind: 'conditioning', heading: 'Conditioning', condFmt: 'intervals', effort: 'hard',
        condResult: { felt: '7', mechanicalCompletion: 'met', cardioCompletion: 'not_met', dur: 600 },
      }],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/training', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=tap to review');
  await page.click('button:has-text("tap to review")');
  await page.waitForURL(/\/recap\/condcard1/);
});

await t('a reported pain stop holds the setup screen until acknowledged', async () => {
  // Seed a standalone conditioning result for 'tempo' — a format untouched by
  // every other scenario in this file — whose most recent (only) result ended
  // in a reported pain stop. Standalone history is exactly how condEfforts
  // reads settings.conditioning, so this is the direct-localStorage seed the
  // task allows in place of driving a whole live run through the chips.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.settings.conditioning = (db.settings.conditioning || []).concat([
      { id: 'painstop1', fmt: 'tempo', dur: 60, zsec: { low: 0, mod: 0, high: 0 }, startedAt: Date.now(), mechanicalCompletion: 'pain_stop' },
    ]);
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/conditioning', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Tempo")');

  // (a) the hold banner shows and Start is not usable.
  await page.waitForSelector('text=ended early for reported pain');
  const startVisible = await page.$('button:has-text("Start")');
  assert(!startVisible, 'the Start control is still present while a pain stop is unacknowledged');

  // (b) tapping the acknowledgement clears the hold and Start returns.
  await page.click('button:has-text("I\'m ready to continue")');
  await page.waitForSelector('button:has-text("Start")');
  const txtAfterAck = await page.textContent('body');
  assert(!/ended early for reported pain/.test(txtAfterAck), 'the pain-stop banner is still showing after acknowledging');
  const ack = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).settings.conditioningAck);
  assert(ack && typeof ack.tempo === 'number', 'conditioningAck was not written for the bare "tempo" bucket, got: ' + JSON.stringify(ack));

  // Switching to a different, unaffected format never showed the banner and
  // never hid Start — the hold only ever gated the bucket it belonged to.
  await page.click('button:has-text("Steady-state")');
  const txtOther = await page.textContent('body');
  assert(!/ended early for reported pain/.test(txtOther), 'a pain stop in tempo leaked into steady-state');
  assert(await page.$('button:has-text("Start")'), 'Start should be usable for an unaffected format');
});

/* ---------- planner ---------- */

await t('the Library creates a session and opens the guided builder', async () => {
  // The guided builder (Task 5) is now the "＋ New session" entry point — it
  // creates the workout up front, same as before, but hands off to /build/:id
  // rather than dropping straight into the Planner with a blank block.
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('button:has-text("＋ New session")');
  await page.waitForURL(/\/build\//);
  await page.waitForSelector('text=What are we doing?');
  const made = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts.some((w) => w.name === 'New session'),
  );
  assert(made, 'the Library did not write the session it navigated to');
});

await t('the guided builder replaces "New session" and can build a full session', async () => {
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('button:has-text("＋ New session")');
  await page.waitForSelector('text=What are we doing?');

  // Lift block.
  await page.click('button:has-text("Lift")');
  await page.waitForSelector('text=Which movement?');
  await page.fill('input[aria-label="movement name"]', 'Back Squat');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many sets?');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many reps?');
  await page.click('button:has-text("8")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How hard should it feel?');
  await page.click('button:has-text("RPE 8")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=Add another block?');
  const afterFirst = await page.textContent('body');
  assert(/Back Squat added/.test(afterFirst), 'the running summary should name the block just added');

  // Warm-up/Cooldown block, as a single open text box.
  await page.click('button:has-text("Yes, add another")');
  await page.waitForSelector('text=What are we doing?');
  await page.click('button:has-text("Warm-up / Cooldown")');
  await page.waitForSelector("text=What's the warm-up?");
  await page.fill('textarea', '10 min bike, band work');
  await page.click('button:has-text("Done")');
  await page.waitForSelector('text=Add another block?');
  const afterSecond = await page.textContent('body');
  assert(/Warm-up \/ Cooldown added/.test(afterSecond), 'the warm-up block should show in the running summary');

  // Finish — lands in the existing Planner with both blocks present.
  await page.click('button:has-text("No, I\'m done")');
  await page.waitForSelector('text=Back Squat');
  const plannerText = await page.textContent('body');
  assert(/Back Squat/.test(plannerText), 'the lift block should carry into the Planner');
  assert(/10 min bike, band work/.test(plannerText), 'the warm-up note should carry into the Planner');
});

await t('the plan editor edits a target and it persists', async () => {
  // Scoped by the workout id in the current URL rather than by name: the
  // previous test (and the one before it) both mint sessions named "New
  // session", so matching on name alone would risk grabbing the wrong one.
  await page.waitForSelector('input[aria-label="target for set 1"]');
  const workoutId = new URL(page.url()).pathname.split('/').pop();
  await page.fill('input[aria-label="target for set 1"]', 'W10');
  await page.fill('input[aria-label="target for set 2"]', '3');
  const stored = await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const w = db.workouts.find((x) => x.id === id);
    return w.blocks[0].exercises[0].sets.slice(0, 2).map((s) => s.t);
  }, workoutId);
  assert(stored[0] === 'W10' && stored[1] === '3', 'targets not saved: ' + JSON.stringify(stored));
});

await t('Duplicate clones a workout and lands on Planner with independent content', async () => {
  // Seed a workout with a known name and one exercise, under a name distinct
  // from every workout the guided-builder tests above created, so the clicks
  // below cannot grab the wrong card.
  const origId = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const id = 'dup-src-1';
    db.workouts.push({
      id,
      name: 'Dup Source',
      updatedAt: 1,
      blocks: [
        {
          id: 'dupb1',
          heading: 'Main',
          superset: false,
          exercises: [
            { id: 'dupe1', name: 'Front Squat', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
          ],
        },
      ],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return id;
  });

  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  // :text-is() rather than :has-text() — once the clone exists below, its name
  // is "Dup Source copy", and a substring match would resolve to both cards.
  await page.click('span:text-is("Dup Source")');
  await page.waitForSelector('button:has-text("Duplicate")');
  await page.click('button:has-text("Duplicate")');

  await page.waitForURL(/\/planner\//);
  const newId = new URL(page.url()).pathname.split('/').pop();
  assert(newId !== origId, 'Duplicate landed on the same workout id as the original, got ' + newId);

  await page.waitForSelector('text=Front Squat');
  const cloneName = await page.inputValue('input[aria-label="session name"]');
  assert(cloneName === 'Dup Source copy', 'the clone should be named "Dup Source copy", got: ' + cloneName);

  // Edit a field on the clone.
  await page.waitForSelector('input[aria-label="target for set 1"]');
  await page.fill('input[aria-label="target for set 1"]', 'CLONE-EDIT');
  const cloneStored = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts.find((w) => w.id === id).blocks[0].exercises[0].sets[0].t,
    newId,
  );
  assert(cloneStored === 'CLONE-EDIT', 'the edit on the clone did not persist, got ' + cloneStored);

  // Navigate back to Library, expand the ORIGINAL, and confirm it is untouched.
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('span:text-is("Dup Source")');
  await page.waitForSelector('text=Front Squat');
  const origAfter = await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const w = db.workouts.find((x) => x.id === id);
    return { name: w.name, target: w.blocks[0].exercises[0].sets[0].t };
  }, origId);
  assert(origAfter.name === 'Dup Source', 'the original workout name changed, got ' + origAfter.name);
  assert(origAfter.target === '5', 'the original set target changed, got ' + origAfter.target);
});

/* ---------- guided builder: leaving it ---------- */

/*
 * The browser's own Back button, which no other check touches.
 *
 * The wizard's steps are React state, so there is nothing for Back to go back
 * to: without the same-path history entry each step-forward pushes, one press
 * would leave /build/:id and take the block being authored with it. This is the
 * only place that behaviour is observable — it cannot be reached from jsdom, and
 * `useBlocker` is not available to this app's declarative BrowserRouter, so the
 * mechanism is worth pinning.
 */
await t('the browser Back steps back inside the guided builder', async () => {
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('button:has-text("＋ New session")');
  await page.waitForURL(/\/build\//);
  const url = page.url();

  await page.click('button:has-text("Lift")');
  await page.waitForSelector('text=Which movement?');
  // The spec's persistent progress header, on every step-answering screen.
  assert(/Session · block 1/.test(await page.textContent('body')), 'the progress header should say which block this is');
  await page.fill('input[aria-label="movement name"]', 'Back Squat');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many sets?');

  await page.goBack();
  await page.waitForSelector('text=Which movement?');
  assert(page.url() === url, 'Back inside the flow must not change the route, got ' + page.url());
  const kept = await page.inputValue('input[aria-label="movement name"]');
  assert(kept === 'Back Squat', 'stepping back must keep what was already answered, got ' + JSON.stringify(kept));

  await page.goBack();
  await page.waitForSelector('text=What are we doing?');
  assert(page.url() === url, 'still inside the flow at the first question, got ' + page.url());

  // From the first question there is no earlier step, so this one really leaves.
  await page.goBack();
  await page.waitForURL(/\/library/);
});

await t('a custom reps target is still there after stepping back onto it', async () => {
  // The custom box was local state, so it emptied on the unmount that every Back
  // causes while the reps value itself survived: an empty box, no chip selected,
  // and Next enabled with nothing on screen to say what was chosen.
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('button:has-text("＋ New session")');
  await page.waitForSelector('text=What are we doing?');
  await page.click('button:has-text("Lift")');
  await page.fill('input[aria-label="movement name"]', 'Back Squat');
  await page.click('button:has-text("Next")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many reps?');
  await page.fill('input[aria-label="custom reps target"]', '8-12');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How hard should it feel?');

  await page.click('button:has-text("Back")');
  await page.waitForSelector('text=How many reps?');
  const shown = await page.inputValue('input[aria-label="custom reps target"]');
  assert(shown === '8-12', 'the custom target should still be shown, got ' + JSON.stringify(shown));
});

await t('typing a custom reps target does not get clobbered mid-keystroke', async () => {
  // page.fill sets the whole string in one DOM event, which can't catch this:
  // the custom box derived its shown value by blanking itself whenever the
  // typed-so-far text happened to equal a preset ('8', '5', ...), so the box
  // reset to empty the instant it read "8" and the rest of a real keystroke
  // sequence landed on an empty field. page.type() fires one real keydown per
  // character, the only way to reproduce that.
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('button:has-text("＋ New session")');
  await page.waitForSelector('text=What are we doing?');
  await page.click('button:has-text("Lift")');
  await page.fill('input[aria-label="movement name"]', 'Back Squat');
  await page.click('button:has-text("Next")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many reps?');
  await page.type('input[aria-label="custom reps target"]', '8-12');
  const shown = await page.inputValue('input[aria-label="custom reps target"]');
  assert(shown === '8-12', 'typing "8-12" one key at a time should show "8-12", got ' + JSON.stringify(shown));
});

await t('cancelling the first question drops the session the Library minted', async () => {
  // Library writes the Workout BEFORE the wizard opens, so with no way out of
  // the first question an accidental tap left a permanent, blockless session —
  // which the Library then lists as "conditioning".
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts.length);
  await page.click('button:has-text("＋ New session")');
  await page.waitForURL(/\/build\//);
  const id = new URL(page.url()).pathname.split('/').pop();

  await page.click('button:has-text("Cancel")');
  await page.waitForURL(/\/library/);
  const after = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return { n: db.workouts.length, tombs: db.settings.deletedIds || {} };
  });
  assert(after.n === before, 'the phantom session should be gone, ' + after.n + ' vs ' + before);
  // A tombstone, not just a local splice: without one the next sync restores it.
  assert(after.tombs[id], 'the phantom session should be tombstoned, not just removed');
});

await t('no uncaught page errors', async () => {
  assert(errors.length === 0, errors.join(' | '));
});

await browser.close();
server.close();
console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll React smoke checks passed.');
process.exit(failures ? 1 : 0);
