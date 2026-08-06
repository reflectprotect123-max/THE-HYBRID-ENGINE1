# Vendored — do not edit in place

Upstream: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
Commit:   4d140cf (v2.0, 2026-08-03)
License:  MIT — see LICENSE (copied from the upstream repository root, which
          is where upstream keeps it; the skill directory ships none)
Vendored: 2026-08-05

Only the `ui-ux-pro-max` skill is vendored. Upstream ships six more —
`ui-styling`, `design`, `design-system`, `brand`, `slides`, `banner-design` —
which are deliberately not committed here. See `SKILLS.md`.

## What this contains

35 CSV databases (84 styles, 192 palettes, 74 font pairings, 192 product types,
98 UX guidelines, 25 chart types across 22 stacks) and 6 Python scripts that
search them. Standard library only, no external dependencies.

`data/google-fonts.csv` is 743K and accounts for most of the directory size.

## Scripts

`scripts/search.py`, `core.py`, `design_system.py`, `validate_data.py` and two
test files. This skill's scripts are local search over the bundled CSVs — they
make no network calls and require no API key.

That is *not* true of the upstream skills we did not vendor:
`design-system/scripts/fetch-background.py` downloads from Pexels,
`ui-styling/scripts/shadcn_add.py` runs `npx shadcn@latest add`, and `design`
requires `GEMINI_API_KEY`. If you vendor any of those later, re-read them first.

## Re-syncing

```bash
git clone --depth 1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git /tmp/uipm
diff -rq /tmp/uipm/.claude/skills/ui-ux-pro-max .claude/skills/ui-ux-pro-max
```

Replace the directory wholesale rather than patching it, then restore `LICENSE`
and this file. Local edits will be lost on the next sync — that is the point of
not editing in place.
