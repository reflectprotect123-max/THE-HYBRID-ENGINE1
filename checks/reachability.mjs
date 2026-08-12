/*
 * Every source file is reachable from its app's entry point.
 *
 * Dead code that carries a passing test is the dangerous kind: the suite goes
 * green, a task gets marked done, and nothing calls it. This check was written
 * because `native/geoTracker.ts` was exactly that — "Foreground GPS tracking",
 * built, tested, called by nobody, and invisible until something walked the
 * import graph. It is wired into Conditioning now, and its entry is gone from
 * the list below, which is what the ratchet is for.
 *
 * So this walks it. Entry point in, resolve every relative import (including
 * bare side-effect imports like `import './product'` — missing those made an
 * earlier version of this check invent a dead file that was really a
 * deliberate build guard), and anything the walk never reaches is a finding.
 *
 * ALLOWED is a ratchet, the same shape as checks/lane-contract.mjs: an entry
 * that no longer occurs FAILS, so a file that gets wired up or deleted must be
 * removed from the list. The list can only shrink. When it empties, this
 * becomes an absolute rule for free.
 *
 * Run: node checks/reachability.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = ['.ts', '.tsx', '.js', '.jsx'];

const APPS = [
  { name: 'apps/web', entry: 'apps/web/src/main.tsx' },
  { name: 'apps/mobile', entry: 'apps/mobile/index.js' },
];

const ALLOWED = [
  {
    file: 'apps/web/src/coach/coach-test-harness.tsx',
    why: 'Test infrastructure. Unreachable from main.tsx is CORRECT — it exists '
       + 'for the coach suites and must never ship in the entry graph. Retires '
       + 'only if the harness moves under a test/ directory the walk skips.',
  },
];

let failures = 0;
const fail = (n, d) => { failures++; console.error(`FAIL — ${n}\n       ${d}`); };
const pass = (n) => console.log(`  PASS — ${n}`);

const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (EXT.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
};

const resolveImport = (from, spec) => {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  for (const e of EXT) if (existsSync(join(base, 'index' + e))) return join(base, 'index' + e);
  return null;
};

const importsOf = (f) => {
  const specs = [];
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  let m;
  const src = readFileSync(f, 'utf8');
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs.map((s) => resolveImport(f, s)).filter(Boolean);
};

const isTest = (f) => /\.(test|spec)\.[jt]sx?$/.test(f);
const unreachableAll = [];

for (const app of APPS) {
  const srcDir = resolve(ROOT, app.name, 'src');
  if (!existsSync(srcDir)) continue;

  const seen = new Set();
  const queue = [resolve(ROOT, app.entry)];
  while (queue.length) {
    const f = queue.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    for (const next of importsOf(f)) queue.push(next);
  }

  const unreachable = walk(srcDir)
    .filter((f) => !isTest(f) && !seen.has(f))
    .map((f) => relative(ROOT, f).split('\\').join('/'));

  unreachableAll.push(...unreachable);
  const surprises = unreachable.filter((f) => !ALLOWED.some((a) => a.file === f));
  if (surprises.length) {
    fail(`${app.name} — every source file is reachable from ${app.entry}`,
      `unreachable and not on the allowlist:\n       ${surprises.join('\n       ')}`);
  } else {
    pass(`${app.name} — ${seen.size} files reachable, ${unreachable.length} allowlisted`);
  }
}

/* The ratchet half: a list entry that no longer happens must be deleted, or
   the list keeps budget for a problem somebody already fixed. */
const stale = ALLOWED.filter((a) => !unreachableAll.includes(a.file));
if (stale.length) {
  fail('the allowlist has not been trimmed to match reality',
    `these are reachable now (or gone) — delete their ALLOWED entries:\n       ${stale.map((s) => s.file).join('\n       ')}`);
} else {
  pass('the allowlist has not been trimmed to match reality');
}

console.log(failures ? `\n${failures} reachability check(s) failed.` : '\nAll reachability checks passed.');
process.exit(failures ? 1 : 0);
