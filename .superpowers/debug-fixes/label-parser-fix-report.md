# Nutrition-label parser — five review fixes

`packages/nutrition-core/src/label.ts`, with regression tests in
`packages/nutrition-core/src/label.test.ts` and
`apps/mobile/src/native/nutrition-label-ocr.test.tsx`.

Every bug below was reproduced against the unmodified file before anything was
changed, and every new test was confirmed to fail on the pre-fix code (9 of the
new nutrition-core cases fail when `label.ts` alone is reverted; the rest are
positive controls that must pass both ways).

## What the fixes have in common

Four of the five defects were one shape of mistake: the reader decided what a
row's value was without checking where that value came from. So the fixes are
not five patches — they are two helpers plus a numeric policy, used everywhere.

- `splitLabelCell` — one place that answers "does this cell carry its own
  value?", built on the `LABEL_VALUE_SPLIT` regex the typed path already used.
  It now lives with the reader rather than with the typed entry point, because
  both doors need it. Bugs 1 and 2 are both consequences of that question never
  being asked.
- `valueColumnCount` — one place that answers "how many value columns does this
  panel's own headings say it prints?", so a row can be checked against it.
  Bug 3.
- `DECIMAL` + a validating `toNumber` — one numeric shape, refused rather than
  truncated when it does not fit. Bug 4, and it also removes the same latent
  defect from the serving-size and energy matchers, which had their own copies
  of the bounded-fraction regex.

## Bug 1 — a merged label+value line read the per-100 column as per-serving

**Before.** Lines `Per serving` / `Per 100 g` / `Protein 3.2 g` / `10.7 g` /
`Fat, total 2.1 g` / `7.0 g` returned `proteinG: 10.7`, `fatG: 7.0`,
`basis: 'per_serving'`. The label cell matched on `startsWith('protein')`,
nothing noticed the cell also held `3.2`, and `row[1]` — the NEXT column, not
this row's value — was taken. A 3.3x overstatement reported with full
confidence, which is precisely the failure the file's header names.

ML Kit's `Line` is "words on one baseline", and on a tightly-set FSANZ panel the
label and its per-serving figure are one baseline. This is ordinary output, not
a degenerate case.

**After.** `readRows` asks `splitLabelCell(row[0])` first. When the label cell
carries its own number, that number is the value and the row is fully resolved —
`row[1]` is ignored entirely for that row, because it is a different column.
Returns `proteinG: 3.2`, `fatG: 2.1`.

## Bug 2 — the camera path could not split a merged line at all

**Before.** `parseLabelLines` skipped any row without two cells, so lines
`Energy 520 kJ` / `Protein 3.2 g` / `Fat, total 2.1 g` / `Carbohydrate 15.6 g`
returned all-null and surfaced as "no macro rows found / panel may have been cut
off" — while the identical text typed by hand parsed correctly. Fails safe, but
it is a real gap between two doors the file claims are one reader.

**After.** Same `splitLabelCell` call covers it; no separate fallback exists.
The duplication was removed from the other side too: `parseLabelText` no longer
runs `LABEL_VALUE_SPLIT` itself, it hands single-cell lines to the reader and
the reader splits them. There is now exactly one implementation of the split.

## Bug 3 — a lone surviving value was promoted into the wrong column

**Before.** Lines `Per serving` / `Per 100 g` / `Protein` / `10.7 g` returned
`proteinG: 10.7, basis: 'per_serving'`. The reader took the leftmost numeric
cell with no check on which column it sat in, so a single faint or clipped cell
(a `<1 g` that did not OCR, a slightly cropped left column) silently turned a
per-100 figure into a serving's worth.

**After.** `valueColumnCount` counts the value columns the panel's own headings
declare (`per serv` and/or `per 100 g|ml`, floor of 1). A row's `row[1]` is only
accepted when the row carries at least that many value cells. It cannot, then,
be a lone per-100 survivor. A row that fails the check is left null, per the
file's standing rule. Now returns `proteinG: null`, `basis: 'per_serving'` —
the basis is still reported honestly, only the unattributable number is dropped.

Note this interacts with Bug 1 deliberately: a row like `["Protein 3.2 g",
"10.7 g"]` has only one value cell against two headings, but the label cell's
embedded value is self-evidently the first column, so it is accepted. That is
what keeps a real two-column panel readable when OCR merges its left column.

### Limitation, and why it was not taken further

This is a **cardinality** check, not true column tracking. It proves a row could
not have lost its per-serving cell; it does not prove that the cell it accepted
is geometrically under the "Per serving" heading. A row that is missing its
per-100 cell but has an extra spurious numeric cell elsewhere would still pass.

A fully robust fix wants the x-position of each heading compared against the
x-position of each value cell — but `readRows` is deliberately positionless
(it takes `string[][]`, which is what lets the typed path share it), so real
column tracking means threading bounding boxes from `apps/mobile/src/native/
labelOcr.ts` through `parseLabelLines` into the reader, and inventing something
for the typed path that has no coordinates at all. That is a cross-package
rework, well beyond a contained fix, and it was explicitly left out of scope.
The limitation is recorded in a code comment on `valueColumnCount`.

**Follow-up worth doing:** give `parseLabelLines` a positional pre-pass that
tags each value cell with the heading whose x-range it falls under, and have it
drop cells that fall under no heading, before the strings reach `readRows`.
That keeps the reader positionless and gets real column attribution on the
camera path, where the coordinates actually exist.

## Bug 4 — a three-decimal figure was truncated instead of refused

**Before.** `parseLabelText('Protein 3.256 g')` returned `proteinG: 3`. The
regex `(\d+(?:[.,]\d{1,2})?)(?![\d])` could not match `.256`, so it dropped the
optional group and matched the bare `3`. A silently wrong number where the file
promises a blank.

**After.** The fractional part is captured whole (`DECIMAL` =
`\d+(?:[.,]\d+)?`) and `toNumber` refuses anything with more than two fractional
digits. Returns `null`. The one- and two-decimal, comma-decimal, integer and
thousands-separator cases all still pass — including the whole existing
`thousands separators` block, since `stripThousands` still runs first.

The same bounded-fraction regex appeared in `parseEnergyKcal` and
`SERVING_SIZE`; both now use `DECIMAL`. That fixed a live instance of the same
class in serving size: `Serving size: 250.256g` previously scanned forward and
matched `256g`, returning 256 g. It now returns null. `parseServingSize` also
gained `stripThousands`, which it never had, so `1,000 g` reads as 1000 rather
than 0.

## Bug 5 — the parenthetical won even when it held a count

**Before.** `parseLabelText('Serving size: 250mL (1 cup)')` returned no serving
size. The bracket won for existing, `1 cup` has no mass or volume unit, and the
perfectly good `250 mL` outside it was discarded. Standard on drink labels — the
exact inverse of the `2 biscuits (30g)` case the rule was written for.

**After.** The bracket is tried first and only wins if it actually matches a
mass or volume; otherwise the text outside the brackets is read, with the
bracket removed rather than the whole line rescanned, so `2 biscuits (1 serve)`
still yields nothing instead of finding a number in the part already rejected.
`250 mL (1 cup)` → 250 ml. `2 biscuits (30g)` → 30 g, unchanged.

## Verification

- `pnpm --filter @hybrid/nutrition-core exec vitest run` — 141 passed, 7 files
  (label.test.ts 41 → 55 cases).
- `pnpm --filter @hybrid/mobile exec jest src/native/nutrition-label-ocr` — 26
  passed (24 → 26; two new merged-line ML Kit fixtures).
- `pnpm --filter @hybrid/mobile exec jest src/screens/nutrition` — 31 passed
  (the screens that consume the parser).
- `pnpm run typecheck` — clean across all packages and both apps.
- Pre-fix confirmation: reverting `label.ts` alone fails 9 of the new
  nutrition-core cases and both new mobile fixtures.
