# Vendored — do not edit in place

Upstream: https://github.com/anthropics/skills (skills/frontend-design)
Commit:   b29e7cf (2026-07-24)
License:  Apache-2.0 — see LICENSE.txt (shipped by upstream)
Vendored: 2026-08-05

## What this contains

`SKILL.md` only — 55 lines of design process guidance. No scripts, no data, no
dependencies, no network access.

## Relationship to ui-ux-pro-max

These two overlap and pull in opposite directions on the same trigger.
`ui-ux-pro-max` is a catalogue lookup: pick from 84 styles and 192 palettes.
`frontend-design` is a corrective: it argues against choices that read as
templated defaults. Both fire on "design this page."

That tension is intentional and is why both are vendored. See `SKILLS.md`.

## Re-syncing

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/anthropics/skills.git /tmp/askills
git -C /tmp/askills sparse-checkout set skills/frontend-design
diff -r /tmp/askills/skills/frontend-design .claude/skills/frontend-design
```
