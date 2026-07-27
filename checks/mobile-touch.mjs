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
import { join, resolve } from 'node:path';

const root = resolve(process.cwd(), process.argv.slice(2).find((a) => !a.startsWith('-')) || '.');
const screens = join(root, 'apps/mobile/src/screens');

let files;
try {
  files = readdirSync(screens).filter((n) => n.endsWith('.tsx'));
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

const offenders = [];
for (const f of files) {
  readFileSync(join(screens, f), 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/<Pressable[\s>]/.test(line)) offenders.push(`${f}:${i + 1}`);
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

console.log(`OK — ${files.length} screens, every tappable goes through <Tap>.`);
