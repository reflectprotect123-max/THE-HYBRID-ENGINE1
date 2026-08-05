# Skills available in this repository

Skills are instruction sets Claude loads on demand. They are not libraries you
call — they change how the assistant works before it touches your code. This
file records what is installed, where it lives, and how long it survives.

Read `CLAUDE.md` first. It is the operating contract. Nothing here overrides it:
a skill that suggests moving recovery logic into a specialist engine, or
skipping the ecosystem contract guard, is wrong for this repository.

## What is installed

| Source | Skills | Survives a new sandbox? |
|---|---|---|
| `.claude/skills/` (committed) | `install-skill` | Yes — in git |
| `~/.claude/skills/` (container) | 14 superpowers skills, `graphify` | **No** |
| Built into Claude Code | `review`, `security-review`, `simplify`, `run`, `init` | Yes |

Anything in the container dies when the remote sandbox is reclaimed. To make it
permanent, copy the directory into `.claude/skills/` and commit it.

## The superpowers workflow

From [obra/superpowers](https://github.com/obra/superpowers) at `44c9b2d`.
This repository already uses its outputs — see `docs/superpowers/plans/` and
`docs/superpowers/specs/`, which hold the plan and spec documents from previous
cycles.

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

Available at any point:

- `test-driven-development` — before writing implementation code
- `systematic-debugging` — on any bug or test failure, before proposing a fix
- `dispatching-parallel-agents` — 2+ independent tasks with no shared state
- `writing-skills` — creating or editing skills
- `using-superpowers` — how skill discovery itself works

`verification-before-completion` matters most here. This repository's handoff
history contains repeated instances of green-looking work being described as
finished when a build step had not run. The rule that file states plainly —
evidence before assertions — is the same rule the skill enforces.

### Two caveats

**The SessionStart hook is not installed.** Superpowers ships a hook that primes
every session automatically. It depends on the plugin system, which this remote
environment does not provide. The skills work when invoked; they do not
self-announce. Treat them as opt-in.

**Several descriptions are deliberately broad.** `brainstorming` claims any
creative work; `using-superpowers` claims the start of any conversation. They
are written to be hard to skip. Expect them to trigger often.

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
Add `graphify-out/` to `.gitignore` before running it if you do not want the
artefacts tracked.

Useful here because the package boundaries in this monorepo are contractual:
the graph shows which packages actually reach each other, as opposed to which
ones `CLAUDE.md` says are allowed to.

## install-skill

Committed to this repository. Vets a third-party skill before installing it —
clones to scratch, inventories executable scripts, checks self-containment and
frontmatter, reports, and only then copies.

Use it for anything from outside this repository. A skill is instructions the
assistant follows plus scripts it may run; `npm install` at least gives you a
lockfile and a diff.

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

Each container install leaves a receipt next to it —
`~/.claude/skills/.<name>-INSTALLED` — recording the version, commit, source
URL, install date, and the exact removal command.
