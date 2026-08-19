# REBUILD.md — instructions for a coding agent

> **Before you start:** `index.html` in this bundle is already a complete, working,
> self-contained artifact. If the user only wants to *view* it, tell them to open it.
> Rebuilding from scratch is strictly worse — you would lose verified content.
>
> Only proceed if the user wants to **extend, restyle, port, or split** it.

---

## What this artifact is

A single HTML file, ~125 KB, no dependencies, no build step, no network requests.
Everything is inline: CSS, SVG diagrams, chart JS, and content.

**19 sections** under a sticky left rail:

| id | Section |
|---|---|
| `how` | Orientation — confidence-marker key |
| `arch` | A1 Architecture (4 front-ends, 2 API generations) |
| `ia` | A2 Information architecture (full nav tree) |
| `ui` | A3 UI reconstruction (5 annotated screen mockups) |
| `their-model` | A4 Their data model as-is + verified enums |
| `states` | B1 Session state machine (SVG) |
| `logging` | B2 Athlete logging flow |
| `offline` | B3 Offline write path |
| `e1rm` | C1 Estimated 1RM (interactive chart + table view) |
| `readiness` | C2 Readiness |
| `metrics` | C3 Volume · Intensity · Compliance |
| `rounding` | C4 Load rounding |
| `ceiling` | D1 The 2-metric ceiling |
| `erd` | D2 Target ERD |
| `ddl` | D3 SQL DDL |
| `pipeline` | D4 Resolution pipeline (SVG) |
| `cond` | D5 Structured conditioning |
| `matrix` | E1 Steal/reject matrix |
| `order` | E2 Build order |

---

## Hard rules — do not break these

### 1. Never invent or "clean up" a fact
Every claim carries a confidence marker: **[V] verified**, **[I] inferred**, **[U] unknown**.
These are load-bearing. If you restructure content, the marker travels with the claim.

Do **not** replace a `[U]` with a plausible-sounding value. Five things are genuinely
undocumented and must stay that way: TrainHeroic's Volume, Intensity, Compliance,
StackUp coefficients, and percentage rounding.

### 2. Never present my proposed formulas as TrainHeroic's
`docs/` is explicit about which is which. Preserve that distinction in any rewrite.

### 3. The colour palette is validated — do not substitute hexes by eye
`src/tokens.css` holds a palette that passes a six-check validator (lightness band,
chroma floor, CVD separation, normal-vision floor, contrast) in **both** light and dark,
on the all-pairs list.

If you change any series colour you must re-run the validator. Do not reason about it.

**Standing constraint:** light-mode aqua `#1baf7a` sits at 2.74:1 against the surface.
That triggers the relief rule, which is why the e1RM chart ships **direct labels on every
line AND a table-view toggle**. If you remove either one, the chart becomes inaccessible.
Keep both.

### 4. Dark mode is selected, not flipped
Dark values are their own steps from the same ramps, declared under **both**
`@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`, with a
`:where(:not([data-theme="light"]))` guard so a manual toggle wins in both directions.
Do not replace this with a CSS filter or an `invert()`.

### 5. Charts keep their hover layer
Crosshair + tooltip on the line chart is not optional decoration.

---

## Common tasks

### Restyle to your brand
1. Replace the ramp values in `src/tokens.css` — structure and role names stay identical.
2. Re-run the palette validator against your own light and dark surfaces.
3. Only then paste the block back over the `<style>` token section at the top of `index.html`.

### Split into a multi-file project
```
src/index.html      shell + nav
src/tokens.css      already extracted
src/sections/*.html one per section id
src/chart.js        the C1 chart (currently the first IIFE in the closing <script>)
```
Keep the output shippable as a single file too — that is why it has no dependencies.

### Port to React / Astro / Next
- Sections map cleanly to components; each is a self-contained `<section id>`.
- The chart is plain SVG built imperatively — port it to your chart lib **only** if the
  lib can honour direct labels + table view. Otherwise keep the hand-rolled SVG.
- The SVG diagrams (`states`, `pipeline`) are hand-positioned. If you regenerate them
  with a layout engine, **render and eyeball the result** — the current coordinates
  exist because three label collisions were found and fixed by looking at renders.

### Add a section
Add `<section id="…">` before `</main>`, add a matching `<a href="#…">` in `nav.rail`.
The scroll-spy `IntersectionObserver` picks it up automatically.

---

## Verification — run this before you call it done

The validator checks colour, not layout. **Render it and look at it.**

```bash
npm i playwright
node - <<'JS'
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const theme of ['light','dark']) {
    const p = await b.newPage({ viewport:{width:1560,height:1200}, deviceScaleFactor:2 });
    p.on('pageerror', e => errs.push(theme+': '+e.message));
    p.on('console', m => { if (m.type()==='error') errs.push(theme+' console: '+m.text()); });
    await p.goto('file://' + process.cwd() + '/index.html');
    await p.evaluate(t => localStorage.setItem('bp-theme', t), theme);
    await p.reload(); await p.waitForTimeout(700);
    await p.screenshot({ path:`check-${theme}.png`, fullPage:true });
    const ov = await p.evaluate(() => {
      const bad = [];
      document.querySelectorAll('main *').forEach(e => {
        if (e.scrollWidth > e.clientWidth + 4 && getComputedStyle(e).overflowX === 'visible')
          bad.push(e.tagName + '.' + e.className);
      });
      return bad.slice(0,10);
    });
    if (ov.length) errs.push(theme + ' overflow: ' + JSON.stringify(ov));
    await p.close();
  }
  console.log(errs.length ? errs.join('\n') : 'PASS — no errors, no overflow');
  await b.close();
})();
JS
```

Then **open the screenshots and look at them** for label collisions, clipped SVG text,
and table overflow. The automated check cannot see those. `assets/screens/` holds the
reference renders to diff against.

---

## Known-good baseline

At time of packaging, `index.html` passed:

- no JS errors, no console errors, in both themes
- no element overflow in either theme
- palette validator: all six checks PASS, `--pairs all`, light and dark
- visual review of all six diagram-heavy sections in both themes

Three label collisions were found by visual review and fixed:
the NSCA line ends mid-plot so its direct label now uses a leader line into empty space;
the undefined-band caption moved to the bottom of the band; the 11-rep interpolation note
moved to the empty upper-left with its own leader. Do not undo these by "tidying" the SVG.
