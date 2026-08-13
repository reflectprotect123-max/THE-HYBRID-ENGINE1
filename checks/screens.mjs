/*
 * Screenshot every screen of the athlete web app, against a realistically
 * populated database — plus the stage-1 `/coach` routes, added in the
 * coach-workspace redesign (11 August 2026) once a phone layout for the
 * coach bench was approved (see CLAUDE.md's "coach workspace" section).
 *
 * Mostly this is not a test — a screenshot cannot fail except the harness
 * itself, and it exists so a visual change can be judged by looking at it,
 * before and after, instead of by reading a diff and imagining the result.
 * THREE things here fail the run. Horizontal overflow at the 420px phone
 * viewport — a coach screen that needs sideways scrolling on a phone is
 * exactly the regression a phone-support claim must not get to make
 * silently (see `overflowWidth` below). For the coach shots only, a
 * missing piece of that screen's own stable chrome — proof the pillar
 * actually mounted rather than the workspace being stuck on its own
 * "Loading coach workspace…" fallback, which is narrow enough to pass the
 * overflow check clean while showing nothing real (see `assertContent`
 * below).
 *
 * And ANYTHING in `problems` — added 11 August 2026 by the Stage-1
 * whole-branch review, which found the commonest regression of all still
 * exiting 0. There is no error boundary anywhere in this repository
 * (`grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError"
 * apps/web/src` returns nothing), so one uncaught throw in one component
 * unmounts the entire React root and the page goes blank. A blank page has
 * no horizontal overflow, and for a coach shot the per-shot `catch` fired
 * before `assertContent` ever ran — so the run printed the page error under
 * a heading that said "these are real, fix them" and then exited 0. That
 * heading described a list nothing consulted.
 *
 * EVERY producer of `problems` is fatal, not just page errors: an uncaught
 * exception, a console error, and a shot that never completed are all real
 * defects, and a clean tree produces none of them (verified — the list is
 * empty on a green run). Splitting it into a fatal half and an advisory
 * half would rebuild the exact thing being fixed: a bucket that gets
 * printed and ignored. If genuinely benign console noise ever appears, the
 * fix is to silence or stub its source, not to reopen this bucket.
 *
 * The seed matters as much as the harness. An app screenshotted with an empty
 * store shows nothing but empty states, which is the one thing a design pass must
 * NOT be tuned against — every screen looks calm when there is nothing in it.
 * So this seeds eight weeks of plausible training: logged sessions with real
 * set data, conditioning with HR traces, a WHOOP reading, and PR-worthy lifts.
 *
 * The coach routes read the SAME local stores (`useDb()` / `useNutrition()`)
 * as the athlete app — every stage-1 pillar is gated `ClientDetailGate`
 * WITHOUT `layer3Ready`, so it only ever renders the signed-in account's own
 * training (see `ClientDetailGate.tsx`). `CoachAccess` still fails closed in
 * a production build, though, so reaching them needs a second, coach-enabled
 * bundle and a stored Supabase session — the same recipe
 * `checks/react-smoke.mjs` already uses for `/coach/legacy`.
 *
 * Run: node checks/screens.mjs [outDir]     (after `pnpm run build`)
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
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

function serve(port, dir = 'apps/web/dist') {
  const web = resolve(root, dir);
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
  // The third world's web surface. Home (01) carries the nutrition card above
  // it, so the two are judged together.
  ['09-nutrition', '/nutrition', null],
];

/*
 * Every `/coach` route, at the same 420px phone viewport as every athlete
 * shot above.
 *
 * This began as stage 1's five — the Command Center launcher and the four
 * pillars — with a note here saying `/coach/library` and `/coach/settings`
 * would "join once their own stage lands". They did (stages 3a and 2), and
 * stage 4 (13 August 2026) closes the set: `author`, `progression`,
 * `review/:weekStart`, `legacy`, `day/:date`, `build/:id`, `planner/:id` and
 * `roster-plan/:workoutId`. The spec calls stage 4 "a verification-and-repair
 * pass, not net-new work", and this table is the verification half.
 *
 * The third element is a list of patterns that must ALL match the rendered
 * page's text for the shot to count as real — see `assertContent` below for
 * why this exists and what it deliberately does not check. Every pattern
 * here is STABLE CHROME: a section label, a card heading, a tile name — text
 * that renders unconditionally once the real screen mounts, never a data
 * value. `hrvPoints`/`sleepPoints`/etc. legitimately read "Not enough
 * history yet." against this seed and would on a fresh database too; a
 * pattern that pinned a data value would fail every time the fixture
 * changes, which is how a check like this gets deleted instead of trusted.
 */
/*
 * Case-insensitive throughout (`i` flag): several of these labels sit under
 * CSS `text-transform: uppercase` (e.g. `.rd-section-label`), and Playwright
 * reads `innerText`, which reflects the RENDERED text — the transform, not
 * the source casing. A case-sensitive pattern against "Resting HR" fails
 * the instant the browser paints it as "RESTING HR", which is a false
 * alarm about the check, not a fact about the screen.
 */
/* Addresses for the parameterised coach routes, computed rather than
 * hardcoded so they stay valid tomorrow. `w1` is a workout `_seed.mjs`
 * actually creates; a date-shaped route pointed at nothing renders a
 * not-found state, which has no overflow and would pass while proving
 * nothing. */
const TODAY = new Date().toISOString().slice(0, 10);
const THIS_MONDAY = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
})();

const COACH_SHOTS = [
  ['12-coach', '/coach', [/Readiness/i, /Strength/i, /Conditioning/i, /Nutrition/i]],
  ['13-coach-readiness', '/coach/readiness', [/\bHRV\b/i, /Resting HR/i]],
  ['14-coach-strength', '/coach/strength', [/Lift trends/i, /Weekly hard-session budget/i]],
  ['15-coach-conditioning', '/coach/conditioning', [/Time in HR zone/i, /Erg trends/i]],
  ['16-coach-nutrition', '/coach/nutrition', [/Adherence . targets/i, /Weight trend/i]],
  // Stage 3a (11 August) cut this to the calendar alone; stage 3b (13 August)
  // put Programs back beside it. The Calendar tab is still what OPENS, so the
  // patterns stay calendar-first: the day-of-week row proves the month grid
  // actually mounted rather than the page shell rendering around an empty
  // panel, and the session-builder link is the Library's only door to
  // /coach/author — deleting it orphans the whole builder chain (see
  // coach-routes.test.tsx).
  // `Programs` is a TAB LABEL and would render whether or not the panel behind
  // it works, so it is deliberately NOT the proof that stage 3b shipped —
  // that is `ProgramsTab.test.tsx`'s job, driving the panel directly. An
  // assertion on chrome passes dishonestly, which is worse than no assertion.
  // (`.cal-dow` is `text-transform: uppercase`, and `innerText` reflects the
  // transform — hence the /i, exactly as the note above this table warns.)
  ['17-coach-library', '/coach/library', [/\bMon\b/i, /\bSun\b/i, /session builder/i, /Programs/i]],
  // Stage 2, 13 August 2026. The last /coach route to arrive here.
  // The patterns name text ONLY this screen shows, and deliberately reach
  // INSIDE the active panel rather than stopping at the tab column: the tab
  // labels render whichever section is open, so matching those alone would
  // pass against a screen whose panels never mounted. "Training week begins"
  // is a Workspace-panel row, and Workspace is the default section.
  ['18-coach-settings', '/coach/settings', [/Training week begins/i, /Default load unit/i, /Data . sync/i]],

  /*
   * Stage 4. The eight routes stages 1-3 left unshot.
   *
   * The parameterised ones are addressed with values this seed actually
   * contains — `w1` is a seeded workout, `TODAY` and `THIS_MONDAY` are
   * computed below — because a route shot with an id that resolves to
   * nothing renders a not-found state, and a not-found state has no
   * horizontal overflow. It would pass, and prove nothing.
   *
   * `roster-plan/:workoutId` is the one exception and is documented where it
   * sits, below.
   */
  ['19-coach-author', '/coach/author', [/Authoring/i]],
  ['20-coach-progression', '/coach/progression', [/Progression queue/i, /Lift trends/i]],
  ['21-coach-review', `/coach/review/${THIS_MONDAY}`, [/Week/i]],
  ['22-coach-legacy', '/coach/legacy', [/Program/i]],
  ['23-coach-day', `/coach/day/${TODAY}`, [/Session/i]],
  ['24-coach-build', '/coach/build/w1', [/What are we doing/i]],
  ['25-coach-planner', '/coach/planner/w1', [/Plan editor/i]],
  /*
   * `roster-plan` is gated `layer3Ready` and addresses a ROSTER workout. This
   * seed signs in a local account with no roster, so what renders here is the
   * gate, not the planner. That is worth shooting anyway — the gate is what a
   * coach in this state actually sees, and it must be usable at 420px like
   * anything else — but it must not be mistaken for coverage of RosterPlanner
   * itself, which stays unproven at phone width until there is a roster
   * fixture to reach it with.
   */
  ['26-coach-roster-plan', '/coach/roster-plan/w1', null],
];

/*
 * The gap this closes: `CoachCommandCenter` renders `aria-busy="true"
 * >Loading coach workspace…</main>` inside `ArcCoachFrame`'s `<Outlet/>`
 * whenever `clientsLoading || !selectedClient` — but the hamburger button
 * this file already waits on (`button[aria-label="Open coach navigation"]`)
 * is `<ArcCoachFrame>`'s own sibling of `<Outlet/>`, rendered
 * unconditionally. So that wait succeeds even when the pillar underneath it
 * never left its loading state — a short, narrow status line that produces
 * no horizontal overflow either. If `listClients()` regressed, or
 * `CoachAccess` failed a different way, this file could report "N/N, 0
 * overflow" against a permanently-loading workspace, on the strength of
 * which CLAUDE.md now asserts phone support as repository policy. This
 * makes that failure visible: every required pattern must match, and the
 * loading fallback's own text must NOT still be on the page.
 */
async function assertContent(page, label, path, patterns) {
  if (!patterns) return [];
  const text = await page.evaluate(() => document.body.innerText || document.body.textContent || '');
  const failures = [];
  const missing = patterns.filter((p) => !p.test(text));
  if (missing.length) {
    failures.push(label + ' (' + path + '): missing ' + missing.map((p) => p.source).join(', '));
  }
  if (/Loading coach workspace/.test(text)) {
    failures.push(label + ' (' + path + '): still showing the Suspense/loading fallback, not the real screen');
  }
  return failures;
}

/*
 * A screen wider than its own viewport is the one thing this file treats as
 * a real failure (see the header comment) — a phone user cannot see content
 * that only reveals itself through a sideways scroll. `scrollWidth` on both
 * `<html>` and `<body>` is checked because either can be the one that grew;
 * `clientWidth` is the viewport's own inner width, unaffected by the
 * overflow itself.
 */
async function overflowWidth(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const w = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
    return w > doc.clientWidth ? w : 0;
  });
}

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
const ctx = await browser.newContext({
  viewport: { width: 420, height: 900 },
  deviceScaleFactor: 2,
  /* No service worker in the harness (12 August 2026). The app now registers
     one above every route fork — it has to, or the coach bench cannot be
     installed as an app — and inside this harness that worker begins
     precaching the whole bundle while the shot navigates away, which surfaces
     as `net::ERR_FAILED` on a cancelled request and fails the run. It would
     also carry a cache between shots, which is the last thing a screenshot
     comparison wants. This checks LAYOUT; installability is not its job. */
  serviceWorkers: 'block',
});
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

const overflows = [];
/* Counted, not inferred from the arrays' lengths: a shot that threw before
   `screenshot()` leaves no file behind, and the old summary line reported it
   as written anyway ("Wrote 16 screens" while writing 15). */
let written = 0;

for (const [label, path] of SHOTS) {
  try {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350); // let entrance transitions settle
    await page.screenshot({ path: join(OUT, label + '.png'), fullPage: true });
    written += 1;
    const w = await overflowWidth(page);
    if (w) overflows.push(label + ': ' + w + 'px of content in a 420px viewport');
    console.log('  ' + label);
  } catch (e) {
    console.log('  ' + label + ' — FAILED: ' + e.message);
    problems.push(label + ': ' + e.message);
  }
}

server.close();

/*
 * ---- the coach bench ----
 *
 * `CoachAccess` fails closed in a production build (`checks/react-smoke.mjs`
 * explains why, in full, above its own copy of this recipe): with no
 * `VITE_COACH_USER_IDS` and `import.meta.env.DEV` false, `coachAllowed`
 * denies everyone. So the athlete `dist` built above cannot show `/coach` at
 * all — this builds a SECOND bundle, `apps/web/dist-coach`, whose allowlist
 * names one throwaway id, and hands the browser a matching stored Supabase
 * session before the first navigation. `dist-coach` is gitignored, never
 * deployed, and the id is a made-up UUID no real Supabase account can hold.
 *
 * The pillar routes are gated `ClientDetailGate` WITHOUT `layer3Ready`
 * (`ClientDetailGate.tsx`), so they only ever read the SIGNED-IN account's
 * own local stores — the same `hybrid-engine-v1` / `hybrid-nutrition-v1`
 * seed already built above is reused here, seeded into this second page's
 * own origin, so the pillars have real numbers to draw rather than empty
 * states.
 */
const COACH_UID = '00000000-0000-4000-8000-000000000002';
const COACH_DIR = 'apps/web/dist-coach';
const COACH_PORT = 4520;

console.log('\nBuilding a coach-enabled bundle for the coach shots (VITE_COACH_USER_IDS set)…');
execFileSync(
  'pnpm',
  ['--filter', '@hybrid/web', 'exec', 'vite', 'build', '--outDir', 'dist-coach', '--emptyOutDir'],
  { cwd: root, env: { ...process.env, VITE_COACH_USER_IDS: COACH_UID }, stdio: 'inherit' },
);

const coachServer = await serve(COACH_PORT, COACH_DIR);
const coachBase = 'http://127.0.0.1:' + COACH_PORT;
const contentFailures = [];

/*
 * One pass over every coach route at one viewport.
 *
 * There are TWO passes, and the desktop one is the one that was missing.
 * CLAUDE.md has said since 11 August that "1440px remains the width the
 * workspace is composed at and the default review width for every route under
 * /coach" — and until stage 4's close-out (13 August 2026) this file only ever
 * opened a 420px window. Every stage was proving the SECONDARY claim while the
 * primary one, about the surface a coach actually works on, went unwatched.
 * `/coach` is a desktop dashboard in a browser; it is not in the Android app
 * and there is no native coach surface to put it in.
 *
 * Horizontal overflow is failed at both widths. It means different things at
 * each: at 420px it is a phone screen needing a sideways swipe, and at 1440px
 * it is a layout that has outgrown the width it was composed at, which is
 * worse.
 */
async function coachPass(width, height, suffix) {
  const coachCtx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    /* No service worker in the harness (12 August 2026). The app now registers
       one above every route fork — it has to, or the coach bench cannot be
       installed as an app — and inside this harness that worker begins
       precaching the whole bundle while the shot navigates away, which surfaces
       as `net::ERR_FAILED` on a cancelled request and fails the run. It would
       also carry a cache between shots, which is the last thing a screenshot
       comparison wants. This checks LAYOUT; installability is not its job. */
    serviceWorkers: 'block',
  });
  const coachPage = await coachCtx.newPage();
  coachPage.on('pageerror', (e) => problems.push('coach pageerror: ' + e));
  coachPage.on('console', (m) => {
    if (m.type() === 'error') problems.push('coach console: ' + m.text());
  });

  /*
   * The bench must render from local state alone — every Supabase request is
   * intercepted, exactly as `checks/react-smoke.mjs` does for the same reason.
   * Unlike that check's `/coach/legacy` (which never calls
   * `CoachWorkspaceRepository.listClients()`), the Command Center at `/coach`
   * — and so every pillar reached through it — does, on mount
   * (`CoachWorkspaceContext.tsx`). A blanket `{}` for every request breaks it:
   * `listClients()` awaits `auth.getUser()` then queries
   * `coach_athlete_assignments` expecting a JSON ARRAY back, and a plain `{}`
   * makes `rows.map` throw, which rejects the whole call and leaves
   * `selectedClient` null forever — `CoachCommandCenter` then never leaves its
   * "Loading coach workspace…" state. Two shapes fixes it: the auth check gets
   * a user object, and every REST query gets `[]`, which is a true answer
   * anyway — this throwaway id really does have zero roster assignments — and
   * resolves to just `ENGINE_LOCAL`, the signed-in coach's own entry
   * (`cloud/coach-repository.ts`), exactly like a fresh account with no roster
   * yet would.
   */
  await coachPage.route('**/*.supabase.co/**', (r) => {
    const url = r.request().url();
    if (url.includes('/auth/v1/user')) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: COACH_UID, aud: 'authenticated', role: 'authenticated', email: 'coach@example.com',
          app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
        }),
      });
    }
    if (url.includes('/rest/v1/')) {
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await coachPage.addInitScript(
    (s) => {
      const expires = Math.floor(Date.now() / 1000) + 86400;
      localStorage.setItem(
        'sb-orysjncrksmdfabpuftd-auth-token',
        JSON.stringify({
          access_token: 'fake.' + btoa(JSON.stringify({ sub: s.uid, exp: expires })) + '.sig',
          token_type: 'bearer',
          expires_in: 86400,
          expires_at: expires,
          refresh_token: 'fake-refresh',
          user: {
            id: s.uid, aud: 'authenticated', role: 'authenticated', email: 'coach@example.com',
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
          },
        }),
      );
      if (!localStorage.getItem('hybrid-engine-v1')) {
        localStorage.setItem('hybrid-engine-v1', JSON.stringify(s.db));
      }
      if (!localStorage.getItem('hybrid-nutrition-v1')) {
        localStorage.setItem('hybrid-nutrition-v1', JSON.stringify(s.nutrition));
      }
    },
    { uid: COACH_UID, db: seed.db, nutrition: seed.nutrition },
  );

  
  for (const [label, path, patterns] of COACH_SHOTS) {
    try {
      await coachPage.goto(coachBase + path, { waitUntil: 'networkidle' });
      // The bench is `React.lazy`-loaded as its own chunk (index.tsx's own
      // comment explains why: athlete navigation never fetches it). The FIRST
      // coach navigation shows "Loading coach workspace…" — a real Suspense
      // fallback, not a slow network — for longer than `networkidle` waits, so
      // wait for a piece of the frame that owns every coach route instead of a
      // fixed delay. The hamburger trigger, not the nav list it opens: below
      // ArcCoachFrame's `sm` breakpoint the drawer nav is `invisible` until
      // opened (ArcCoachFrame.tsx), by design — waiting on it would wait
      // forever at 420px. NOTE: this element is `<ArcCoachFrame>`'s own,
      // rendered unconditionally as a sibling of `<Outlet/>` — it existing
      // proves the FRAME mounted, not that the pillar inside it did. That is
      // what `assertContent` below is for.
      /*
     * WIDTH-AGNOSTIC on purpose. This waited on
     * `button[aria-label="Open coach navigation"]` while there was only a
     * 420px pass, and that button lives in a `sm:hidden` bar — so the first
     * 1440px run timed out on all fifteen routes. The `<aside>`'s own home
     * link is in the DOM at every width instead.
     *
     * `state: 'attached'`, not the default 'visible': below `sm` the aside is
     * off-canvas until the drawer opens, so a visibility wait would hang at
     * 420px for exactly the reason the hamburger was chosen originally.
     * Attachment is all this ever claimed to prove — that the FRAME mounted,
     * not the pillar inside it. `assertContent` below is what proves that.
     */
    await coachPage.waitForSelector('a[aria-label="ARC coach command center"]', { state: 'attached', timeout: 15000 });
      await coachPage.waitForTimeout(350); // let entrance transitions settle
      await coachPage.screenshot({ path: join(OUT, label + suffix + '.png'), fullPage: true });
      written += 1;
      const w = await overflowWidth(coachPage);
      if (w) overflows.push(label + suffix + ': ' + w + 'px of content in a ' + width + 'px viewport');
      contentFailures.push(...(await assertContent(coachPage, label + suffix, path, patterns)));
      console.log('  ' + label + suffix);
    } catch (e) {
      console.log('  ' + label + ' — FAILED: ' + e.message);
      problems.push(label + suffix + ': ' + e.message);
    }
  }

  await coachCtx.close();
}

// Desktop FIRST: it is the primary surface, and reading the log top-down
// should say so.
await coachPass(1440, 1000, '@1440');
await coachPass(420, 900, '@420');

await browser.close();
coachServer.close();

const expected = SHOTS.length + COACH_SHOTS.length * 2; // two coach passes: 1440 and 420
console.log(
  '\nWrote ' + written + ' of ' + expected + ' screens (' + SHOTS.length + ' athlete, ' +
  COACH_SHOTS.length * 2 + ' coach, at 1440px and 420px) to ' + OUT,
);
const uniqueProblems = [...new Set(problems)];
if (uniqueProblems.length) {
  console.log('\nFAIL — page errors, console errors or shots that never completed:');
  for (const p of uniqueProblems) console.log('  ' + p);
}
if (overflows.length) {
  console.log('\nFAIL — horizontal overflow (label carries the viewport):');
  for (const o of overflows) console.log('  ' + o);
}
if (contentFailures.length) {
  console.log('\nFAIL — coach screen did not render its real content:');
  for (const c of contentFailures) console.log('  ' + c);
}
if (uniqueProblems.length || overflows.length || contentFailures.length || written !== expected) {
  if (written !== expected) console.log('\nFAIL — ' + (expected - written) + ' screen(s) were never captured.');
  process.exit(1);
}
