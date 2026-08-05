# Skills available in this repository

Skills are instruction sets Claude loads on demand. They are not libraries you
call — they change how the assistant works before it touches your code. This
file records what is installed, where it lives, and how long it survives.

Read `CLAUDE.md` first. It is the operating contract. Nothing here overrides it:
a skill that suggests moving recovery logic into a specialist engine, or
skipping the ecosystem contract guard, is wrong for this repository.

## What is installed

38 skills, from four places. Only one of them is in git.

| Source | Count | Survives a new sandbox? |
|---|---|---|
| `.claude/skills/` (committed) | 1 — `install-skill` | **Yes** — in git |
| Environment-provided | 7 | Yes — restored by the platform |
| Installed into `~/.claude/skills/` | 30 | **No** |
| Built into Claude Code | `review`, `security-review`, `simplify`, `run`, `init` | Yes |

Thirty skills die when this container is reclaimed, along with 3 subagents in
`~/.claude/agents/` and 5 slash commands in `~/.claude/commands/`. To make any
of them permanent, copy the directory into `.claude/skills/` and commit it.

Environment-provided: `docx`, `pdf`, `pptx`, `xlsx`, `morning` and
`skill-creator` are managed via `~/.claude/skills/manifest.json`;
`session-start-hook` ships alongside them without a manifest entry. Leave all
seven alone.

## The superpowers workflow

From [obra/superpowers](https://github.com/obra/superpowers) at `44c9b2d`.
14 skills. This repository already uses its outputs — see
`docs/superpowers/plans/` and `docs/superpowers/specs/`, which hold the plan and
spec documents from previous cycles.

The chain, in order:

```
brainstorming          explore intent and requirements before any creative work
      ↓
writing-plans          turn a spec into a task-by-task implementation plan
      ↓
using-git-worktrees    isolate the work — see docs/WORKTREES.md
      ↓
executing-plans                 across sessions, with review checkpoints
subagent-driven-development     within one session, independent tasks
      ↓
requesting-code-review    verify the work meets the requirements
receiving-code-review     evaluate feedback rigorously, do not just comply
      ↓
verification-before-completion   run the commands, read the output, then claim
      ↓
finishing-a-development-branch   decide how the work integrates
```

Available at any point: `test-driven-development`, `systematic-debugging`,
`dispatching-parallel-agents`, `writing-skills`, `using-superpowers`.

`verification-before-completion` matters most here. This repository's handoff
history contains repeated instances of green-looking work being described as
finished when a build step had not run. The rule that file states plainly —
evidence before assertions — is the same rule the skill enforces.

**Two caveats.** The SessionStart hook is *not* installed; it depends on the
plugin system, which this remote environment does not provide. The skills work
when invoked but do not self-announce — treat them as opt-in. And several
descriptions are deliberately broad (`brainstorming` claims any creative work),
so expect them to trigger often.

## Design skills

Two sources that overlap, installed together. They pull in opposite directions
on the same trigger, which is worth understanding before you use them.

**[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)**
`4d140cf`, MIT, 7 skills, 8.4M, 33 executable scripts:
`ui-ux-pro-max`, `ui-styling`, `design`, `design-system`, `brand`, `slides`,
`banner-design`.

**[anthropics/skills](https://github.com/anthropics/skills)** `b29e7cf`,
Apache-2.0, 1 skill, no scripts: `frontend-design`.

The distinction:

- `ui-ux-pro-max` is a **lookup** — 84 styles, 192 palettes, 74 font pairings,
  in local CSVs. Pick from the database.
- `frontend-design` is a **corrective** — it explicitly targets choices that do
  not read as templated defaults.

Both trigger on "design this page." If the output appears to argue with itself
on UI work, this is why. `frontend-design` also satisfies a dependency
`banner-design` declares in its own description.

`ui-ux-pro-max` and `ui-styling` are the two that fit `@hybrid/web`. `brand`,
`slides` and `banner-design` are marketing tooling with descriptions broad
enough ("branded content, tone of voice, marketing assets") to trigger on
sessions that have nothing to do with this codebase.

**Three things the README got wrong**, found by reading the scripts:

| Claim | Reality |
|---|---|
| "the scripts make no network calls" | `design-system/scripts/fetch-background.py` downloads stock photos from Pexels |
| "the scripts install nothing" | `ui-styling/scripts/shadcn_add.py` shells out to `npx shadcn@latest add`, installing packages into your project |
| no API keys needed | `GEMINI_API_KEY` appears 21 times — logo and icon generation in `design` calls Google's API and fails without it |

None of it is malicious — the Pexels URLs are a hardcoded curated list, and
shadcn is what a UI skill would legitimately use. It is just not what the
documentation advertises.

## Caveman

From [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) at
`ec83e5b`, MIT. Compresses assistant output to cut token spend. 7 skills, plus
parts that do not live in `skills/`:

- `~/.claude/agents/` — `cavecrew-investigator` (read-only code locator),
  `cavecrew-builder` (1–2 file edits, refuses 3+), `cavecrew-reviewer` (diffs).
  The `cavecrew` skill delegates to these by name; without them it is broken.
- `~/.claude/commands/` — `/caveman`, `/caveman-init`, `/caveman-commit`,
  `/caveman-review`, `/caveman-stats`.

Skills: `caveman` (output mode, six intensity levels), `cavecrew`,
`caveman-commit`, `caveman-review`, `caveman-compress`, `caveman-stats`,
`caveman-help`.

**Know these three before using it:**

1. **`caveman-compress` overwrites files in place**, and names `CLAUDE.md` as a
   target. In this repository `CLAUDE.md` is the operating contract. Backups go
   to `~/.local/share/caveman-compress/backups` — out-of-tree, and *inside the
   container*, so they die with it. Commit before pointing it at anything.
2. **Two skills auto-trigger unasked** — `caveman-commit` on staging changes,
   `caveman-review` on reviewing PRs. Commit messages and review output go terse
   by default.
3. **`compress.py` shells out to the `claude` CLI** (or uses
   `ANTHROPIC_API_KEY`). It makes model calls; it is not a local transform.

## graphify

Builds a queryable knowledge graph of a codebase — AST-parsed, deterministic,
no LLM for code, nothing leaves the machine.

```bash
/graphify .                      # map this repository
/graphify query "<question>"     # traverse the graph instead of grepping
/graphify path "A" "B"           # shortest path between two concepts
/graphify explain "<node>"       # plain-language explanation of one node
```

Output lands in `graphify-out/` — `graph.html`, `GRAPH_REPORT.md`, `graph.json`.
**Not in `.gitignore`** — add it before running if you do not want the artefacts
tracked.

Useful here because the package boundaries in this monorepo are contractual:
the graph shows which packages actually reach each other, as opposed to which
ones `CLAUDE.md` says are allowed to.

## install-skill

The only skill committed to this repository. Vets a third-party skill before
installing it — clones to scratch, inventories executable scripts, checks
self-containment and frontmatter, reports, and only then copies.

Every warning in this file came out of that procedure. Use it for anything from
outside this repository; a skill is instructions the assistant follows plus
scripts it may run, and `npm install` at least gives you a lockfile and a diff.

## Installing and removing

Container, for the current sandbox:

```bash
cp -r <skill-dir> ~/.claude/skills/<name>
rm -rf ~/.claude/skills/<name>          # remove
```

Repository, permanent and shared with everyone who clones:

```bash
cp -r <skill-dir> .claude/skills/<name>
git add .claude/skills/<name> && git commit
```

Prefer the container while evaluating. A committed skill shapes the default
behaviour of every future session in this repository, including sessions about
unrelated parts of the codebase.

Newly copied skills load immediately — no restart. Each install leaves a receipt
next to it recording version, commit, source URL, date, known caveats and the
exact removal command:

```
~/.claude/skills/.superpowers-INSTALLED
~/.claude/skills/.graphify-INSTALLED
~/.claude/skills/.ui-ux-pro-max-INSTALLED
~/.claude/skills/.caveman-INSTALLED
~/.claude/skills/.frontend-design-INSTALLED
```
