/*
 * Touch targets in the built web app, measured in a real browser.
 *
 * The property is unchanged and still the whole point: every visible control
 * must be big enough to hit with a thumb. `Button` renders 32px at `sm` and
 * 40px at `md` — both under the 44pt minimum — and both `packages/design`'s
 * tokens.css and the coach workspace's own `coach-redesign.css` fix that under
 * `@media (pointer: coarse)`, so fingers get 44px and a mouse does not (a dense
 * desktop layout padded out to finger size would look broken).
 *
 * That media query is exactly the kind of thing that is easy to write and easy
 * to get wrong — it can match nothing, or match everything. The other browser
 * suites run with a default fine pointer and would never enter the branch, so
 * this drives both emulations and measures.
 *
 * WHERE it measures changed on 14 August 2026. Until then it walked the
 * athlete gym path — `/home`, `/training`, `/library`, `/nutrition`,
 * `/build/w1` and `/calendar`. The athlete web app was parked on 13 August
 * (CLAUDE.md, "The athlete web app is PARKED, not deleted"): `apps/web` serves
 * the coach workspace and every one of those addresses redirects to `/coach`.
 * So the check was landing on the coach sign-in screen and timing out on
 * `button:has-text("Lift")` — the fourth check found with this exact rot, after
 * coach-contract, react-smoke and deploy-smoke.
 *
 * It now walks the coach bench, which is the only web surface there is, and
 * which CLAUDE.md requires to hold at 420px on a phone. Nothing was loosened to
 * get there: same 44px minimum, same selector, same both-pointer structure,
 * same counter-assertion that a mouse still gets the compact sizes.
 *
 * Where the athlete coverage went, route by route:
 *   - `/home`, `/training`, `/library`, `/nutrition` — the athlete product is
 *     the ANDROID app now, and `checks/mobile-touch.mjs` measures its targets.
 *     Nothing measures the parked athlete WEB screens, and nothing should:
 *     they are unreachable.
 *   - `/build/w1` — LOST, as of 14 August 2026. This entry read "NOT lost —
 *     the guided builder moved to `apps/web/src/coach/authoring/guided/` and is
 *     reachable at `/coach/build/:id`". `GuidedBuilder` has since been deleted
 *     outright, so there is no guided builder at any address to drive. See the
 *     note above `ROUTES` for what replaced it and what that swap does not
 *     carry over.
 *   - `/calendar` — the athlete month grid is gone; the coach Library's
 *     calendar is the month grid that ships, so the "must NOT reach" half of
 *     the rule is asserted against `.cal-grid` instead (see the bottom of this
 *     file, which records what that swap does and does not carry over).
 *
 * The coach bench cannot be opened in a default production build at all —
 * `CoachAccess` fails closed — so this builds and serves the same
 * coach-enabled second bundle `checks/screens.mjs` uses, through the shared
 * `checks/_coach-bundle.mjs` those two now both call.
 *
 *   node checks/web-touch.mjs        (skips cleanly without playwright)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { launchChromium } from './_chromium.mjs';
import { buildSeed } from './_seed.mjs';
import { buildCoachBundle, signInCoach, COACH_DIR } from './_coach-bundle.mjs';

const root = resolve(process.cwd(), process.argv.slice(2).find((a) => !a.startsWith('-')) || '.');
const MIN = 44;

if (!existsSync(resolve(root, 'apps/web/dist'))) {
  console.error('apps/web/dist missing — run `pnpm run build:site` first.');
  process.exit(1);
}

/* The browser is launched BEFORE the coach bundle is built: without Playwright
   there is nothing to measure, and a two-minute vite build followed by
   "SKIP" is a waste of a CI minute. */
const { browser, skip } = await launchChromium();
if (skip) {
  console.log('SKIP — web-touch: ' + skip + '.');
  process.exit(0);
}

console.log('Building a coach-enabled bundle (VITE_COACH_USER_IDS set)…');
buildCoachBundle(root);

const PUB = resolve(root, COACH_DIR);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = normalize(join(PUB, p === '/' ? 'index.html' : p));
  if (!f.startsWith(PUB) || !existsSync(f) || !extname(f)) f = join(PUB, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

let fails = 0;
const check = (ok, msg) => {
  console.log((ok ? 'PASS — ' : 'FAIL — ') + msg);
  if (!ok) fails++;
};

/*
 * The same eight-week seed `checks/screens.mjs` draws its shots against, for
 * the same reason this file used to hand-roll a workout and a live session: an
 * empty store renders empty states, and an empty state has no controls to
 * measure. A run that finds nothing under 44px because it found nothing at all
 * is the failure this check exists to avoid — hence the "found controls to
 * measure" assertion below, which is not decoration.
 */
const seed = buildSeed();

/*
 * The routes. These are the bench's own, addressed with ids `_seed.mjs`
 * actually creates — a coach route pointed at a missing id renders a not-found
 * state, which has no controls and would pass while proving nothing.
 *
 * Chosen for CONTROL DENSITY rather than to re-shoot everything
 * `checks/screens.mjs` covers (it has all sixteen; this one drives a browser
 * twice over, and every route is paid for twice):
 *   - `/coach`               the Command Center — the launcher tiles and the
 *                            client strip, the first thing a thumb ever hits.
 *   - the four pillars       Readiness, Strength, Conditioning, Nutrition —
 *                            each is a column of expandable cards whose
 *                            `<summary>` rows are the smallest tap targets on
 *                            the bench (`.cc-section summary`, 44px by hand in
 *                            coach-redesign.css, which is precisely the sort of
 *                            hand-set number that wants measuring).
 *   - `/coach/library`       the calendar and its per-day controls.
 *   - `/coach/settings`      the densest form on the bench: rows of selects and
 *                            toggles, and `select` is in the selector.
 *   - `/coach/day/<today>`   `DayBuilder` — the session authoring surface, and
 *                            the replacement for `/coach/build/w1` (below).
 *
 * WHAT CHANGED ON 14 AUGUST 2026, and what it cost.
 *
 * `/coach/build/w1` was the guided builder, and this check did not merely
 * measure it — it WALKED it: Lift → movement name → Next → Next → the reps
 * step, because a wizard shows one question at a time and the smallest target
 * on the bench lived at the end of that path. `GuidedBuilder` is deleted, so
 * both the route and the walk are gone.
 *
 * `/coach/day/:date` takes its place in the flat measurement, and that is an
 * honest swap for the SURFACE but not for the DEPTH. Nothing here now walks
 * into a control that only exists after several clicks. That is a real
 * narrowing of this check, named rather than quietly absorbed: if DayBuilder
 * grows a multi-step path with a target at the end of it, this is the file
 * that should learn to walk again.
 */
/* A date the seed's calendar actually has. `DayBuilder` renders its editor for
   any well-formed date, but pointing it at a garbled one would render a
   not-found state — which has no controls, and would trip the per-route
   assertion below for the wrong reason. */
const TODAY = new Date().toISOString().slice(0, 10);
const ROUTES = [
  '/coach',
  '/coach/readiness',
  '/coach/strength',
  '/coach/conditioning',
  '/coach/nutrition',
  '/coach/library',
  '/coach/settings',
  `/coach/day/${TODAY}`,
];
/* `label:has(input[type="checkbox"])` is still in the selector even though the
   click path that justified it is gone (see above). A native checkbox is
   deliberately excluded from the 44px minimum — a stretched checkbox looks
   broken — so the ROW it sits in has to carry the target. Measuring the
   checkbox itself would only ever report 13px and confirm its own exclusion;
   the label is what a thumb actually hits, wherever one appears. */
const SELECTOR = 'button, a, [role="button"], select, label:has(input[type="checkbox"])';

/*
 * The frame's own home link, present in the DOM at every width — the same wait
 * `checks/screens.mjs` settled on, and for the same reason it does NOT wait on
 * the hamburger: that button lives in a `sm:hidden` bar and never appears at
 * desktop width. `state: 'attached'` because below `sm` the aside is off-canvas
 * until the drawer opens.
 *
 * This proves the FRAME mounted, not the pillar inside it — and the difference
 * matters here more than anywhere, because a bench stuck on "Loading coach
 * workspace…" still renders the frame's controls, all of them comfortably over
 * 44px, and would report a clean pass having measured the chrome around an
 * empty hole. Two assertions below close that: the loading fallback must be
 * gone, and each route must contribute at least one control of its OWN.
 *
 * `FRAME_CONTROLS` is measured, not guessed: at 390px the frame alone renders
 * five — the hamburger, the home link, and the Command/Library/Settings nav
 * items. Anything at or below that number is a route that rendered nothing.
 */
const FRAME = 'a[aria-label="ARC coach command center"]';
const FRAME_CONTROLS = 5;

/** Every visible control's height on every coach route, under a given
 *  input-device emulation. Returns per-route counts too, so a route that
 *  rendered nothing cannot hide inside a healthy total. */
async function heights({ hasTouch }) {
  const ctx = await browser.newContext({
    hasTouch,
    isMobile: hasTouch,
    viewport: hasTouch ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    /* No service worker in the harness, same as screens.mjs: it precaches the
       bundle while the run navigates away, which surfaces as a cancelled
       request, and it would carry a cache between routes. */
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await signInCoach(page, seed);
  const visible = () =>
    page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ h: Math.round(el.getBoundingClientRect().height), what: (el.getAttribute('aria-label') || el.className || el.tagName) + ' “' + (el.innerText || '').trim().slice(0, 30) + '”' })),
      SELECTOR,
    );
  let coarse = false;
  const hs = [];
  const perRoute = [];
  for (const route of ROUTES) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    // The bench is a lazy chunk; the FIRST coach navigation shows a real
    // Suspense fallback for longer than `networkidle` waits.
    await page.waitForSelector(FRAME, { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(350); // entrance transitions
    coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const loading = await page.evaluate(() =>
      /Loading coach workspace/.test(document.body.innerText || document.body.textContent || ''),
    );
    let found = await visible();
    // The DayBuilder's own controls only exist several clicks in — see WALK
    // below, and the note about this check learning to walk again.
    if (route.startsWith('/coach/day/')) found = found.concat(await walkDayBuilder(page, visible));
    perRoute.push([route, found.length, loading]);
    hs.push(...found);
  }
  await ctx.close();
  return { hs, coarse, perRoute };
}


/**
 * THE WALK, BACK — narrower than the one deleted on 14 August, and for the same
 * reason it was needed then.
 *
 * This file said, when the guided builder's four-click walk was dropped:
 * "Nothing here now walks into a control that only exists after several
 * clicks... if DayBuilder grows a multi-step path with a target at the end of
 * it, this is the file that should learn to walk again."
 *
 * It grew one on 16 August 2026. A day opens empty, so a flat measurement of
 * `/coach/day/:date` finds four controls and none of them are the ones a coach
 * spends their time on. Add a block, add an exercise, open the row, and the
 * exercise remove, the column selects and the set steppers appear — every one
 * of them smaller than 44px in its desktop size, and every one previously
 * unmeasured.
 *
 * It walks by VISIBLE TEXT rather than by class, so a rename that keeps the
 * screen working keeps this working, and a rename that breaks the screen
 * breaks this loudly at the step that no longer exists.
 */
async function walkDayBuilder(page, visible) {
  const step = async (name) => {
    const el = page.getByRole('button', { name }).first();
    if (!(await el.count())) throw new Error(`web-touch: DayBuilder walk stalled — no control matching ${name}`);
    await el.click();
    await page.waitForTimeout(120);
  };

  await step(/add block/i);

  /*
   * ON TOUCH THE PICKER IS BEHIND A DOOR, and this walk found that out the
   * hard way: `.cb-picker` is `display: none` under `pointer: coarse` until
   * `.picker-open`, so the movement list resolved to a real button that was
   * never visible. On a mouse the picker is open already and the reveal button
   * is the hidden one. Pressing it only when it is visible is what makes one
   * walk work under both emulations — and the fact that it is needed under
   * exactly one of them is the two-mode design proving itself.
   */
  const reveal = page.getByRole('button', { name: /add exercise from library/i }).first();
  if (await reveal.isVisible()) {
    await reveal.click();
    await page.waitForTimeout(120);
  }

  /*
   * THE LIBRARY STARTS EMPTY, since 16 August 2026 — the coach's own movement
   * list replaced the one mined out of every stored record. So this walk can
   * no longer assume there is something to pick, and it types a movement in
   * and creates it, which is the path a coach with a fresh library takes
   * anyway. It then picks that entry from the list, so what is measured is
   * still a real row reached through the picker and not a shortcut.
   *
   * This check FAILED, loudly and by name, the moment the library emptied.
   * That is the shape to keep: a walk that quietly measured nothing would
   * have reported green over a picker with no way through it.
   */
  const search = page.getByPlaceholder(/search the exercise library/i).first();
  await search.fill('Walk Test Squat');
  await page.getByRole('button', { name: /new exercise/i }).first().click();
  await page.waitForTimeout(150);

  const movement = page.locator('.cb-picker-list button').first();
  if (!(await movement.count())) throw new Error('web-touch: the exercise picker offered nothing to pick');

  // The row opens collapsed, and the sets table is behind it.
  const head = page.locator('.cb-item-head').first();
  if (!(await head.count())) throw new Error('web-touch: no exercise row appeared after picking a movement');
  await head.click();
  await page.waitForTimeout(150);

  const found = await visible();
  if (!found.some((c) => /remove a set|add a set/i.test(c.what))) {
    throw new Error('web-touch: the row opened but its set controls were not measurable');
  }
  return found;
}

const touch = await heights({ hasTouch: true });
const mouse = await heights({ hasTouch: false });

// If the emulation does not actually flip the media query, everything below is
// measuring the same thing twice and passing for the wrong reason.
check(touch.coarse === true, 'touch emulation reports pointer: coarse');
check(mouse.coarse === false, 'desktop emulation reports a fine pointer');

/* Per route, not just in total: the bench is one frame around a lazy outlet, so
   a pillar that never mounted still contributes the frame's five controls, and
   that failure must not be able to hide inside a healthy grand total. */
for (const [route, n, loading] of touch.perRoute) {
  check(!loading, `${route} left the "Loading coach workspace…" fallback`);
  check(
    n > FRAME_CONTROLS,
    `found controls of its own to measure on ${route} (${n} visible, ${FRAME_CONTROLS} of them the frame's)`,
  );
}

const heightsOnly = touch.hs.map((c) => c.h);
const short = touch.hs.filter((c) => c.h < MIN);
check(
  short.length === 0,
  short.length === 0
    ? `every visible control is >=${MIN}px on touch (smallest ${Math.min(...heightsOnly)}px, ${touch.hs.length} measured)`
    : `${short.length} control(s) under ${MIN}px on touch: ` +
      [...new Set(short.map((c) => c.h + 'px ' + c.what))].slice(0, 15).join(' | '),
);

// The whole point of scoping it to coarse pointers: desktop stays compact.
const mouseHeights = mouse.hs.map((c) => c.h);
check(
  Math.min(...mouseHeights) < MIN,
  `a mouse still gets the compact sizes (smallest ${Math.min(...mouseHeights)}px) — the rule is not global`,
);

/*
 * The other side of the 44px rule: what it must NOT reach.
 *
 * This measured the ATHLETE Calendar's day cells until 14 August 2026 — seven
 * buttons in a `grid-cols-7`, where a column on a 360px phone is ~38.6px, so a
 * 44px minimum on a square cell is wider than its own track and the month
 * spills sideways out of the card. That screen is parked and its address
 * redirects, so the assertion moves to the month grid that actually ships: the
 * coach Library's `.cal-grid`, whose cells are `minmax(0, 1fr)` and drop to
 * `min-height: 42px` under coach-redesign.css's own phone block, with an
 * absolutely-positioned `.cal-cell-tap` button inside each one.
 *
 * Say plainly what does and does not carry over. The property — a month grid
 * must fit its own track at phone widths rather than needing a sideways swipe —
 * is the same, measured the same way, at the same three widths. The specific
 * mechanism the old assertion pinned does NOT carry over: the athlete cells
 * opted out with `min-h-0` against a utility cascade, and these cells opt out
 * by being sized in a stylesheet the coarse rule only gives a `min-height` to.
 * Nothing now watches that `min-h-0` opt-out, because nothing renders it.
 *
 * This is the page-level companion to `checks/screens.mjs`'s overflow check,
 * not a duplicate of it: that one asks whether the DOCUMENT scrolls sideways,
 * this one asks whether the grid outgrew its own container — which can happen
 * inside a scroll wrapper without the page ever moving.
 */
for (const width of [320, 360, 390]) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await signInCoach(page, seed);
  await page.goto(base + '/coach/library', { waitUntil: 'networkidle' });
  await page.waitForSelector('.cal-grid .cal-cell', { timeout: 20000 });
  const grid = await page.evaluate(() => {
    const g = document.querySelector('.cal-grid');
    return { client: g.clientWidth, scroll: g.scrollWidth, parent: g.parentElement.clientWidth };
  });
  check(
    grid.scroll <= grid.client && grid.client <= grid.parent,
    `the coach Library's month fits its column track at ${width}px on touch (client ${grid.client}px, scroll ${grid.scroll}px, wrapper ${grid.parent}px)`,
  );
  await ctx.close();
}

await browser.close();
server.close();
console.log(fails ? `\n${fails} failure(s).` : '\nAll web touch checks passed.');
process.exit(fails ? 1 : 0);
