/*
 * ORPHANED STATE CLASSES — a CSS toggle nothing can ever turn on.
 *
 * This check exists because of a bug a coach hit on a real phone on 14 August
 * 2026, which every screenshot review, every unit test and every one of the
 * nine other checks passed straight over.
 *
 * `coach-redesign.css`'s phone block says:
 *
 *     .cb-picker { display: none; }
 *     .cb-picker.picker-open { display: block; }
 *
 * The mockup this was ported from toggled `picker-open` with its own script.
 * The React component that replaced that script renders `<div
 * className="cb-picker">` and never applies it. So `.cb-picker` was
 * `display: none` with no path to anything else: tapping "+ Add exercise from
 * library" hid the reveal button and mounted a picker the stylesheet
 * suppressed. The block went empty, with nothing left to tap. A coach could
 * add a block to a session and then never put an exercise in it.
 *
 * WHY NOTHING CAUGHT IT.
 *
 *   - Unit tests run in jsdom, which does not apply the stylesheet. Every
 *     assertion about the picker passed, because the picker really was in
 *     the DOM. It was invisible, and jsdom has no opinion about that.
 *   - `checks/screens.mjs` shoots the routes at 420px and fails on horizontal
 *     OVERFLOW. A control that is `display: none` takes no width. An empty
 *     screen is the most overflow-free screen there is.
 *   - Desktop review could not see it. The rules live inside the phone media
 *     query, so above the breakpoint the picker showed normally.
 *
 * WHAT THIS ASSERTS.
 *
 * For every pair in the stylesheet of the shape
 *
 *     .base            { display: none }        <- hidden by default
 *     .base.modifier   { display: <anything> }  <- the only way back
 *
 * if `.base` is applied somewhere in the app's source, then `.modifier` must
 * be too. A base class nobody renders is ignored: that is dead CSS from the
 * mockup, which is untidy but cannot strand anyone. The bug is specifically a
 * LIVE element whose only escape from `display: none` is a class no code
 * writes.
 *
 * It is a text scan, and it says so. It cannot know whether the modifier is
 * applied to the RIGHT element, only that something could apply it. That is
 * enough to catch this failure and cheap enough to run everywhere; a real
 * answer would need the phone stylesheet and a browser, which is
 * `checks/screens.mjs`'s job and a much slower one.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';

const root = resolve(process.cwd(), process.argv[2] || '.');

/* The stylesheets to scan, each with the source tree whose components are
   allowed to satisfy them. Add a row when a new hand-written stylesheet with
   state toggles arrives; a stylesheet not listed here is not checked. */
const SHEETS = [
  { css: 'apps/web/src/coach/coach-redesign.css', src: 'apps/web/src' },
];

/*
 * Modifiers that are deliberately never applied by application code, with the
 * reason. This is a ratchet in the same shape as the reachability and pentest
 * allowlists: an entry that STOPS being orphaned fails, so a fixed one has to
 * be deleted from the list rather than leaving budget behind.
 */
const ACCEPTED = [
  // (empty — every orphan found on 14 August 2026 was the real bug above)
];

async function walk(dir, out = []) {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
      await walk(full, out);
    } else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(item.name))) {
      out.push(full);
    }
  }
  return out;
}

let failures = 0;
let pairs = 0;
const check = (ok, message) => {
  if (ok) console.log('  PASS — ' + message);
  else {
    console.log('  FAIL — ' + message);
    failures += 1;
  }
};

for (const sheet of SHEETS) {
  const css = await readFile(resolve(root, sheet.css), 'utf8');

  /* Which classes are hidden outright. `display:none` only — a class that
     merely restyles has no trap door to be missing. */
  const hidden = new Set();
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)\s*\{[^}]*?display\s*:\s*none/g)) {
    hidden.add(m[1]);
  }

  /* Which compound selectors bring one back. `.base.modifier { display: X }`
     where X is not none. */
  const rescues = new Map(); // base -> Set(modifier)
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}/g)) {
    const [, base, modifier, body] = m;
    if (!/display\s*:\s*(?!none)[a-z-]+/.test(body)) continue;
    if (!rescues.has(base)) rescues.set(base, new Set());
    rescues.get(base).add(modifier);
  }

  /*
   * Everything the SHIPPED source could actually write as a class name.
   *
   * Three exclusions, and the first version of this check had none of them —
   * it scanned raw text for identifier-shaped tokens, and passed while the
   * real bug was still present. What satisfied it was the explanatory comment
   * naming `.cb-picker.picker-open` and the test asserting the class by name.
   * A guard that its own documentation can satisfy proves nothing, which is
   * the exact failure mode this file exists to catch in the stylesheet.
   *
   *   1. Test files are dropped. A class named only in an assertion is not
   *      applied to anything a coach can see.
   *   2. Comments are stripped, so prose about a class never counts as using
   *      it — including the prose in this very check's own commit.
   *   3. Only STRING contents are scanned. A class reaches the DOM as a
   *      string: `"picker-open"`, `'a picker-open'`, or a template literal.
   *      An identifier in ordinary code is a variable, not a class.
   *
   * Still deliberately loose within a string: a space-separated list, an
   * interpolated template, or a lookup table of class names all count, so a
   * component that builds its class list dynamically is not a false alarm.
   * The thing being caught is a class that appears in NO string anywhere,
   * which is unambiguous.
   */
  const files = (await walk(resolve(root, sheet.src))).filter((f) => !/\.test\.[jt]sx?$/.test(f));
  const tokens = new Set();
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const text = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments, sparing http://
    for (const m of text.matchAll(/"([^"\\]*)"|'([^'\\]*)'|`([^`\\]*)`/g)) {
      const body = m[1] ?? m[2] ?? m[3] ?? '';
      for (const t of body.matchAll(/[a-zA-Z][\w-]*/g)) tokens.add(t[0]);
    }
  }

  console.log(`\n${sheet.css} — state classes that must be reachable:\n`);

  for (const [base, modifiers] of [...rescues].sort()) {
    if (!hidden.has(base)) continue;      // not hidden by default, nothing to escape
    if (!tokens.has(base)) continue;      // dead CSS: nothing renders it, nobody is stranded
    for (const modifier of [...modifiers].sort()) {
      pairs += 1;
      const accepted = ACCEPTED.find((a) => a.base === base && a.modifier === modifier);
      const applied = tokens.has(modifier);
      if (accepted) {
        /* The staleness half of the ratchet: an accepted entry that is no
           longer orphaned must be deleted, or the list quietly grows a
           permission nobody needs. */
        check(
          !applied,
          `ACCEPTED entry .${base}.${modifier} is stale — the modifier IS applied now, delete the entry`,
        );
        continue;
      }
      check(
        applied,
        `.${base} is display:none and only .${base}.${modifier} escapes it — ` +
          (applied ? 'the modifier is applied in source' : 'NOTHING in source ever applies that modifier'),
      );
    }
  }
}

console.log(`\n${pairs} live state pair(s) checked.`);
if (failures) {
  console.log(`\n${failures} FAILURE(S) — an element is rendered, hidden by CSS, and has no way back.`);
  process.exit(1);
}
console.log('All CSS state classes are reachable.');
