/*
 * Nothing bypasses the phone app's touch contract.
 *
 * An audit found thirteen controls under the 44pt minimum — one at 24px — and
 * of thirty Pressables, not one gave press feedback. None of those were sloppy
 * lines of code; each looked perfectly reasonable on its own. What let them
 * accumulate is that a raw `<Pressable>` is the obvious thing to reach for, and
 * nothing anywhere could see the result: it is invisible to tsc, to Metro, and
 * to a screenshot.
 *
 * `ui.tsx`'s `Tap` now owns the rules — 48dp effective target via computed
 * hitSlop, ripple/opacity feedback, and an accessibility role. This asserts the
 * screens actually go through it.
 *
 * Lives here rather than in the jest suite because it reads source files, and
 * putting Node types into a React Native tsconfig would make `process.env`
 * typecheck in app code that then crashes on a device.
 *
 *   node checks/mobile-touch.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd(), process.argv.slice(2).find((a) => !a.startsWith('-')) || '.');
const screens = join(root, 'apps/mobile/src/screens');

/*
 * Every screen, at any depth.
 *
 * This was a flat `readdirSync`, which silently stopped at the top level — so
 * the guided builder's eight screens under `screens/guided/` were never scanned
 * at all, and the sweep reported green over a directory it had not read. A check
 * that quietly covers less than it claims is worse than one that fails.
 */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.tsx') ? [p] : [];
  });
}

let files;
try {
  files = walk(screens);
} catch {
  console.error(`cannot read ${screens} — run this from the repo root, or pass the root as an argument.`);
  process.exit(1);
}
if (!files.length) {
  // An empty sweep passing is worse than a failing one: it reports green while
  // testing nothing.
  console.error('no screens found — the path is wrong, not the code.');
  process.exit(1);
}

/*
 * The same failure the recursive `walk` above was written to fix, one world
 * later. `screens/guided/` was silently unscanned for as long as the sweep was
 * flat; `screens/nutrition/` is now the largest subdirectory in the app, and a
 * sweep that stopped covering it would report the identical green.
 *
 * A directory-shaped floor rather than a count: the number of nutrition screens
 * will keep moving, but "the nutrition world is in this sweep at all" must not.
 */
const worlds = ['nutrition', 'guided'];
const missing = worlds.filter((w) => !files.some((f) => relative(screens, f).startsWith(w + '/')));
if (missing.length) {
  console.error(`FAIL — the sweep reached no screens under ${missing.map((w) => w + '/').join(', ')}.`);
  console.error('Either those screens moved, or this walk stopped descending. Either way it is testing less than it says.');
  process.exit(1);
}

const offenders = [];
for (const f of files) {
  readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/<Pressable[\s>]/.test(line)) offenders.push(`${relative(screens, f)}:${i + 1}`);
    });
}

if (offenders.length) {
  console.error(`FAIL — ${offenders.length} raw <Pressable> in apps/mobile/src/screens:\n`);
  offenders.forEach((o) => console.error('  ' + o));
  console.error(`
Use <Tap> from ../ui instead. It computes hitSlop to reach 48dp from the box you
render — so the touch area grows and the layout does not move — and adds the
press feedback and accessibility role every tappable thing in this app needs.`);
  process.exit(1);
}

const perWorld = worlds.map((w) => `${files.filter((f) => relative(screens, f).startsWith(w + '/')).length} ${w}`).join(', ');
console.log(`OK — ${files.length} screens (${perWorld}), every tappable goes through <Tap>.`);
