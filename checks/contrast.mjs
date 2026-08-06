/*
 * WCAG contrast for the palette, computed from the tokens themselves.
 *
 * Dark themes fail contrast quietly: a dim grey on a near-black panel looks
 * intentional on the designer's monitor and is unreadable on a phone in a gym
 * with the brightness down. Nothing in the build can see that, so it is
 * measured here.
 *
 * Reads packages/design/src/tokens.ts rather than a copy, so the table can
 * never describe a palette the app no longer uses.
 *
 *   node checks/contrast.mjs          # print the table
 *   node checks/contrast.mjs --strict # exit 1 if any ink fails 3:1 anywhere
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/* slice(2): argv[0] is the node binary and argv[1] this script — both are paths,
   so "the first argument that looks like a path" matched the interpreter. */
const root = resolve(process.cwd(), process.argv.slice(2).find((a) => !a.startsWith('-')) || '.');
const src = await readFile(resolve(root, 'packages/design/src/tokens.ts'), 'utf8');

/** Pull `name: '#rrggbb'` pairs out of the token source. */
const hexes = Object.fromEntries(
  [...src.matchAll(/(\w[\w\d]*)\s*:\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1], m[2].toLowerCase()]),
);

const SURFACES = ['bg', 'panel', 'panel2', 'well'];
const INKS = ['text', 'muted', 'dim', 'gold', 'gold2', 'ok', 'warn', 'bad'];

const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const missing = [...SURFACES, ...INKS].filter((n) => !hexes[n]);
if (missing.length) {
  console.error('token not found in tokens.ts: ' + missing.join(', '));
  console.error('The parse is what broke, not the palette — fix this file, not the theme.');
  process.exit(1);
}

let worst = Infinity;
const fails = [];
console.log('contrast — ink on surface (4.5:1 body · 3:1 secondary & large)\n');
console.log('ink'.padEnd(8) + SURFACES.map((s) => s.padStart(9)).join(''));
for (const ink of INKS) {
  let row = ink.padEnd(8);
  for (const surf of SURFACES) {
    const r = ratio(hexes[ink], hexes[surf]);
    worst = Math.min(worst, r);
    if (r < 3) fails.push(`${ink} on ${surf} = ${r.toFixed(1)}`);
    row += (r.toFixed(1) + (r >= 4.5 ? '  ' : r >= 3 ? ' *' : ' !')).padStart(9);
  }
  console.log(row);
}
console.log('\n  (blank) passes 4.5:1   * secondary/large only   ! under 3:1');
console.log(`  lowest pair: ${worst.toFixed(1)}:1`);

/* `dim` on `panel2` sits at 4.2 by design — it is a secondary ink and 3:1 is
   its bar. See docs/DESIGN-TOKENS.md. So --strict fails at 3, not 4.5, and the
   4.5 column is advisory. */
if (process.argv.includes('--strict') && fails.length) {
  console.error('\nFAIL — under 3:1:\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log(fails.length ? '' : '\nOK — every ink clears 3:1 on every surface.');
