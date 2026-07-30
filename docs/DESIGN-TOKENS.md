# Design tokens — current state of both apps

Written for `design.md` to target. Every visual decision in both apps now flows
through the names below, so a spec that supplies values for these retheme the
product without touching component code.

- **Athlete PWA** — tokens in `index.html` `:root`. JS reads them via `PAL` in
  `app.js` (see "palette bridge"), so hand-painted visuals (rings, gauges,
  charts, confetti) follow the same values. **Never hardcode a colour in app.js.**
- **Coach site** — tokens in `coach/index.html` `:root`. Its JS is colour-free.

Target direction: **one shared language, both dark** (coach moves out of light).

---

## 1. Colour

| Role | Athlete token | Coach token | Note |
|---|---|---|---|
| Page ground | `--bg` | `--beige` | rename both → `--surface-0` |
| Card surface | `--panel` | `--panel` | already same name |
| Raised surface | `--panel2` | `--panel2` | already same name |
| Recessed / sunk | `--panel3`, `--well` + `--well-inset` | `--panel2`, `--surface-head` | coach has no "well" concept |
| Side panel | — | `--panelw` | coach-only (week nav) |
| Text primary | `--text` | `--ink` | → `--fg-1` |
| Text muted | `--muted` | `--ink2` | → `--fg-2` |
| Text dim | `--dim` | `--faint` | → `--fg-3` · **secondary ink only — see below** |
| Hairlines | `--line`, `--line2`, `--hair` | `--line`, `--line2`, `--line3` | |
| Border hover | — | `--line-hover` | |
| Accent | `--gold` | `--orange` | **pick one for the unified look** |
| Accent bright | `--gold2` | — | coach lacks it |
| Accent tint fill | `--gold-wash` | `--orange-soft` | |
| Accent border tint | `--gold-line` | — | |
| Ink ON accent | `--color-on-accent` | `--on-accent`, `--on-accent-deep` | closed on the athlete side — `packages/design/src/tokens.css`'s `--color-on-accent` (`color.onAccent` in `tokens.ts`) is the shared token every brass/gold control's ink now resolves through |
| Ink ON dark fill | — | `--on-dark`, `--on-dark-ink` | |
| Metal gradient / edge | `--brass-grad`, `--brass-edge` | — | athlete-only signature |

| Completion state | `--done-bg`, `--done-line`, `--done-ink` | — | deliberately brass, not green |
| Success / warn / error | `--ok`, `--warn`, `--bad` | `--ok`, `--warn`, `--danger` | converge names |
| Link | `--blue`, `--blue2` | `--blue` | |
| Hover surfaces | — | `--hover-1`, `--hover-2` | |
| Scrollbar | — | `--scroll`, `--scroll-hover` | |
| Dark chrome inks | — | `--nav-ink`, `--nav-hi`, `--nav-ink2`, `--nav-ink3`, `--nav-ink4`, `--nav-ico`, `--nav-dot`, `--nav-chip(-ink)`, `--nav-avatar(-ink)` | the coach topbar/rail ladder |
| Exercise-card greys | — | `--exhdr`, `--exhdr-line`, `--exhdr-line2`, `--exhdr-line3`, `--exhdr-tick` | the "TrainHeroic" cool band |
| Cell focus | — | `--cell-focus` | prescription input focus |
| Trophy / media | — | `--trophy`, `--thumb`, `--thumb-1`, `--thumb-2` | |

### `dim` is a secondary ink, and that is a constraint not a preference

Measured against every surface in the palette:

| ink on… | `bg` | `panel` | `panel2` | `well` |
|---|---|---|---|---|
| `text` | 17.9 | 16.5 | 15.3 | 17.4 |
| `muted` | 8.1 | 7.5 | 7.0 | 7.9 |
| **`dim`** | 5.0 | 4.6 | **4.2** | 4.8 |

Every other ink clears 4.5:1 everywhere. `dim` on `panel2` does not — it lands
at 4.2, which passes the 3:1 bar for secondary text and fails the 4.5:1 bar for
body copy.

The value is right and is used correctly in ~90 places; what was missing was
the rule written down. **Do not set body copy in `dim` on `panel2`** — labels,
units, timestamps and captions are what it is for. If a sentence someone has to
read lands in `dim`, it wants `muted`, which clears 7:1 on every surface.

Regenerate the table with the contrast script in `checks/` if the palette moves.

### Meaning-bearing colour — change deliberately
HR zones are **semantic**, not decorative. Say explicitly in `design.md` whether
these may move:

`--zone-blue` / `--z-low` · `--zone-green` · `--zone-red` / `--z-high` · `--z-mod`

Ring glow (brighter than the band inks): `--neon-strain`, `--neon-ok`,
`--neon-warn`, `--neon-bad`, plus `--ring-idle`.
Arc/track fills: `--track-soft`, `--track`, `--track-strong` (three near-identical
alphas — **good candidates to collapse to one**), and `--chart-dot-ring`.

## 2. Radius
- Athlete: `--r-sm 10` · `--r-md 14` · `--r-lg 18` · `--r-pill` (plus a legacy `--r`)
- Coach: `--r-xs 6` · `--r-sm 7` · `--r-md 8` · `--r-lg 9` · `--r-xl 10` · `--r-2xl 14` · `--r-pill`

The two scales disagree (coach is much tighter). **A unified spec should state one
scale**; the names already exist on both sides to remap onto.

## 3. Elevation
- Athlete: `--shadow-card`, `--lift-open`, `--well-inset`, `--brass-edge`
- Coach: `--shadow-btn`, `--shadow-card`, `--shadow-menu`, `--shadow-toast`, `--shadow-modal`

## 4. Type
Both load the same self-hosted variable **Inter** (`fonts/inter-var.woff2`).

Step slots exist in both: `--fs-1` … `--fs-8`, and athlete adds
`--fw-reg/med/semi/bold/black`.

⚠️ **These are declared but not yet consumed** — the athlete app still has ~29
distinct font sizes and 11 weights, coach ~20 sizes. Supply the real scale in
`design.md` and they get collapsed onto these names. Athlete uses variable-font
intermediate weights (650/750/850); coach only uses hundreds.

Preserve: `font-variant-numeric: tabular-nums` on every numeric readout, and the
uppercase tracked micro-label idiom (`.kicker`, `.microlab`).

## 5. Spacing
`--sp-1 4` · `--sp-2 8` · `--sp-3 12` · `--sp-4 16` · `--sp-5 20` · `--sp-6 24` · `--sp-8 32`
(athlete only, **declared but not yet consumed** — every margin is still a literal).

## 6. Motion
- Athlete: `--dur-fast .12` · `--dur-base .15` · `--dur-mid .22` · `--dur-slow .3`;
  `--ease-standard`, `--ease-entrance`, `--ease-overshoot`
- Coach: `--dur-fast`, `--dur-base`, `--dur-mid`

Also declared-not-yet-consumed (30 hand-inlined timings remain in the athlete app).

## 7. Known gaps a spec should decide
1. **Accent: gold or orange?** The single biggest unification call.
2. **One radius scale** across both apps.
3. **Type scale** — collapse 29/20 ad-hoc sizes to ~7 steps.
4. **Collapse the three `--track-*` alphas** to one.
5. **Coach responsiveness** — it's desktop-only by construction (one breakpoint;
   the `80px 300px 1fr` shell never collapses). State if it must work narrower.
6. **Reduced motion** — coach has one blanket rule; the athlete app has 8
   per-component queries covering only ~half its animations. Worth unifying.
7. **Non-themeable leftovers**: emoji used as iconography in the athlete app
   (`❤️ 🏋️ 📋`), and both favicons are data-URI SVGs with baked-in colours.
