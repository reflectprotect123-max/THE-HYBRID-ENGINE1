/*
 * The coach surface's contract, made executable.
 *
 * A document tells an agent what to do; it does not stop it. This does.
 * Every assertion below encodes a constraint that, when broken, produces a
 * coach surface that looks finished and is wrong — and each of them has
 * already been broken once, by a well-intentioned build against the same
 * written brief.
 *
 * These are STATIC assertions over source text. That is a deliberate ceiling:
 * they cannot prove a design is right, only catch the specific wrong shapes
 * that are cheap to detect and expensive to discover late. A finding here is
 * always real; silence here is not a certificate.
 *
 * Run: node checks/coach-contract.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

const fail = (name, detail) => {
  failures++;
  console.error(`FAIL — ${name}\n       ${detail}`);
};
const pass = (name) => console.log(`  PASS — ${name}`);

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
};

const read = (f) => readFileSync(f, 'utf8');
/* Comments explain the rules as often as they break them, so a naive grep over
   raw source reports the documentation as a violation. Strip comments first. */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sourceFiles = (dir) => walk(resolve(ROOT, dir)).filter((f) => !/\.test\.tsx?$/.test(f));

console.log('Coach surface contract\n');

/* ---------------------------------------------------------------------------
 * 1. The coach surface must not reach the backend directly.
 *
 * Every RLS policy is `auth.uid() = user_id`, and RLS FILTERS rather than
 * raising — so a coach query for another athlete returns empty, not an error,
 * and the screen simply looks like the athlete has no data. Today the bench
 * reads the local store only. If that changes, it must be a decision somebody
 * makes deliberately, not a line that slips in.
 * ------------------------------------------------------------------------- */
{
  const offenders = [];
  for (const dir of ['apps/web/src/coach', 'apps/web/src/autocoach']) {
    for (const f of sourceFiles(dir)) {
      const src = code(f);
      if (/\bclient\s*\.\s*from\s*\(|\bsupabase\w*\s*\.\s*from\s*\(|\.rpc\s*\(/.test(src)) {
        offenders.push(relative(ROOT, f));
      }
    }
  }
  if (offenders.length) {
    fail(
      'the coach surface does not query the backend directly',
      `These files call Supabase: ${offenders.join(', ')}.\n` +
        '       There is no coach-athlete RLS policy, so a per-athlete query returns an\n' +
        '       EMPTY result rather than an error. If multi-athlete access is now intended,\n' +
        '       it needs tables and policies first — see docs/COACH_INTEGRATION.md.',
    );
  } else pass('the coach surface does not query the backend directly');
}

/* ---------------------------------------------------------------------------
 * 2. The Coordinator is the only writer of a weekly plan.
 *
 * A coach steers INPUTS. Anything that mints a WeeklyPlan outside the
 * coordinator package is hand-placing sessions, which this architecture does
 * not permit.
 * ------------------------------------------------------------------------- */
{
  const offenders = [];
  for (const dir of ['apps/web/src', 'apps/mobile/src']) {
    for (const f of sourceFiles(dir)) {
      const src = code(f);
      /* A TYPE annotation (`writer: 'coordinator'` inside a `type X = {...}`)
         describes what the server returns and mints nothing. Only an object
         literal assignment does. Requiring a following comma-or-brace on the
         same statement is crude but distinguishes the two in practice. */
      const minted = /writer\s*:\s*['"]coordinator['"]\s*,/.test(src) && !/^type\s|\btype\s+\w+\s*=/m.test(src.split(/writer\s*:/)[0].split('\n').slice(-6).join('\n'));
      if (minted) offenders.push(relative(ROOT, f));
    }
  }
  if (offenders.length) {
    fail(
      'only the coordinator package claims the coordinator writer identity',
      `App code claiming writer:'coordinator': ${offenders.join(', ')}.\n` +
        '       The weekly plan has exactly one author by design.',
    );
  } else pass('only the coordinator package claims the coordinator writer identity');
}

/* ---------------------------------------------------------------------------
 * 3. The Coordinator arbitrates TRAINING only.
 *
 * Nutrition informs training through whole-athlete-state as CONTEXT. A
 * nutrition import inside the coordinator means a macro target is being allowed
 * to influence a training decision directly.
 * ------------------------------------------------------------------------- */
{
  const offenders = sourceFiles('packages/coordinator/src').filter((f) =>
    /(?:from|import)\s*\(?\s*['"]@hybrid\/nutrition/.test(code(f)),
  );
  if (offenders.length) {
    fail(
      'the coordinator does not import nutrition',
      `${offenders.map((f) => relative(ROOT, f)).join(', ')} imports a nutrition package.`,
    );
  } else pass('the coordinator does not import nutrition');
}

/* ---------------------------------------------------------------------------
 * 4. Safety has its own reason codes, distinct from capacity.
 *
 * Pain and illness must DROP a session, not scale it, and must stay
 * distinguishable from "there was no room this week". Collapsing them into a
 * generic drop is how a safety event becomes invisible in a review surface.
 * ------------------------------------------------------------------------- */
{
  const types = read(resolve(ROOT, 'packages/coordinator/src/types.ts'));
  const required = ['dropped_pain_safety', 'dropped_illness_safety', 'dropped_interference'];
  const missing = required.filter((c) => !types.includes(c));
  if (missing.length) {
    fail('safety and interference reason codes exist and are distinct', `Missing: ${missing.join(', ')}.`);
  } else pass('safety and interference reason codes exist and are distinct');
}

/* ---------------------------------------------------------------------------
 * 5. The coach allowlist is a UI gate, never a data scope.
 *
 * VITE_COACH_USER_IDS decides who SEES /coach. If it ever reaches a query or a
 * data filter it starts looking like authorization, which it is not — the
 * authorization boundary is RLS, and this list is client-side and trivially
 * editable.
 * ------------------------------------------------------------------------- */
{
  const offenders = [];
  for (const f of sourceFiles('apps/web/src')) {
    const src = code(f);
    if (!src.includes('VITE_COACH_USER_IDS')) continue;
    // Contract paths are repository paths, not host-OS paths. Normalising here
    // keeps the allowlist check identical on Windows and POSIX runners.
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    if (!/coach\/(guard|CoachShell)\.tsx?$/.test(rel)) offenders.push(rel);
  }
  if (offenders.length) {
    fail(
      'the coach allowlist stays a UI gate',
      `VITE_COACH_USER_IDS is read outside the guard in: ${offenders.join(', ')}.\n` +
        '       It is client-side and editable — it is not an authorization boundary.',
    );
  } else pass('the coach allowlist stays a UI gate');
}

/* ---------------------------------------------------------------------------
 * 6. Deletes are tombstones, in the coach surface too.
 *
 * A splice returns from the other device on the next sync, taking the deletion
 * with it. This has cost real user data twice.
 * ------------------------------------------------------------------------- */
{
  const offenders = [];
  for (const dir of ['apps/web/src/coach', 'apps/web/src/autocoach']) {
    for (const f of sourceFiles(dir)) {
      /* Only TOP-LEVEL record arrays. Splicing a set out of a workout being
         authored is editing content; the workout is the record. What must
         never be spliced without a tombstone is the record itself. */
      const src = code(f);
      const spliced = /\b(workouts|sessions|logEntries|weightEntries|customFoods|recipes)\s*\.splice\s*\(/.test(src);
      const tombstoned = /\btombstone\s*\(|deletedIds|deletedAt/.test(src);
      if (spliced && !tombstoned) offenders.push(relative(ROOT, f));
    }
  }
  if (offenders.length) {
    fail(
      'the coach surface never splices a record out',
      `${offenders.join(', ')} calls .splice(). Deleting stamps deletedAt.`,
    );
  } else pass('the coach surface never splices a record out');
}

/* ---------------------------------------------------------------------------
 * 7. Athlete performance may propose progression; it may not apply it.
 *
 * A completed set or conditioning result is an actual. Turning it directly
 * into the next prescription collapses actual, proposal and coach decision
 * into one invisible mutation. Increases are approval-only in v1.
 * ------------------------------------------------------------------------- */
{
  const targets = [
    'apps/web/src/screens/Training.tsx',
    'apps/web/src/screens/Conditioning.tsx',
    'apps/web/src/screens/Logger.tsx',
    // The mobile Logger is the surface athletes actually train from — the
    // same collapse-of-actual-into-prescription rule 7 forbids on web was
    // found here too (2026-08-08) and fixed the same way: delete the write,
    // keep the hint informational. Listed explicitly rather than globbed, so
    // a NEW mobile screen that reintroduces this pattern is still caught the
    // moment someone adds it here — silence was exactly how this one hid.
    'apps/mobile/src/screens/Logger.tsx',
  ];
  const forbidden = [
    /liftProgress\s*=\s*liftAdapt\s*\(/,
    /conProgress\s*=\s*conAdapt\s*\(/,
    /settings\.conProgress\s*=\s*conProgress\b/,
    /\.aVal\s*=\s*String\s*\(\s*adj\.newWeight\s*\)/,
  ];
  const offenders = targets.filter((file) => forbidden.some((pattern) => pattern.test(code(resolve(ROOT, file)))));
  if (offenders.length) {
    fail(
      'athlete performance creates proposals instead of applying progression',
      `${offenders.join(', ')} automatically mutates a future prescription from an athlete actual.`,
    );
  } else pass('athlete performance creates proposals instead of applying progression');
}

/* ---------------------------------------------------------------------------
 * 8. The standalone coach workspace cannot fall into athlete navigation.
 *
 * Shared authoring components are allowed, but every doorway and return path
 * must remain under /coach. The single-file artifact also guards its hash.
 * ------------------------------------------------------------------------- */
{
  const coachDoorways = [
    'apps/web/src/coach/CoachAuthoring.tsx',
    'apps/web/src/coach/ResolutionPreview.tsx',
    'apps/web/src/coach/SessionDrawer.tsx',
  ];
  const offenders = coachDoorways.filter((file) => /[`'"]\/(?:build|planner)\//.test(code(resolve(ROOT, file))));
  const coachRouter = code(resolve(ROOT, 'apps/web/src/coach/index.tsx'));
  const generator = read(resolve(ROOT, 'tooling/build-single-html.mjs'));
  if (!coachRouter.includes('path="planner/:id"') || !coachRouter.includes('path="build/:id"')) offenders.push('apps/web/src/coach/index.tsx');
  if (!generator.includes("location.hash.startsWith('#/coach')")) offenders.push('tooling/build-single-html.mjs');
  const athleteRoutes = /[`'"]\/(?:training|library|conditioning|history|progress|exercise|calendar|day|recap|nutrition|settings|log)(?:\/|[`'"])/;
  for (const file of sourceFiles('apps/web/src/coach')) {
    const navigationCode = code(file).replace(/\.includes\(\s*['"][^'"]+['"]\s*\)/g, '');
    if (athleteRoutes.test(navigationCode)) offenders.push(relative(ROOT, file));
  }
  if (offenders.length) {
    fail('the standalone coach workspace stays on coach routes', `Route leak or missing guard: ${offenders.join(', ')}.`);
  } else pass('the standalone coach workspace stays on coach routes');
}

/* ---------------------------------------------------------------------------
 * 9. A roster client's screen never shows the SIGNED-IN account's own
 *    training data as if it were theirs.
 *
 * `useDb()` / `useNutrition()` / the progression and authoring ledgers are the
 * signed-in account's own local stores — correct only while `engine-local` is
 * selected. Every route that reads them behind `/coach/author`, `/nutrition`,
 * `/progression`, `/review/:weekStart`, `/legacy`, `/build/:id` and
 * `/planner/:id` must be wrapped in `ClientDetailGate`, which blocks instead
 * of merely disclosing (see ClientDetailGate.tsx's own header comment for
 * why a disclosure banner a coach can act past is not a guard).
 *
 * CoachCommandCenter is the one screen that is NOT fully behind that gate —
 * its client-overview sections are meant to render for every client — so its
 * two sections that read local athlete state directly (the resolved week,
 * and readiness/capacity/trends) are checked individually: each risky read
 * must sit close enough after the literal token `isLocalClient` in the source
 * that removing the gate is the only way to make this check pass again.
 * ------------------------------------------------------------------------- */
{
  const routerFile = 'apps/web/src/coach/index.tsx';
  const router = code(resolve(ROOT, routerFile));
  const gatedPaths = ['author', 'nutrition', 'progression', 'review/:weekStart', 'legacy', 'build/:id', 'planner/:id'];
  const ungatedRoutes = gatedPaths.filter((path) => {
    // The route line itself, e.g. `<Route path="author" element={<ClientDetailGate ...`
    const line = new RegExp(`path="${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*element=\\{<ClientDetailGate\\b`);
    return !line.test(router);
  });
  if (ungatedRoutes.length) {
    fail(
      "a roster client's screen never shows the signed-in account's own training as theirs",
      `${routerFile} routes not wrapped in <ClientDetailGate>: ${ungatedRoutes.join(', ')}.`,
    );
  } else pass("every coach detail route is behind ClientDetailGate");

  const ccFile = 'apps/web/src/coach/CoachCommandCenter.tsx';
  const cc = code(resolve(ROOT, ccFile));
  const GUARD = 'isLocalClient';
  const riskyMarkers = ['<AthleteStatus', 'weeklyPlan.entries.map', 'athleteState.readiness.band'];
  const unguarded = riskyMarkers.filter((marker) => {
    const at = cc.indexOf(marker);
    if (at === -1) return true; // moved or renamed — fail closed, do not silently pass
    const before = cc.slice(Math.max(0, at - 500), at);
    return !before.includes(GUARD);
  });
  if (unguarded.length) {
    fail(
      'CoachCommandCenter never renders local athlete state unguarded',
      `${ccFile} has ${unguarded.join(', ')} not preceded by an '${GUARD}' guard within 500 characters.`,
    );
  } else pass("CoachCommandCenter's local-only sections stay behind isLocalClient");
}

console.log(
  failures ? `\n${failures} FAILURE(S)` : '\nAll coach contract checks passed.',
);
process.exit(failures ? 1 : 0);
