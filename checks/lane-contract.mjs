/*
 * The athlete and the coach must work together and never back to back.
 *
 * They are one deploy and one bundle, and they are SUPPOSED to share: both sit
 * on `packages/*`, on the store, on the cloud layer, on the design system. What
 * neither may do is depend on the OTHER. Facing the same shared floor is
 * collaboration; facing each other is a knot that cannot be split later without
 * unpicking both surfaces at once.
 *
 * WHY THIS IS A GRAPH CHECK AND NOT ANOTHER STATIC SCAN
 *
 * `coach-contract.mjs` is text assertions over source, and says so — a
 * deliberate ceiling. That ceiling has been hit: five guards in this repo have
 * already been demonstrated decorative, including a 500-char proximity scan
 * that kept passing after a reviewer deleted the real gate it was watching. A
 * text scan asserts that a string sits near another string, which can be true
 * while the property it stands for is false.
 *
 * This computes the property itself. It resolves every relative import in
 * `apps/web/src` into an edge, assigns each file a lane, and asserts no edge
 * crosses between the two front doors. There is no gap between what it measures
 * and what it protects, so it cannot pass while the thing it guards is broken.
 *
 * WHY IT IS A RATCHET AND NOT A WALL
 *
 * There are real crossings today, listed in ALLOWED below with the reason each
 * one exists. A check demanding zero would fail on the first run and be
 * commented out by the end of the week. So: a crossing not on the list fails,
 * AND a list entry that no longer occurs fails. The second half is what makes
 * it a ratchet — once a crossing is fixed, the entry must be deleted, and the
 * list can only ever shrink. When it empties, the rule becomes absolute for
 * free and this comment is the only thing left to remove.
 *
 * Run: node checks/lane-contract.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'apps/web/src');
let failures = 0;

const fail = (name, detail) => {
  failures++;
  console.error(`FAIL — ${name}\n       ${detail}`);
};
const pass = (name) => console.log(`  PASS — ${name}`);

/*
 * The two front doors. Everything not named here is shared ground, and shared
 * ground is exactly what both are allowed to stand on — `cloud/`, `store/`,
 * `ui/`, `native/`, `lib/` and the files at the root of `src/` are all neutral
 * on purpose, and a coach or athlete edge into any of them is not a finding.
 */
const LANES = [
  ['coach', ['coach/']],
  ['athlete', ['screens/', 'components/', 'autocoach/']],
];

/*
 * Every athlete↔coach crossing that exists today, with why it is here and what
 * retires it. Adding a line is a decision someone has to write down; deleting
 * one is the only direction this list is allowed to move.
 *
 * `count` is asserted exactly. A crossing that GROWS fails just as loudly as a
 * new one — otherwise "already on the list" becomes a licence to add more.
 *
 * EMPTY as of 13 August 2026. The last two entries were `Planner` and
 * `GuidedBuilder` — the coach bench importing the athlete's plan editor and
 * guided builder under `apps/web/src/screens/`. Both retired the same way
 * this comment always said they would, but not by the package extraction it
 * predicted: the owner parked session authoring and logging on athlete web
 * entirely, so there was no longer an athlete screen to extract FROM. The
 * builder moved — `git mv`, history intact — into
 * `apps/web/src/coach/authoring/` and became the bench's own code; the
 * athlete logger was deleted outright. With no athlete-lane file left for
 * the coach to reach into, both crossings disappeared on their own. The
 * rule is now absolute: the athlete and the coach import nothing of each
 * other's, full stop.
 */
const ALLOWED = [];

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
};

/* Comments in this repo explain the rules as often as they break them, and
   several of them quote import paths verbatim. Strip comments before matching
   or the documentation reports itself as a violation. */
const code = (f) =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const laneOf = (file) => {
  const rel = relative(SRC, file).split('\\').join('/');
  for (const [lane, prefixes] of LANES) if (prefixes.some((p) => rel.startsWith(p))) return lane;
  return 'shared';
};

/* Resolve a relative specifier the way the bundler does, so `../coach/contracts`
   and `../coach/contracts.ts` and `../coach` (an index) all land on one file. */
const resolveImport = (fromFile, spec) => {
  const base = resolve(dirname(fromFile), spec);
  for (const c of [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
};

/* Static `import`/`export ... from`, and lazy `import(...)` — the coach is
   mounted through a dynamic import, so a check that only read static ones would
   be blind to the single most important edge on the screen. */
const SPECIFIERS = /(?:^|[\s;}])(?:import|export)\s[\s\S]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const crossings = [];
for (const file of walk(SRC)) {
  const from = laneOf(file);
  if (from === 'shared') continue;
  const src = code(file);
  for (const m of src.matchAll(SPECIFIERS)) {
    const spec = m[1] || m[2];
    if (!spec || !spec.startsWith('.')) continue;
    const target = resolveImport(file, spec);
    if (!target) continue;
    const to = laneOf(target);
    if (to === 'shared' || to === from) continue;
    crossings.push({
      from, to,
      file: relative(ROOT, file).split('\\').join('/'),
      target: relative(ROOT, target).split('\\').join('/'),
      typeOnly: /import\s+type\s/.test(m[0]),
    });
  }
}

console.log('Athlete / coach lane contract\n');

/* 1. Nothing crosses that is not on the list. */
{
  const key = (c) => `${c.from}->${c.to}:${c.target}`;
  const budget = new Map(ALLOWED.map((a) => [`${a.from}->${a.to}:${a.target}`, a.count]));
  const seen = new Map();
  for (const c of crossings) seen.set(key(c), (seen.get(key(c)) || 0) + 1);
  const over = [];
  for (const [k, n] of seen) {
    const allowed = budget.get(k) || 0;
    if (n > allowed) {
      const examples = crossings
        .filter((c) => key(c) === k)
        .map((c) => `${c.file}${c.typeOnly ? '  (type-only)' : ''}`);
      over.push(`${k}\n         ${n} crossing(s), ${allowed} allowed:\n         ` + examples.join('\n         '));
    }
  }
  if (over.length) {
    fail(
      'the athlete and the coach do not import each other',
      over.join('\n       ') +
        '\n       Both may depend on shared ground — cloud/, store/, ui/, packages/* —' +
        '\n       and neither may depend on the other. Route it through shared ground,' +
        '\n       or add a line to ALLOWED in this file saying why it cannot be.',
    );
  } else pass('the athlete and the coach do not import each other');
}

/* 2. The list only shrinks. An entry that no longer happens must be deleted —
      otherwise the budget survives the fix and silently funds the next one. */
{
  const seen = new Map();
  for (const c of crossings) {
    const k = `${c.from}->${c.to}:${c.target}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const stale = ALLOWED
    .filter((a) => (seen.get(`${a.from}->${a.to}:${a.target}`) || 0) < a.count)
    .map((a) => `${a.target}: allows ${a.count}, only ${seen.get(`${a.from}->${a.to}:${a.target}`) || 0} left`);
  if (stale.length) {
    fail(
      'the allowlist has not been trimmed to match reality',
      stale.join('\n       ') +
        '\n       This is the good failure: a crossing was removed. Lower the count in' +
        '\n       ALLOWED, or delete the entry entirely if it is now zero.',
    );
  } else pass('the allowlist has not been trimmed to match reality');
}

/* 3. The check can actually see the graph. A resolver that silently stops
      resolving turns this whole file into a guard that passes because it found
      nothing — the exact failure mode it was written to avoid. */
{
  let edges = 0;
  for (const file of walk(SRC)) {
    for (const m of code(file).matchAll(SPECIFIERS)) {
      const spec = m[1] || m[2];
      if (spec && spec.startsWith('.') && resolveImport(file, spec)) edges++;
    }
  }
  if (edges < 400) {
    fail(
      'the import graph resolved',
      `only ${edges} relative imports resolved across apps/web/src — expected 400+.\n` +
        '       The resolver is broken, so silence from the checks above means nothing.',
    );
  } else pass(`the import graph resolved (${edges} relative imports)`);
}

console.log(
  failures
    ? `\n${failures} FAILURE(S) — the lanes have crossed.`
    : '\nAll lane contract checks passed.',
);
process.exit(failures ? 1 : 0);
