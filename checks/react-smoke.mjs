/*
 * React app smoke test.
 *
 * Serves the BUILT output of apps/web and drives it in a real browser. A
 * green `vite build` only proves the modules resolved; this proves the shipped
 * bundle actually mounts and the coach bench actually works.
 *
 * It used to say "the guided set flow logs a set, and autoregulation moves the
 * next weight", and for sixty-three scenarios that is what it did. The athlete
 * web app was parked on 13 August 2026 — `apps/web` serves `/coach` and
 * redirects everything else — so those scenarios drove addresses that no longer
 * reach the screens they were written against. They are gone, and the long
 * comment below this file's server setup records, family by family, where each
 * one's behaviour is covered now and where it is not covered at all.
 *
 * What is left is in two halves: the DEFAULT bundle, which must boot and
 * resolve a parked address without a blank page, and a second bundle built
 * here with a coach allowlist baked in, which is the only way to open the
 * bench in a browser at all.
 *
 * Run: node checks/react-smoke.mjs   (from the repo root)
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
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

/** Serves a built output directory (the shipped `apps/web` bundle, by default). */
function serve(port, dir = 'apps/web/dist') {
  const web = resolve(root, dir);
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

/* ---------- the shipped athlete bundle: what is left of it ----------
 *
 * SIXTY-THREE scenarios used to live here, between this comment and the coach
 * section below, and they are gone as of 13 August 2026 — the day the athlete
 * web app was parked (`apps/web/src/App.tsx` now mounts `/coach/*` and sends
 * every other address to `/coach`). They did not fail because a screen broke.
 * They failed because the addresses they drove — `/home`, `/training`,
 * `/history`, `/conditioning`, `/nutrition`, `/library`, `/calendar`,
 * `/progress`, `/settings`, `/day/:date`, `/build/:id`, `/planner/:id` and
 * `/log/0/0` — no longer reach the screens they were written against, so all
 * sixty-three sat waiting for athlete controls on the coach sign-in screen
 * until Playwright timed each one out. Twenty-one minutes, sixty-three
 * failures, and every later CI step skipped behind them.
 *
 * `checks/screens.mjs` emptied its athlete `SHOTS` list for the same reason on
 * the same day, and gave the same reason in its own words: shooting a
 * redirected address produces nine identical pictures of the coach bench under
 * athlete filenames — a check that passes while proving nothing. This file's
 * version of that failure is worse, because a smoke scenario cannot even
 * silently pass; it hangs. Deleting them is the honest move either way.
 *
 * Where the behaviour went. Taking the deleted scenarios family by family,
 * because "it moved to the phone" is not true of all of them and this file is
 * no place to imply that it is:
 *
 *  - THE LOGGER — a warm-up logging in one tap without moving the working
 *    weight, an unrated set holding its load, the ↑/↓ deviation control
 *    PROPOSING the next weight as a ghost rather than applying it, the 1e309
 *    sanitiser, the rest chip, the seconds-mode timer (Start, Stop, Finish Set
 *    mid-countdown, a range target like '20-30s', and a hold that expires while
 *    its own field is unmounted). Twenty scenarios, and the single largest
 *    block. `apps/web/src/screens/Logger.tsx` and `screens/logger/`
 *    were DELETED outright when the app was parked, not merely made
 *    unreachable, so there is no web screen left for these to drive. The
 *    behaviour is now the Android logger's:
 *    `apps/mobile/src/screens/logger/SessionLogger.tsx` with its colocated
 *    `SessionLogger.test.tsx`, plus `HotCard`, `PieceCard`, `BlockScreen`,
 *    `BlockStrip`, `RestTakeover` and `FinishCard`, each with a colocated test
 *    beside it. End to end, the same session is driven through a real browser
 *    by `checks/parity-behaviour.mjs` and `checks/parity-harness.mjs`
 *    (`pnpm run check:parity-mobile`), which diff a live run against the
 *    recorded prototype trace. The autoregulation ARITHMETIC these scenarios
 *    watched arrive on screen — 100kg at target 8 rated 7 becoming 102.5 — is
 *    pinned directly, and for all 672 combinations, by
 *    `packages/engine/src/golden.test.ts`, `autoreg.test.ts` and
 *    `lift.test.ts`.
 *
 *    Be clear about what is NOT preserved: these were the only checks that
 *    proved those engine rules survived the trip through a real DOM into a
 *    real input's placeholder. The rules are still pinned; the journey is now
 *    pinned on Android instead of in a browser. That is a genuine narrowing,
 *    and it is the correct one — the browser no longer HAS a logger to reach.
 *
 *  - AUTHORING — the Library minting a session, the guided builder's steps,
 *    block-kind exclusion, the plan editor, Duplicate, and the folders.
 *    Fifteen scenarios. This entry said the screens "were not deleted; they
 *    moved across the lane" into `apps/web/src/coach/authoring/`, reachable at
 *    `/coach/build/:id` and `/coach/planner/:id`.
 *
 *    THEY ARE DELETED NOW (14 August 2026). `Planner`, `GuidedBuilder` and
 *    their step components are gone, with `CoachAuthoring` and `RosterPlanner`
 *    and all four routes. `library/DayBuilder` is the one authoring surface
 *    left; the `coach/library/*` colocated tests cover it, and folder grouping
 *    is still pinned by `packages/engine/src/folders.test.ts`.
 *
 *    Honestly: that leaves nothing driving a coach's session build end to end
 *    in Chromium — the gap this entry already named, now wider, because the
 *    screenshots of the two builder routes went with the routes. It is named
 *    here rather than papered over, and the place to close it is a NEW
 *    coach-bundle section below, aimed at DayBuilder — not a resurrection of
 *    these fifteen, which drove athlete routes that no longer exist either.
 *
 *  - NUTRITION ON THE WEB — the Home fuel card, the food log, the
 *    separate-storage-key invariant and the deletion tombstone. Six scenarios.
 *    The athlete nutrition web world was parked with the rest of the athlete
 *    app; nutrition is an Android surface now
 *    (`apps/mobile/src/screens/nutrition/`, `apps/mobile/src/nutrition-world.test.tsx`,
 *    `apps/mobile/src/store/nutrition-store.test.ts`). The two invariants those
 *    scenarios existed for are pinned where they are decided rather than where
 *    they were displayed: the slice separation by
 *    `packages/engine/src/ecosystem-nutrition.test.ts`, and additive merge with
 *    `deletedAt` as the only travelling deletion by `@hybrid/nutrition-core`'s
 *    own merge tests. The bench's READ-ONLY view of the same data is still
 *    driven in a browser, right below.
 *
 *  - THE REST — Home, Training, History, Progress, Calendar, the week strip
 *    tap-throughs, Day preview, Settings, the conditioning run's two questions
 *    and the pain-stop acknowledgement. Twenty-two scenarios. Their screens still
 *    exist under `apps/web/src/screens/` and their colocated tests still run —
 *    that is what CLAUDE.md means by parked rather than deleted — but nothing
 *    routes to them, so nothing can drive them in a browser. The equivalent
 *    Android screens carry the behaviour now
 *    (`apps/mobile/src/screens/screens.test.tsx`, `conditioning.test.tsx`,
 *    `training.test.tsx`, `Home.test.tsx`, `Settings.test.tsx`). The pain-stop
 *    rule itself is a `@hybrid/whole-athlete-state` decision and is pinned
 *    there.
 *
 * If the athlete app is ever unparked, these come back from git — the same
 * sixty-three, against the same routes, and they will work the moment the
 * routes do.
 *
 * What stays here for the DEFAULT bundle is the one athlete-facing claim that
 * is still true of it, and it is worth keeping because it is exactly the claim
 * this file was built to make: `vite build` cannot tell you the shipped bundle
 * mounts. Parking made every athlete address a redirect, and a redirect that
 * lands on a blank page is a broken deploy that no unit test can see.
 */

await t('the shipped bundle mounts, and a parked athlete address lands on the coach workspace', async () => {
  // `/home` was the athlete app's front door. In the shipped bundle it is a
  // parked address like any other, and what has to be true of it is that the
  // React app BOOTS and the redirect resolves — not that it 404s, not that it
  // serves an empty shell, and not that it loops.
  //
  // Waiting on the submit control rather than on an `h1`: the signed-out
  // workspace has no `h1` at all, and a selector that waits five seconds for
  // something that is not there is exactly how the sixty-three deleted
  // scenarios wasted twenty-one minutes of CI.
  await page.goto(base + '/home', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Sign in")', { timeout: 5000 });
  assert(/\/coach$/.test(page.url()), 'a parked athlete address did not land on /coach, got: ' + page.url());
  const txt = await page.textContent('body');
  assert(/Coach workspace/.test(txt), 'the coach workspace did not render at all, got: ' + txt.slice(0, 300));
  // And no athlete screen leaked through the redirect — the parking is meant
  // to be total, not a soft link.
  assert(!/Your zones today|Fuel today/.test(txt), 'an athlete screen rendered behind the redirect: ' + txt.slice(0, 300));
});

await t('the default bundle denies the bench rather than crashing into it', async () => {
  // `coachAllowed` fails CLOSED: with no VITE_COACH_USER_IDS baked in and no
  // stored session, the workspace must ask for a sign-in — and it must ask
  // with a form a human can actually use, not just a heading. This is the
  // state every real visitor to the deployed site is in, and nothing drove it
  // in a browser before: the deleted athlete scenarios all rendered this
  // screen by accident once the app was parked, and none of them ever
  // asserted on it, which is precisely why they reported timeouts instead of
  // reporting the redirect.
  assert(await page.$('input[aria-label="email"]'), 'the sign-in form has no email field');
  assert(await page.$('input[aria-label="password"]'), 'the sign-in form has no password field');
  assert(/Sign in with your account to continue/.test(await page.textContent('body')),
    'the workspace does not say why it is asking for a sign-in');
});

/* ---------- the coach bench's nutrition panel ----------
 *
 * The bench fails CLOSED: `coachAllowed` denies everyone in a production build
 * unless VITE_COACH_USER_IDS names the signed-in user. That is the right
 * production behaviour, and it is why the shipped `apps/web/dist` served above
 * can only ever be driven as far as the sign-in screen. (This paragraph used
 * to add "which is why nothing has ever driven `/coach` in a browser — the
 * deployed dist simply redirects to `/`". Both halves stopped being true when
 * the athlete app was parked: `/` now redirects to `/coach`, and the two
 * scenarios above drive it.)
 *
 * So this builds a second bundle whose allowlist names one throwaway id and
 * hands the browser a matching stored session. `apps/web/dist-coach` is
 * gitignored, never deployed, and the id is a made-up UUID no Supabase account
 * can hold. Every Supabase request is intercepted, because the bench must
 * render from local state alone — a panel that needs the network is a panel a
 * coach cannot open on a bad connection.
 *
 * It is a fresh page in a fresh context: the bench is a different origin's
 * worth of state, and mixing it into the athlete page above would leave the
 * seeded coach session behind for every later scenario.
 */

const COACH_UID = '00000000-0000-4000-8000-000000000001';
const COACH_DIR = 'apps/web/dist-coach';
// The nutrition slice's own storage key — separate from `hybrid-engine-v1` by
// design, so a nutrition write can never dirty the training fingerprint. It
// used to be declared up in the athlete nutrition section; that section is
// gone and the bench still seeds and reads through this key, so it lives here
// now, beside its only remaining user.
const NUTRITION_KEY = 'hybrid-nutrition-v1';

await t('a coach-enabled bundle builds', async () => {
  // Loud, not skipped: a bench that cannot be built is a bench that cannot be
  // checked, and this file's whole premise is that a green build proves nothing.
  execFileSync(
    'pnpm',
    ['--filter', '@hybrid/web', 'exec', 'vite', 'build', '--outDir', 'dist-coach', '--emptyOutDir'],
    { cwd: root, env: { ...process.env, VITE_COACH_USER_IDS: COACH_UID }, stdio: 'pipe' },
  );
  assert(existsSync(resolve(root, COACH_DIR, 'index.html')), COACH_DIR + ' has no index.html after the build');
});

const COACH_PORT = 4318;
const coachServer = await serve(COACH_PORT, COACH_DIR);
const coachBase = 'http://127.0.0.1:' + COACH_PORT;
const coachCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const coachPage = await coachCtx.newPage();
const coachErrors = [];
coachPage.on('pageerror', (e) => coachErrors.push(String(e)));
coachPage.on('console', (m) => {
  if (m.type() === 'error' && !/service worker|manifest|favicon|icon-/i.test(m.text())) coachErrors.push(m.text());
});
// The bench must render from local state alone.
await coachPage.route('**/*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
);

const TODAY = new Date().toISOString().slice(0, 10);
await coachPage.addInitScript(
  ({ uid, today, key }) => {
    const expires = Math.floor(Date.now() / 1000) + 86400;
    localStorage.setItem(
      'sb-orysjncrksmdfabpuftd-auth-token',
      JSON.stringify({
        access_token: 'fake.' + btoa(JSON.stringify({ sub: uid, exp: expires })) + '.sig',
        token_type: 'bearer',
        expires_in: 86400,
        expires_at: expires,
        refresh_token: 'fake-refresh',
        user: {
          id: uid, aud: 'authenticated', role: 'authenticated', email: 'coach@example.com',
          app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
        },
      }),
    );
    if (localStorage.getItem(key)) return;
    const at = new Date().toISOString();
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        logEntries: [
          {
            id: 'coach-smoke-1', userId: uid, logDate: today, meal: 'breakfast', entryKind: 'food',
            foodId: null, customFoodId: null, recipeId: null, quantity: 1, unit: 'serving',
            calories: 620, proteinG: 45, carbsG: 60, fatG: 18, displayName: 'Bench Oats',
            nutrients: {}, notes: null, sourceSnapshot: {}, createdAt: at, updatedAt: at, deletedAt: null,
          },
        ],
        weightEntries: [], program: null, checkIns: [], dayStatus: [],
        customFoods: [], recipes: [], favorites: [], foodCache: [], settings: {},
      }),
    );
  },
  { uid: COACH_UID, today: TODAY, key: NUTRITION_KEY },
);

/*
 * `/coach` is now the ARC command centre; the shell that owns the read-only
 * nutrition modal this section exercises moved to `/coach/legacy`. Both sit
 * behind the same `CoachAccess` allowlist, so driving the legacy route still
 * proves the bench opens for an allowlisted user and redirects everyone else.
 */
await t('the coach bench opens at all with an allowlisted session', async () => {
  await coachPage.goto(coachBase + '/coach/legacy', { waitUntil: 'networkidle' });
  await coachPage.waitForSelector('button:has-text("Nutrition")');
  assert(/\/coach\/legacy$/.test(coachPage.url()), 'the bench redirected away despite an allowlisted user: ' + coachPage.url());
});

await t("the bench's nutrition panel shows the athlete's day, and says it is read-only", async () => {
  await coachPage.click('button:has-text("Nutrition")');
  await coachPage.waitForSelector('[role="dialog"][aria-label="Athlete nutrition"]');
  const panel = await coachPage.textContent('[role="dialog"][aria-label="Athlete nutrition"]');
  assert(/read-only/.test(panel), 'the panel does not declare itself read-only');
  assert(/620/.test(panel), "the athlete's logged calories are missing from the bench: " + panel.slice(0, 400));
  assert(/45P 60C 18F/.test(panel), 'the macro line is missing or reshaped: ' + panel.slice(0, 400));
  // Absent, not zeroed — the same rule the athlete's own card follows.
  assert(/none set/.test(panel), 'a bench with no accepted check-in must not show a target');
  for (const section of ['Today', 'Adherence', 'Program', 'Expenditure', 'Weekly check-in', 'Effect on training']) {
    assert(panel.includes(section), 'the ' + section + ' section is missing from the nutrition panel');
  }
  // The wall, stated on the screen a coach actually reads.
  assert(/never schedules or edits a week/.test(panel), 'the panel no longer states that nutrition cannot edit training');
});

await t('the bench cannot write the athlete\'s food log', async () => {
  const panel = coachPage.locator('[role="dialog"][aria-label="Athlete nutrition"]');
  // Read-only by construction: the panel imports no writer at all, so there is
  // nothing to type into and nothing to submit.
  const inputs = await panel.locator('input, textarea, select').count();
  assert(inputs === 0, 'the nutrition panel grew ' + inputs + ' input(s) — a bench that can rewrite an athlete\'s calories is not read-only');
  const before = await coachPage.evaluate((k) => localStorage.getItem(k), NUTRITION_KEY);
  await panel.locator('button:has-text("Close")').click();
  await coachPage.waitForSelector('[role="dialog"][aria-label="Athlete nutrition"]', { state: 'detached' });
  const after = await coachPage.evaluate((k) => localStorage.getItem(k), NUTRITION_KEY);
  assert(before === after, 'opening and closing the panel changed the athlete\'s nutrition slice');
});

await t('no uncaught page errors on the coach bench', async () => {
  assert(coachErrors.length === 0, coachErrors.join(' | '));
});

await t('no uncaught page errors', async () => {
  assert(errors.length === 0, errors.join(' | '));
});

await browser.close();
server.close();
coachServer.close();
console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll React smoke checks passed.');
process.exit(failures ? 1 : 0);
