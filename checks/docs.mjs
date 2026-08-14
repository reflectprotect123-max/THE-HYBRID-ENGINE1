/*
 * Keep the README honest.
 *
 * The README's whole job is "symptom → file": someone who has never seen this
 * repo should be able to read a row and land on the code. That only works if
 * every path and symbol it names still exists — and a map that has quietly
 * rotted is worse than no map, because it sends the reader somewhere confident
 * and wrong.
 *
 * The previous readme claimed the Logger was "not a separate screen", called
 * the Planner the "Builder", and stated max HR as 220−age when the engine has
 * used Tanaka for months. All three would have cost a newcomer an hour. Nothing
 * caught it because nothing was checking.
 *
 * This parses the README for two things and verifies both:
 *   - `path/to/file.ext` — any backticked path with a slash and an extension
 *   - `file.ts` → `symbolName` — the arrow form used in the symptom table
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
const problems = [];

/* Paths: backticked, containing a slash, and either a file extension or a
   trailing slash for a directory. Prose like `p-2` or `barScale` is skipped by
   the slash requirement, and glob-ish paths (apps/*​/src) by the wildcard. */
const paths = new Set();
for (const m of md.matchAll(/`([A-Za-z0-9_./-]+\/[A-Za-z0-9_./-]+)`/g)) {
  const p = m[1];
  if (p.includes('*') || p.startsWith('http')) continue;
  paths.add(p.replace(/\/$/, ''));
}
/*
 * A path git IGNORES is a build output, not a source path, and asserting it
 * exists asserts the wrong thing: `apps/web/dist-coach` is created by
 * `react-smoke.mjs` when it runs and is absent on every clean checkout, so this
 * check failed in CI and passed on any machine that had run the browser suite
 * once. That is the worst failure mode a check can have — green because of
 * leftover state.
 *
 * A build output is still checked, just differently: something in the repo has
 * to actually PRODUCE it. Requiring only that its parent directory exists would
 * wave through `apps/web/dist-nonsense`, which matches the same ignore rule.
 * Requiring the literal path to appear in a check, script or config means a
 * renamed output directory still fails this check the day it is renamed.
 */
const ignored = (p) => {
  // BOTH forms. `.gitignore` writes directory rules with a trailing slash
  // (`apps/web/dist-*/`), and `check-ignore` cannot tell that a path which does
  // not exist yet is a directory — so the bare form reports "not ignored" for
  // exactly the build outputs this exists to recognise.
  for (const candidate of [p, `${p}/`]) {
    try {
      execFileSync('git', ['check-ignore', '-q', '--', candidate], { cwd: ROOT, stdio: 'ignore' });
      return true;
    } catch {
      /* not this form */
    }
  }
  return false;
};

/* Does anything in the tracked source actually write this path? `git grep` over
   tracked files only, so a stale copy in someone's working directory cannot
   vouch for it. */
const produced = (p) => {
  try {
    const out = execFileSync('git', ['grep', '-l', '--fixed-strings', '--', p], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').some((f) => f && f !== 'README.md');
  } catch {
    return false;
  }
};

let buildOutputs = 0;
for (const p of paths) {
  if (existsSync(resolve(ROOT, p))) continue;
  if (ignored(p)) {
    if (produced(p)) buildOutputs++;
    else problems.push(`build output nothing in this repo produces: ${p}`);
    continue;
  }
  problems.push(`path does not exist: ${p}`);
}

/* Symbols: "`file.ts` → `a`, `b`" — every name after the arrow must be exported
   from that file. This is the part that rots fastest, because renaming an
   engine function is a refactor nobody thinks of as a docs change. */
let symbolCount = 0;
/* Segmented, not greedy: a row may name TWO files ("...logger.ts → prefill,
   then lift.ts → nextWorkingWeight"), and a regex that runs to the end of the
   cell blames the second file's symbols on the first. Each arrow claims only
   the text up to the next `file.ts` → . */
const ARROW = /`([A-Za-z0-9_./-]+\.tsx?)`\s*→/g;
const hits = [...md.matchAll(ARROW)];
hits.forEach((h, i) => {
  const file = h[1];
  const start = h.index + h[0].length;
  const end = i + 1 < hits.length ? hits[i + 1].index : md.length;
  // Never run past the end of the row; a table cell is the natural boundary.
  const seg = md.slice(start, end).split('\n')[0];
  const full = resolve(ROOT, file);
  if (!existsSync(full)) return; // already reported above
  const src = readFileSync(full, 'utf8');
  for (const s of seg.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)) {
    symbolCount++;
    const name = s[1];
    if (!new RegExp(`export\\s+(async\\s+)?(function|const|class)\\s+${name}\\b`).test(src)) {
      problems.push(`${file} does not export ${name}`);
    }
  }
});

if (!paths.size || !symbolCount) {
  // A check that silently matches nothing is the failure mode this whole file
  // exists to prevent, so it refuses to pass empty.
  problems.push(`parsed nothing (${paths.size} paths, ${symbolCount} symbols) — the README format changed`);
}

/* ---------------------------------------------------------------------------
 * COUNTED CLAIMS IN CLAUDE.md.
 *
 * A number in prose is the most reliably wrong thing in this repository, and
 * the shot count has now gone stale TWICE the same way: a `/coach` route was
 * deleted, `checks/screens.mjs` dropped a shot, and the sentence saying how
 * many there are did not follow. "Thirty" survived the authoring chain's
 * deletion; "24" survived the Coordinator taking `review/:weekStart`. Both
 * times CLAUDE.md — the file every session reads first — confidently stated a
 * number the tree disagreed with.
 *
 * So the claim is now derived rather than remembered. This counts the entries
 * in `COACH_SHOTS` and asserts CLAUDE.md's sentence matches, doubling for the
 * two widths the check shoots at.
 *
 * Deliberately narrow: it verifies ONE claim, by parsing the one array that
 * decides it. A general "find every number in the docs" check would be either
 * unmaintainable or full of exceptions, and this file's own header is about
 * what a rotted map costs. If another counted claim starts drifting, add it
 * here the same way — anchored to the code that determines it.
 * ------------------------------------------------------------------------ */
const claudeMd = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf8');
const screensJs = readFileSync(resolve(ROOT, 'checks/screens.mjs'), 'utf8');

const shotsStart = screensJs.indexOf('const COACH_SHOTS = [');
if (shotsStart === -1) {
  problems.push('checks/screens.mjs no longer declares COACH_SHOTS — this check cannot see the routes any more');
} else {
  /* Bracket-match rather than regex to the closing `];`, so a nested array in
     a pattern list cannot end the block early. */
  let depth = 0;
  let end = -1;
  for (let i = shotsStart + 'const COACH_SHOTS = '.length; i < screensJs.length; i += 1) {
    if (screensJs[i] === '[') depth += 1;
    else if (screensJs[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  const block = end === -1 ? '' : screensJs.slice(shotsStart, end);
  const routes = (block.match(/^\s*\[\s*'/gm) || []).length;
  const stated = claudeMd.match(/\*\*(?:Eleven|\w+) routes, (\d+) shots, all green\.\*\*/);

  if (!routes) {
    problems.push('parsed zero routes out of COACH_SHOTS — the declaration format changed');
  } else if (!stated) {
    problems.push('CLAUDE.md no longer states the shot count in the form "N routes, M shots, all green" — this check cannot verify it');
  } else if (Number(stated[1]) !== routes * 2) {
    problems.push(
      `CLAUDE.md says ${stated[1]} shots; COACH_SHOTS has ${routes} routes × 2 widths = ${routes * 2}. ` +
        'A route was added or deleted and the sentence did not follow — this is the third time.',
    );
  }
}

if (problems.length) {
  console.error('README is out of date:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(
  `README OK — ${paths.size} paths and ${symbolCount} symbols all resolve` +
    (buildOutputs ? ` (${buildOutputs} of those are gitignored build outputs, verified by finding what produces them).` : '.'),
);
