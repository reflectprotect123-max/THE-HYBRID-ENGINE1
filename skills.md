# Claude skills and plugins — the canonical record

**This file is the single record of every Claude skill and plugin this project
depends on. `scripts/ensure-skills.sh` is its executable half.**

## The standing contract

The dev container is ephemeral. `~/.claude/skills/` — user scope — dies with
it, and everything that was ever installed there dies with it. The repo
survives. That asymmetry is the whole reason this file exists, and it produces
one rule:

> **Every session checks this file. Anything dead gets restored.** Run
> `bash scripts/ensure-skills.sh` at the start of a session in a fresh
> container. It is idempotent — a healthy install is never touched — so
> running it when nothing is wrong costs one screen of `OK` lines.

And one obligation on whoever installs the next thing:

> **A skill that is installed but not written down here does not survive.** It
> works until the container is recycled and then it silently is not there, and
> the next session has no way to know it ever was. Add the row in the same
> commit that does the install.

The inventory is split into two buckets, and which bucket something is in is a
statement about what it needs, not about how important it is.

- **VENDORED** — markdown and data only, no toolchain. Copied into
  `.claude/skills/` and committed. It needs no install at all: Claude Code
  loads project-scope skills straight out of the working tree, it survives
  offline, and it arrives with the clone. This is exactly how
  `frontend-design`, `install-skill` and `ui-ux-pro-max` already worked before
  this file existed; the rest of the inventory has been brought up to match.
- **INSTALLED** — needs a real toolchain and cannot be vendored. Copying its
  files into the repo would produce something that LOOKS installed and does
  not work. Only two entries qualify.

Before vendoring anything new, check it for executable scripts (`.py`, `.sh`,
`.js`). A skill whose scripts reference paths outside its own directory is not
safely vendorable — it goes in the INSTALLED bucket, with the reason written
down.

---

## VENDORED — committed to this repo, no install

27 skill directories under `.claude/skills/`, plus 3 subagents under
`.claude/agents/` and 5 commands (`.md` + `.toml` each) under
`.claude/commands/`. `.gitignore` excludes `.claude/*` and re-includes these
three paths specifically.

**Verify path for the whole bucket:** the directory exists in the working tree
and is non-empty. Restore is `git checkout -- <path>`, which the script runs
only when the path is ABSENT — a vendored skill with local edits is never
touched.

### superpowers v6.2.0 — 14 skills

| | |
|---|---|
| **What / why** | The disciplined-workflow family: TDD, systematic debugging, writing and executing plans, code review both directions, git worktrees, verification before completion. `CLAUDE.md`'s "Safe workflow" section is this house's version of the same idea; these skills are the general form. |
| **Source** | https://github.com/obra/superpowers |
| **Version** | v6.2.0, commit `44c9b2d` |
| **Install method** | VENDORED (originally installed to user scope 2026-08-06) |
| **Verify path** | `.claude/skills/using-superpowers/SKILL.md` (and the 13 siblings) |
| **Writes outside its own directory** | Nothing at install time. `brainstorming/scripts/start-server.sh` writes session state to `/tmp/brainstorm-*` at runtime, or under `<project>/.superpowers/brainstorm/` when passed `--project-dir` — that path is already in `.gitignore`. |
| **Caveats** | The 14 skills cross-reference each other by name; **all 14 must stay vendored together** or the references dangle. 6 executable scripts ship with them: 4 belong to brainstorming's optional visual companion (a Node server on 127.0.0.1 with token auth — opt-in, text-only is the default path), plus `systematic-debugging/find-polluter.sh` and `writing-skills/render-graphs.js`. All were checked before vendoring: every one resolves paths from its own `SCRIPT_DIR` or the caller's cwd, none reaches into the install location. That is why this family is vendorable at all. |
| **Removal** | `rm -rf .claude/skills/{brainstorming,dispatching-parallel-agents,executing-plans,finishing-a-development-branch,receiving-code-review,requesting-code-review,subagent-driven-development,systematic-debugging,test-driven-development,using-git-worktrees,using-superpowers,verification-before-completion,writing-plans,writing-skills}` and drop them from the `VENDORED` array in `scripts/ensure-skills.sh` |

### caveman — 7 skills + 3 agents + 5 commands

| | |
|---|---|
| **What / why** | Output-token compression. `caveman` is a terse output mode (its README claims a measured 65% cut; that number is the upstream project's, not one we have reproduced here). `cavecrew` delegates to three caveman-style subagents so the tool results injected back into the main thread are smaller — which is what makes a long session last. `caveman-commit` and `caveman-review` are the same idea aimed at commit messages and PR feedback. |
| **Source** | https://github.com/juliusbrussee/caveman (MIT) |
| **Version** | commit `ec83e5b` |
| **Install method** | VENDORED (originally installed to user scope 2026-08-06), **plus one hook** — see the hook row below |
| **Verify path** | `.claude/skills/caveman/SKILL.md`, `.claude/agents/cavecrew-{builder,investigator,reviewer}.md`, `.claude/commands/caveman*.{md,toml}`, and for the stats half, a `caveman-mode-tracker.js` entry under `UserPromptSubmit` in `~/.claude/settings.json` |
| **Writes outside its own directory** | Two things, both deliberate. `caveman-compress` writes at runtime — see caveat (1). And `scripts/ensure-skills.sh` writes `~/.claude/hooks/` plus one `UserPromptSubmit` entry in `~/.claude/settings.json` — USER scope, never this repo's `.claude/settings.json` and never its CLAUDE.md. |
| **Caveats** | **(1)** `caveman-compress` **overwrites the target file in place** and names `CLAUDE.md` as a use case. Its backup goes OUT OF TREE to `$XDG_DATA_HOME/caveman-compress/backups/`, which dies with the container — so the backup is not a backup here. Commit before pointing it at anything. **(2)** `compress.py` makes model calls (`ANTHROPIC_API_KEY` via the SDK, else `claude --print`). **(3)** `caveman-stats` **was a dead skill and is now live** — see below. |
| **The `caveman-stats` hook** | Its `SKILL.md` is a STUB and says so: "the model does not need to do anything when this skill fires." The numbers come from `caveman-mode-tracker.js` on `UserPromptSubmit`, which shells out to `caveman-stats.js` and injects the block as context. Vendoring markdown gave a command that loaded, ran and reported nothing — recorded here as a known dead entry, then fixed on 13 August 2026. Four hook files (`caveman-mode-tracker`, `caveman-stats`, `caveman-config`, `caveman-parse`) are committed under `.claude/hooks/`, and `scripts/ensure-skills.sh` copies them to `~/.claude/hooks/` and registers the one entry. **What was deliberately NOT installed:** upstream's `caveman-activate.js` SessionStart hook, which injects the full caveman ruleset into every session, and its statusline. Neither is the gap; turning on per-turn rule injection nobody asked for is a behaviour change, not a repair. **The tracker is inert until asked** — verified by feeding it an ordinary prompt on stdin, which produced zero bytes of output; it acts only on a `/caveman*` command and only writes `~/.claude/.caveman-active`. The registration merges rather than overwrites, matches on command substring so a re-run cannot stack a duplicate, and refuses to touch a `settings.json` it cannot parse. |
| **Removal** | `rm -rf .claude/skills/{cavecrew,caveman,caveman-commit,caveman-compress,caveman-help,caveman-review,caveman-stats} .claude/agents/cavecrew-*.md .claude/commands/caveman* .claude/hooks` — then delete the `caveman-mode-tracker.js` entry from `~/.claude/settings.json` and `rm -rf ~/.claude/hooks`. |

### supabase-agent-skills v1.1.0 — 2 skills

| | |
|---|---|
| **What / why** | `supabase` covers the client libraries, auth and CLI; `supabase-postgres-best-practices` is 30-odd reference files on schema, RLS, indexes and migrations. Directly relevant — this repo's cross-app boundary is `supabase/migrations/20260804_fitness_ecosystem_contracts.sql`, RLS-owned, and `CLAUDE.md` forbids applying it casually. |
| **Source** | https://github.com/supabase/agent-skills |
| **Version** | v1.1.0, commit `1207767388a0ffb55f21fb4e6988fee96942431d` |
| **Install method** | VENDORED (originally installed to user scope 2026-08-09) |
| **Verify path** | `.claude/skills/supabase/SKILL.md`, `.claude/skills/supabase-postgres-best-practices/SKILL.md` |
| **Writes outside its own directory** | Nothing. Zero executable scripts — pure markdown. |
| **Caveats** | None found. This is the cleanest entry in the inventory. |
| **Removal** | `rm -rf .claude/skills/{supabase,supabase-postgres-best-practices}` |

### session-start-hook — 1 skill, shipped with the container image

| | |
|---|---|
| **What / why** | How to write a `SessionStart` hook so a repo can install dependencies and run tests in Claude Code on the web. |
| **Source** | **The Claude Code on the web container image.** Nobody installed it. This row said "could not be determined" until 13 August 2026; the answer was one directory away. A second, otherwise-empty skills directory exists at `/home/claude/.claude/skills/`, and `session-start-hook` is the ONLY thing in it — an untouched image default, next to `/root/.claude/skills/` where every hand-installed skill landed. The two copies are byte-identical and share an mtime to the nanosecond (`2026-08-05 09:31:44.731500221`), which is an image layer being unpacked, not two installs. That timestamp also predates the earliest install receipt (superpowers, 6 August 20:00) by a day and a half. The frontmatter/directory name mismatch (`startup-hook-skill` vs `session-start-hook`) is upstream's, not a hand-naming tell as previously guessed. |
| **Version** | None. The image ships no version for it, and there is no upstream repo here to pin one against — so this row stays empty rather than inventing a number. |
| **Install method** | VENDORED — and vendoring is the RIGHT call precisely because of the provenance. An image-shipped skill is outside this repo's control: it arrives if the platform still ships it and silently vanishes if the image changes. The committed copy is the one that survives either way. |
| **Verify path** | `.claude/skills/session-start-hook/SKILL.md` |
| **Writes outside its own directory** | Nothing. One markdown file, no scripts. |
| **Caveats** | It has no receipt and never will — `scripts/ensure-skills.sh` cannot restore it from a source URL, only from the git index like every other vendored entry. If the platform ever ships a newer copy, the committed one WINS in this project and no drift is reported; refresh it by hand from `/home/claude/.claude/skills/` if that matters. |
| **Removal** | `rm -rf .claude/skills/session-start-hook` |

### Pre-existing — 3 skills, already committed before this file

`frontend-design`, `install-skill`, `ui-ux-pro-max` — 50 files, tracked by git
since well before this record was written, which is why they have no receipt
and no upstream SHA here. They are the pattern the rest of the bucket was made
to match. `ui-ux-pro-max` carries a searchable local database (styles,
palettes, font pairings) and is the largest thing in `.claude/skills/`.
Removal: `rm -rf .claude/skills/{frontend-design,install-skill,ui-ux-pro-max}`.

---

## INSTALLED — needs a real toolchain, cannot be vendored

Both of these are restored by `scripts/ensure-skills.sh`.

### graphify v0.9.42

| | |
|---|---|
| **What / why** | Turns a codebase, docs or papers into a persistent knowledge graph with god nodes and community detection, then answers architecture questions against it. Useful in a repo this size — two build profiles, a dozen packages and a coordinator that owns arbitration. |
| **Source** | https://github.com/Graphify-Labs/graphify — PyPI package name is **`graphifyy`** (three y's; the CLI is `graphify`, the package is not) |
| **Version** | v0.9.42, commit `7fe58b0` |
| **Install method** | `uv tool install graphifyy==0.9.42` then `graphify install` — **user scope, no `--project`** |
| **Verify path** | `command -v graphify` (the BINARY is the real verify path — its `SKILL.md` is nothing but instructions for driving the CLI, so a present SKILL.md with a missing binary is a dead skill that looks alive). Secondary: `~/.claude/skills/graphify/SKILL.md`. |
| **Why it cannot be vendored** | The skill is a thin wrapper over a Python package that ships two binaries, `graphify` and `graphify-mcp`. Copying `SKILL.md` into the repo would vendor the instructions and none of the program. |
| **Writes outside its own directory** | `~/.claude/CLAUDE.md` — 3 lines, skill registration only. `~/.local/bin/{graphify,graphify-mcp}` via uv. Its analysis output goes to `graphify-out/` in whatever project it is pointed at. |
| **Caveats** | **`graphify install --project` must NOT be run.** It registers PreToolUse hooks in `.claude/settings.json` AND appends a section to THIS REPO's `CLAUDE.md` — two repo edits nobody asked for, on the file that is this project's operating contract. User scope only. The script enforces this by never passing the flag. |
| **Removal** | `rm -rf ~/.claude/skills/graphify ~/.claude/CLAUDE.md && uv tool uninstall graphifyy` |

### claude-obsidian v2.1.0 — 15 skills

| | |
|---|---|
| **What / why** | The wiki/vault family: `wiki`, `wiki-ingest`, `wiki-query`, `wiki-retrieve`, `autoresearch`, `save`, `think`, `canvas`, and the Obsidian syntax helpers. Persistent knowledge outside the repo. |
| **Source** | https://github.com/AgriciDaniel/claude-obsidian |
| **Version** | v2.1.0, pinned at commit `1c1bc49` — verified on this machine, `git -C /root/claude-obsidian rev-parse --short HEAD` agrees |
| **Install method** | Clone to `/root/claude-obsidian` (`PRODUCT_ROOT`), then 15 symlinks from `~/.claude/skills/<name>` into `$PRODUCT_ROOT/skills/<name>/` |
| **Verify path** | `/root/claude-obsidian/scripts/` exists, and each of the 15 symlinks resolves |
| **Why it cannot be vendored** | The skills call `$PRODUCT_ROOT/scripts/*.py` — 11 Python scripts including `bm25-index.py`, `rerank.py`, `retrieve.py`, `claude-obsidian.py`. The clone must stay put. Vendoring the 15 SKILL.md files would give 15 skills whose every action fails on a missing script. This is the exact case the "check for scripts referencing paths outside the skill directory" test is meant to catch. |
| **Writes outside its own directory** | The entire `/root/claude-obsidian` tree; vault writes into whatever vault is selected; derived caches under the vault's `.vault-meta`. |
| **Caveats** | **The pin was unverifiable until 13 August 2026, and is now checked rather than asserted.** This row used to record the gap: the receipt gave a SHA, but `/root/claude-obsidian` had no `.git` directory at all, so nothing on disk could be compared against it — and `scripts/ensure-skills.sh` restored the **default branch**, not the pin. Closed in three parts. The on-disk copy was reconciled: upstream was cloned to scratch, `diff -rq` proved `skills/` and `scripts/` byte-identical to `1c1bc49`, and the clone's `.git` was moved in and checked out at that SHA. The restore path now does a FULL clone (a shallow one cannot reach an arbitrary SHA; the repo is 3.7 MB) and checks the pin out. And the healthy path VERIFIES — it reads `HEAD` and prints a `SKIP` naming the drifted SHA instead of a confident `OK`. One honest limit remains: `1c1bc49` is currently also upstream's default HEAD, so this pin has not yet been tested against a moved default branch. Separately, `wiki-retrieve`'s reranking can egress to a remote model and requires explicit consent per its own skill rules. |
| **Removal** | `rm -rf /root/claude-obsidian && rm -f ~/.claude/skills/{autoresearch,canvas,defuddle,obsidian-bases,obsidian-markdown,save,think,wiki,wiki-cli,wiki-fold,wiki-ingest,wiki-lint,wiki-mode,wiki-query,wiki-retrieve}` |

---

## NOT installed by this script, and why

### omniroute v3.8.49 — deliberately excluded

**`scripts/ensure-skills.sh` does not install this and should not be changed to.**

| | |
|---|---|
| **What it actually is** | **Not a Claude skill.** A self-hosted AI gateway — an npm package that runs a server (default `localhost:20128`) and **routes prompts to third-party providers** according to its routing tiers. |
| **Source** | npm `omniroute`, MIT, author diegosouzapw |
| **Version** | v3.8.49, installed 2026-08-06 via `npm i -g omniroute` |
| **Size** | 3.3 GB, 1181 packages, binary at `/opt/node22/bin/omniroute` |
| **Why excluded** | Three reasons, any one sufficient. It is not a skill, so it has no place in a skill inventory's install path. It is 3.3 GB and 1181 transitive packages — not something a session should pull down as a side effect of "restore the toolchain". And connecting it means routing this project's prompts through third-party providers, which is a decision for the owner, not a script. |
| **Where it belongs** | Environment setup, with a human deciding — not a session install. |
| **Connecting it (for the record, requires a Claude Code RESTART — it cannot affect a running session)** | `ANTHROPIC_BASE_URL=http://localhost:20128/v1`, or `claude mcp add-server omniroute --type http --url http://localhost:20128/api/mcp/stream` |
| **Removal** | `npm rm -g omniroute` |

### `~/.claude/skills/synced/` — platform-managed, not ours

`docx`, `morning`, `pdf`, `pptx`, `skill-creator`, `xlsx`, described by a
`manifest.json` whose entries carry `"source": "anthropic-example"` and their
own `updatedAt` timestamps. This directory is synced by the Claude platform,
not installed by anyone working in this repo. It is recorded here so a future
reader who counts the entries in `~/.claude/skills/` and finds more than this
file lists knows why — not because we manage it. Do not vendor it; the sync
owns it and would be fighting a committed copy.

---

## Inventory summary

| Bucket | Count | Survives a container recycle? |
|---|---|---|
| VENDORED skills | **27** directories: 14 superpowers + 7 caveman + 2 supabase + 1 session-start-hook + 3 pre-existing | Yes — committed |
| VENDORED agents / commands | 3 agents, 5 commands (`.md` + `.toml` each) | Yes — committed |
| VENDORED hook source | 4 files in `.claude/hooks/` — the `caveman-stats` tracker and its deps | Source yes — committed. The user-scope INSTALL of it does not; the script re-does it. |
| INSTALLED | **2** — graphify, claude-obsidian | No — `scripts/ensure-skills.sh` restores them |
| Hooks registered in `~/.claude/settings.json` | **1** — `UserPromptSubmit` → `caveman-mode-tracker.js`. User scope only. | No — the script re-registers it |
| Deliberately excluded | 1 — omniroute | n/a |
| Platform-managed | 6 — `~/.claude/skills/synced/` | Handled by the platform, not by us |

The `VENDORED` array in `scripts/ensure-skills.sh` has 29 entries rather than
27: the 27 skill directories plus `.claude/agents` and `.claude/commands`,
which are checked as whole directories rather than file by file.
