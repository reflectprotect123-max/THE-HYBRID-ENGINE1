# Actual UX audit

Written 8 August 2026 against `main` @ `a8ff104`.

**Scope honesty.** This is a code-and-screenshot audit: I generated all 11
athlete screens with `checks/screens.mjs` against a seeded eight-week database
and read the component source. I did **not** run a screen reader, a keyboard
traversal or a 200% reflow pass. Findings in those areas are marked
**[unverified]** and are gaps in this audit, not clean bills of health.

Severity: **4** blocks/serious risk · **3** major · **2** meaningful · **1**
cosmetic.

## What must not change — the product's identity

- **Charcoal and bronze**, three world palettes (strength gold, conditioning
  teal, nutrition violet), defined once in `@hybrid/design` and contrast-checked
  in every palette by `checks/contrast.mjs`.
- **Tabular numerals** everywhere a number is compared. Training data is read in
  columns; proportional digits would break that.
- **Editorial calm**: no streaks, no confetti, no compliance score, no shame.
  This is the clearest product decision in the codebase and the easiest to
  erode.
- **Honest disclosure in the nutrition surfaces** — the coverage ring that names
  the direction of harm, and the check-in that prints the macro/calorie
  contradiction with its cause. These are unusual and should be the template,
  not the exception.

## Findings

### 4 — blocks completion or creates serious risk

**U1 · The Logger pre-fills an increased weight without saying it is a
proposal.** (`Logger.tsx:296-297`) The copy reads as advice; the field changes.
An athlete who does not notice lifts a heavier prescribed weight. *Fix*: render
the pre-filled value in a proposal treatment with an explicit accept, or do not
write it.

**U2 · `/coach` fails offline in an app installed as a PWA.**
(`vite.config.ts:79`) The route loads online and 404s from the home screen.
*Fix*: remove the denylist entry and decide what offline means for the bench.

### 3 — major

**U3 · Readiness is presented as one authoritative number.** A band blending a
vendor score with self-report reads as measurement. *Fix*: show provenance —
the `source` tag is already carried per signal and simply is not displayed.

**U4 · Band names imply physiological authority.** "good / watch / low",
"readiness". *Fix*: relabel toward what is actually known, in the same register
the nutrition screens already use.

**U5 · Accessibility beyond contrast and touch targets is unverified.**
[unverified] `contrast.mjs` and `web-touch.mjs`/`mobile-touch.mjs` cover colour
and hit area. Nothing covers focus order, keyboard operability of the Logger,
screen-reader labelling of the set grid, or 200% reflow. For an app used
one-handed mid-set, keyboard/AT operability is not decorative.

**U6 · The coach bench has no render tests** and ~2,700 lines of UI. Any
redesign proceeds without a regression net.

### 2 — meaningful

**U7 · Empty catalogue makes food search look broken.** Every barcode scan
misses and routes to "create the food". Correct by design; indistinguishable
from failure. *Fix*: say the catalogue is empty rather than implying no match.

**U8 · Create-a-food cannot express a unit outside g/ml/serving**, while its own
comment says anything else "is typed". There is no text input.

**U9 · Reduced motion** [unverified] — `useReduceMotion` exists in
`apps/mobile/src/App.tsx` and is used correctly there; I did not audit the web
side for equivalent handling.

**U10 · Loading and error states are inconsistent across screens.** The
nutrition world has explicit `saveFailed` / `dataRecovered` banners; several
training screens have no equivalent.

### 1 — cosmetic

**U11 · Icon set is text glyphs** (`⌂ ⊟ ▤ ◱ ⚙`) in the mobile tab bar. Legible
and on-brand, but they carry no accessible name of their own [unverified].

## What the interface suggests versus what the code proves

| Interface suggests | Code proves | Gap |
|---|---|---|
| The next-set weight is a suggestion | It is written into the field | **U1** |
| Readiness is a measurement | A weighted blend of self-report and a vendor score | **U3/U4** |
| `/coach` is part of the installed app | It is excluded from the offline fallback | **U2** |
| "Anything else is typed" (units) | Three chips, no input | **U8** |
| Barcode scanning finds foods | The catalogue is empty by design | **U7** |
| Macros are stored as typed and never recalculated | **True** — verified | none |
| Pain outranks other signals | **True** — distinct drop codes | none |
