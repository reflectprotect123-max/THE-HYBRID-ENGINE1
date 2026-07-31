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
