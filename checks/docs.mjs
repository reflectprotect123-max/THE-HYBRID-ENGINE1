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
for (const p of paths) {
  if (!existsSync(resolve(ROOT, p))) problems.push(`path does not exist: ${p}`);
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

if (problems.length) {
  console.error('README is out of date:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`README OK — ${paths.size} paths and ${symbolCount} symbols all resolve.`);
