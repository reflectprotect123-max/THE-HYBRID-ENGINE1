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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

const fail = (name, detail) => {
  failures++;
  console.error(`FAIL — ${name}\n       ${detail}`);
};
const pass = (name) => console.log(`  PASS — ${name}`);

/* A directory named here and missing on disk is a FAILURE, not a crash.
 *
 * `apps/web/src/autocoach` was listed below and deleted on 14 August 2026 with
 * `@hybrid/auto-coach`, and the bare `readdirSync` threw ENOENT — which killed
 * the process before `process.exit(failures ? 1 : 0)`, so the check reported
 * nothing at all rather than reporting a problem. This file has been bitten by
 * that exact shape before. A scan directory that has vanished is now a named
 * failure, so the message says which list to update. */
const MISSING_DIRS = [];
const walk = (dir) => {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    MISSING_DIRS.push(relative(ROOT, dir));
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
};

/* A file named here and missing on disk is a FAILURE, not a crash — the same
   rule the directory walk above follows, and added for the same reason on the
   same day. `SessionDrawer.tsx` was deleted with the legacy bench while still
   listed in `coachDoorways`, and the bare `readFileSync` threw ENOENT, killing
   the process before it could report anything. That is the FOURTH time this
   repository has hit crash-instead-of-fail; the directory guard did not cover
   it because this reads a specific file. */
const MISSING_FILES = [];
const read = (f) => {
  try {
    return readFileSync(f, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    MISSING_FILES.push(relative(ROOT, f));
    return '';
  }
};
/* Comments explain the rules as often as they break them, so a naive grep over
   raw source reports the documentation as a violation. Strip comments first. */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sourceFiles = (dir) => walk(resolve(ROOT, dir)).filter((f) => !/\.test\.tsx?$/.test(f));

/* The coach surface's own directories. `apps/web/src/autocoach` was here until
   14 August 2026 and went with `@hybrid/auto-coach` — the whole folder, not
   just its auto-coach parts. */
const SCAN_DIRS = ['apps/web/src/coach'];

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
  for (const dir of SCAN_DIRS) {
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
 * 2. Nothing mints a `writer: 'coordinator'` weekly plan.
 *
 * This rule read "the Coordinator is the only writer of a weekly plan — a
 * coach steers INPUTS, and anything that mints a WeeklyPlan outside the
 * coordinator package is hand-placing sessions". Two things happened to it.
 * On 13 August 2026 the coach became a legitimate second writer
 * (`writer in ('coordinator','coach')`). On 14 August the Coordinator was
 * DELETED, so the exempt package no longer exists and nothing computes a
 * coordinator week at all.
 *
 * The scan is unchanged and still worth running: `writer: 'coordinator'` in
 * app code would now be a lie about provenance, claiming an author that
 * cannot have written it. Reading the value back off a server row is fine and
 * is not what this matches — see the TYPE-annotation note below, which is why
 * `apps/mobile/src/cloud/ecosystem.ts`'s `planRow.writer || 'coordinator'`
 * default is not an offender.
 * ------------------------------------------------------------------------- */
{
  const offenders = [];
  for (const dir of ['apps/web/src']) {
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
 * 3. The layer that decides training reads nutrition as CONTEXT, never direct.
 *
 * REPOINTED TWICE, on the same day, and the second move is the interesting one.
 *
 * It began at `packages/coordinator/src`: a nutrition import inside the
 * Coordinator meant a macro target was influencing a training decision
 * directly. The Coordinator was deleted on 14 August 2026 and the rule moved to
 * `packages/auto-coach/src`, the layer that then decided what happened to a
 * session. `@hybrid/auto-coach` was deleted hours later, so it has moved again
 * — to `packages/whole-athlete-state/src`.
 *
 * That is not a third-choice landing spot. Nothing arbitrates a week and
 * nothing resolves a session any more, so whole-athlete-state is the LAST
 * layer that interprets an athlete's context into anything training-shaped,
 * and CLAUDE.md names it directly: it "may read nutrition FACTS — energy
 * availability, adherence — as context that shapes constraints. It must not
 * read a nutrition target as an instruction."
 *
 * The assertion is meaningful there rather than tautological: the package's
 * only `@hybrid` dependency is `shared-core`, so nutrition reaches it as DATA
 * inside a snapshot and never as a package it can call. Adding a nutrition
 * import would be precisely the shortcut this has guarded against under three
 * different owners.
 * ------------------------------------------------------------------------- */
{
  const offenders = sourceFiles('packages/whole-athlete-state/src').filter((f) =>
    /(?:from|import)\s*\(?\s*['"]@hybrid\/nutrition/.test(code(f)),
  );
  if (offenders.length) {
    fail(
      'the layer that interprets context does not import nutrition',
      `${offenders.map((f) => relative(ROOT, f)).join(', ')} imports a nutrition package.`,
    );
  } else pass('the layer that interprets context does not import nutrition');
}

/* ---------------------------------------------------------------------------
 * 4. Safety has its own reason codes, distinct from capacity.
 *
 * Pain and illness must DROP a session, not scale it, and must stay
 * distinguishable from "there was no room this week". Collapsing them into a
 * generic drop is how a safety event becomes invisible in a review surface.
 * ------------------------------------------------------------------------- */
/*
 * REPOINTED 14 August 2026. This read `packages/coordinator/src/types.ts` for
 * `dropped_pain_safety` / `dropped_illness_safety` / `dropped_interference`.
 * That file is deleted with the Coordinator.
 *
 * The property is not: pain and illness still have their OWN codes, distinct
 * from capacity, and they are emitted by `@hybrid/whole-athlete-state`, which
 * is where CLAUDE.md says recovery, pain and illness logic belongs. So the
 * check follows the codes to the layer that still produces them.
 *
 * `dropped_interference` is deliberately NOT in the list any more. It was a
 * scheduling verdict — two sessions too close together — which only the
 * Coordinator ever reached. Requiring it here would be requiring a code
 * nothing can emit, which is how a check starts failing for being right.
 */
{
  const state = read(resolve(ROOT, 'packages/whole-athlete-state/src/state.ts'));
  const safety = ['pain_hold_active', 'illness_flag_active'];
  const capacity = ['low_readiness', 'recovery_debt_high'];
  const missing = [...safety, ...capacity].filter((c) => !state.includes(c));
  if (missing.length) {
    fail('safety codes exist and stay distinct from capacity codes', `Missing: ${missing.join(', ')}.`);
  } else if (safety.some((c) => capacity.includes(c))) {
    fail('safety codes exist and stay distinct from capacity codes', 'A safety code is also a capacity code.');
  } else pass('safety codes exist and stay distinct from capacity codes');
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
    // `coach/access/` since 15 August 2026, when the flat coach directory was
    // sorted into buckets. The two files this exempts are the guard itself and
    // the component that renders its verdict, and they now live together —
    // which is the point of the bucket. Anchored on the directory rather than
    // loosened to a bare filename: a `guard.ts` appearing anywhere else under
    // coach/ is exactly what this rule exists to catch.
    if (!/coach\/access\/(guard|CoachAccess)\.tsx?$/.test(rel)) offenders.push(rel);
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
  for (const dir of SCAN_DIRS) {
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
    // THE WEB ENTRIES ARE GONE (15 August 2026). `screens/Training.tsx` and
    // `screens/Conditioning.tsx` were the original two, and
    // `screens/Logger.tsx` a third until 13 August. All three are deleted with
    // the rest of the athlete web surface, so this rule is now enforced on
    // MOBILE ONLY — which is where an athlete actually completes a set.
    //
    // That is a narrowing, and it is recorded rather than glossed: the rule
    // still means what it meant, but the web half of it can no longer be
    // violated because the web half of the app does not exist.
    //
    // The mobile logging surface is where athletes actually train — the same
    // collapse-of-actual-into-prescription rule 7 forbids on web was found
    // here too (2026-08-08) and fixed the same way: delete the write, keep
    // the hint informational. Listed explicitly rather than globbed, so a NEW
    // mobile screen that reintroduces this pattern is still caught the moment
    // someone adds it here — silence was exactly how this one hid.
    //
    // `apps/mobile/src/screens/Logger.tsx` was the entry until slice 6
    // replaced it with the round-major logger in `screens/logger/`.
    // `SessionLogger.tsx` was ITS successor — and was deleted with the rest
    // of the strength logger on 17 August 2026 (the fire-sale rebuild), which
    // put this check red exactly as the paragraph below the list demands: a
    // stale entry makes the coverage claim false. Removed 19 August 2026.
    //
    // THAT LEAVES THE LIST EMPTY, and an empty list makes this rule
    // momentarily vacuous — stated rather than hidden. When Phase C of the
    // strength rebuild ships the new logger, its logging surface joins this
    // list in the same commit; until then there is no strength logging
    // surface on which the rule could be violated. (Training.tsx and
    // Conditioning.tsx remain deliberately un-listed — the KNOWN GAP below.)
    //
    // KNOWN GAP, recorded rather than quietly enforced or quietly dropped.
    // `apps/mobile/src/screens/Training.tsx` and `Conditioning.tsx` DO match
    // the forbidden patterns: both bank the next prescription in the same
    // `update()` that closes the session (`liftProgress = liftAdapt(...)`,
    // `d.settings.conProgress = conProgress`). Their web counterparts above
    // had that write removed; the mobile ones never did, and were never in
    // this list, so nothing has ever failed over it.
    //
    // They are NOT added here yet, because adding them turns a check green-to-
    // red on behaviour that is deliberate on its face — the comment at
    // Training.tsx:148 explains banking it atomically so a crash cannot leave
    // a finished session that progressed nothing — and because self-coached
    // progression on the athlete's own device is a different question from
    // "a coach's athlete progressed without the coach deciding". Making that
    // call is a product decision, not a check-file edit. Found 13 August 2026
    // while repairing this check's ENOENT crash.
  ];
  const forbidden = [
    /liftProgress\s*=\s*liftAdapt\s*\(/,
    /conProgress\s*=\s*conAdapt\s*\(/,
    /settings\.conProgress\s*=\s*conProgress\b/,
    /\.aVal\s*=\s*String\s*\(\s*adj\.newWeight\s*\)/,
  ];
  /* A listed target that no longer exists is a FAILURE, not a crash and not a
     silent skip. Deleting a screen is allowed; leaving its name here afterwards
     is not, because the list is the only record of which surfaces this rule
     covers and a stale entry makes the coverage claim false. */
  const missing = targets.filter((file) => !existsSync(resolve(ROOT, file)));
  if (missing.length) {
    fail(
      'athlete performance creates proposals instead of applying progression',
      `${missing.join(', ')} is listed here but does not exist. If the screen was deleted on purpose, delete it from this list too.`,
    );
  } else {
    const offenders = targets.filter((file) => forbidden.some((pattern) => pattern.test(code(resolve(ROOT, file)))));
    if (offenders.length) {
      fail(
        'athlete performance creates proposals instead of applying progression',
        `${offenders.join(', ')} automatically mutates a future prescription from an athlete actual.`,
      );
    } else pass('athlete performance creates proposals instead of applying progression');
  }
}

/* ---------------------------------------------------------------------------
 * 8. The standalone coach workspace cannot fall into athlete navigation.
 *
 * Shared authoring components are allowed, but every doorway and return path
 * must remain under /coach. The single-file artifact also guards its hash.
 * ------------------------------------------------------------------------- */
{
  /*
   * These three linked ONWARD into the builder chain — `CoachAuthoring` into
   * `/coach/build/:id` and `/coach/planner/:id`, the other two into
   * `/coach/planner/:id` from the legacy bench. The rule was that a root-level
   * `/build/` or `/planner/` here is an athlete-lane address; the `/coach`
   * prefix is what kept them home.
   *
   * 14 August 2026: `CoachAuthoring.tsx` is deleted and both onward links were
   * removed from the other two. The doorway rule is kept and INVERTED for the
   * routes themselves below — the addresses are gone, so referencing them at
   * all is now the defect, prefixed or not.
   */
  /* `ResolutionPreview.tsx` was the third entry until 14 August 2026; it was
     deleted with the Coordinator whose decisions it rendered. */
  /* `SessionDrawer.tsx` was the second entry until 14 August 2026, and
     `ResolutionPreview.tsx` the third before that. Both were deleted with the
     surfaces they belonged to. A doorway that no longer exists cannot point
     anywhere, so it leaves the list rather than being read from disk. */
  const coachDoorways = ['apps/web/src/coach/screens/CoachLibrary.tsx'];
  const offenders = coachDoorways.filter((file) => /[`'"]\/(?:build|planner)\//.test(code(resolve(ROOT, file))));
  const coachRouter = code(resolve(ROOT, 'apps/web/src/coach/index.tsx'));
  /*
   * This asserted the OPPOSITE until 14 August 2026 — that the router still
   * declared `build/:id` and `planner/:id`, so nobody could delete a route and
   * leave a doorway pointing at a hole. The screens behind them (GuidedBuilder,
   * Planner, CoachAuthoring, RosterPlanner) are now deleted deliberately, so
   * the assertion flips rather than being dropped: re-declaring any of the four
   * routes fails here, because the components they mounted no longer exist and
   * a route without a screen is the hole this rule was always about.
   */
  /* `path="legacy"` joined this list on 14 August 2026 — the old CoachShell
     program bench, deleted with the screen. It was reachable only by typing
     the address, which is the shape of back door this guard exists to keep
     shut once a decision has been made. */
  const deletedRoutes = ['path="author"', 'path="build/:id"', 'path="planner/:id"', 'path="roster-plan/:workoutId"', 'path="legacy"'];
  if (deletedRoutes.some((decl) => coachRouter.includes(decl))) offenders.push('apps/web/src/coach/index.tsx');
  /*
   * The single-HTML artifact generator was the third thing this rule watched,
   * and it is DELETED (15 August 2026) along with the whole artifact chain —
   * scripts/build-artifact.mjs, both artifact vite configs, and
   * checks/artifact-smoke.mjs. It built the ATHLETE app as one sandboxed
   * document and ran nowhere: not in CI, not in any deploy, only by hand.
   *
   * The assertion is removed rather than repointed because there is nothing
   * left to repoint it AT. Reading a deleted file here is exactly the
   * crash-instead-of-fail shape this file has already hit three times: `read`
   * would throw ENOENT and kill the process before `process.exit(failures ? 1
   * : 0)` could report anything.
   */
  const athleteRoutes = /[`'"]\/(?:training|library|conditioning|history|progress|exercise|calendar|day|recap|nutrition|settings|log)(?:\/|[`'"])/;
  /*
   * CoachNotAuthorized.tsx is the one deliberate exception, not a leak: it
   * renders OUTSIDE the coach Shell for a signed-in-but-unauthorised account,
   * and its whole job is to hand that account back to the athlete app —
   * `navigate('/training')` there is the correct exit, not an accidental one.
   */
  const exempt = new Set(['apps/web/src/coach/access/CoachNotAuthorized.tsx']);
  for (const file of sourceFiles('apps/web/src/coach')) {
    const rel = relative(ROOT, file);
    if (exempt.has(rel)) continue;
    const navigationCode = code(file).replace(/\.includes\(\s*['"][^'"]+['"]\s*\)/g, '');
    if (athleteRoutes.test(navigationCode)) offenders.push(rel);
  }
  if (offenders.length) {
    fail('the standalone coach workspace stays on coach routes', `Route leak or missing guard: ${offenders.join(', ')}.`);
  } else pass('the standalone coach workspace stays on coach routes');
}

/* ---------------------------------------------------------------------------
 * 9. A roster client's screen never shows the SIGNED-IN account's own
 *    training data as if it were theirs.
 *
 * `useDb()` / `useNutrition()` / the progression ledger are the signed-in
 * account's own local stores — correct only while `engine-local` is
 * selected. Every route that reads them behind `/readiness`,
 * `/conditioning`, `/nutrition`, `/progression`, `/review/:weekStart` and
 * `/legacy` must be wrapped in `ClientDetailGate`, which blocks instead of
 * merely disclosing. (`/coach/author`, `/build/:id` and `/planner/:id` were on
 * this list until 14 August 2026, when the routes and the authoring ledger
 * behind them were deleted; `/strength` until 21 August 2026, when it MOVED
 * to reflectprotect123-max/strengthside with the repo split.)
 * (see ClientDetailGate.tsx's own header comment for why a disclosure
 * banner a coach can act past is not a guard).
 *
 * CoachCommandCenter is the one screen that is NOT fully behind that gate —
 * its client-overview tiles are meant to render for every client — so the
 * reads it makes directly from local stores are checked individually: each
 * risky read must sit close enough after the literal token `isLocalClient` in
 * the source that removing the gate is the only way to make this check pass
 * again.
 *
 * Stage-1 coach redesign (2026-08-11): the Command Center was rewritten from
 * a full dashboard into a four-tile launcher. The resolved-week list and the
 * `<AthleteStatus>` operating-context section it used to render moved out of
 * this file entirely — into the Readiness/Strength/Conditioning/Nutrition
 * pillar screens, which sit behind `ClientDetailGate` (`readiness`,
 * `strength` and `conditioning` joined `nutrition` in the `gatedPaths` list
 * below once Task 7 registered them), a stronger guarantee than this
 * heuristic. `<AthleteStatus` and `weeklyPlan.entries.map` are gone from this
 * file rather than renamed, so they are gone from the marker list too. What
 * remains here — and is still checked — are the two local-only reads the
 * tiles themselves make: the readiness band, and the nutrition exception
 * count (`nutritionReview` comes from the signed-in account's own
 * `useNutrition()`, exactly like `athleteState` does from `useDb()`).
 * ------------------------------------------------------------------------- */
{
  const routerFile = 'apps/web/src/coach/index.tsx';
  const router = code(resolve(ROOT, routerFile));
  /* `week/:athleteId/:weekStart` joined on 13 August 2026 with the week
     builder. It reads the athlete's published week from the repository rather
     than a local store, but it also reads `useDb()` for the exercise
     catalogue it offers while authoring, and it is the screen that PUBLISHES
     into an athlete's own record — so the gate that decides which athlete the
     bench is pointed at is exactly as load-bearing here as anywhere else. */
  /* `author`, `build/:id`, `planner/:id` and `review/:weekStart` were in this
     list until 14 August 2026 — the first three deleted with the old authoring
     chain, the last with the Coordinator. They are not exempted; the routes
     are gone, and rule 8 above fails if the authoring four are declared again.
     A path listed here that no longer exists would report an ungated route
     forever. */
  /* `legacy` left this list on 14 August 2026 with the route and CoachShell.
     A path named here and no longer declared would fail as "ungated", which is
     the wrong reason — the deleted-route guard above is what keeps it gone. */
  // 'strength' left this list on 21 August 2026 — the route MOVED to
  // reflectprotect123-max/strengthside with Task 2 of the repo split.
  const gatedPaths = ['readiness', 'conditioning', 'nutrition', 'progression', 'week/:athleteId/:weekStart'];
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

  const ccFile = 'apps/web/src/coach/screens/CoachCommandCenter.tsx';
  const cc = code(resolve(ROOT, ccFile));
  const GUARD = 'isLocalClient';
  const riskyMarkers = ['athleteState.readiness.band', 'nutritionReview.exceptions'];
  /*
   * A PROXIMITY check ("the guard token appears somewhere within N characters
   * before the risky read") is not a guard check — `const isLocalClient = …`
   * sits near everything below it by construction, so it stays in-window even
   * once the read is unconditional. Confirmed by adversarial test: changing
   * `isLocalClient ? athleteState.readiness.band : 'unknown'` to an
   * unconditional `athleteState.readiness.band` — a real leak — left the old
   * 500-character lookback version of this check GREEN.
   *
   * What actually proves the read is gated is STRUCTURE: the marker must sit
   * inside the TRUE branch of an `isLocalClient ? … : …` ternary, or inside
   * an `isLocalClient && …` expression, not merely somewhere after the guard
   * declaration. `[^:]*?` / `[^;]*?` bound the search to that branch —
   * crossing the ternary's `:` or a statement's `;` means the marker fell
   * into the FALSE branch or a later, unrelated statement, which is exactly
   * the unconditional-leak shape the adversarial test produced.
   */
  const guardedByTernary = (marker) => new RegExp(`${GUARD}\\s*\\?\\s*[^:]*?${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(cc);
  const guardedByAnd = (marker) => new RegExp(`${GUARD}\\s*&&\\s*[^;]*?${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(cc);
  const unguarded = riskyMarkers.filter((marker) => !guardedByTernary(marker) && !guardedByAnd(marker));
  if (unguarded.length) {
    fail(
      'CoachCommandCenter never renders local athlete state unguarded',
      `${ccFile} has ${unguarded.join(', ')} not inside an '${GUARD} ? … :' or '${GUARD} && …' guarded expression.`,
    );
  } else pass("CoachCommandCenter's local-only sections stay behind isLocalClient");
}

/* Reported LAST, so it names every missing directory in one go rather than the
   first one — and reported at all, which is the whole point. A scan list
   pointing at a deleted folder used to take the process down before it could
   say so. */
if (MISSING_FILES.length) {
  fail(
    'every named file exists',
    `${[...new Set(MISSING_FILES)].join(', ')} is named by a rule and is not on disk. ` +
      'A rule reading an empty string passes trivially — update the list in the same commit that deleted the file.',
  );
} else pass('every named file exists');

if (MISSING_DIRS.length) {
  fail(
    'every scanned directory exists',
    `${[...new Set(MISSING_DIRS)].join(', ')} is listed for scanning and is not on disk. ` +
      'Update SCAN_DIRS (or the rule that names it) in the same commit that deleted it — ' +
      'a scan of nothing passes every rule below it.',
  );
} else pass('every scanned directory exists');

console.log(
  failures ? `\n${failures} FAILURE(S)` : '\nAll coach contract checks passed.',
);
process.exit(failures ? 1 : 0);
