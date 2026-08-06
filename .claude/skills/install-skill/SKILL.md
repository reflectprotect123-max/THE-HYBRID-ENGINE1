---
name: install-skill
description: "Install a third-party Claude skill or plugin from a GitHub repo or marketplace, after vetting what it actually contains. Use this whenever the user wants to add, install, or try out a skill, plugin, or marketplace from outside this project — including when they paste a `/plugin marketplace add` or `/plugin install` command, a GitHub URL, or an owner/repo pair and ask to install it. Also use it when they ask what a skill would do before installing, or want one removed."
---

# Installing a skill from outside this project

`/plugin marketplace add` and `/plugin install` are **client-side commands**. Typed
into a session they arrive as plain text — there is no tool that runs them. In
remote/web environments there is usually no plugin machinery at all: no
`~/.claude/plugins`, just `~/.claude/skills/` holding one directory per skill.

So installing means **placing skill directories where they are read**. That part
is a `cp`. The part worth doing carefully is knowing what you just copied.

## Why vetting is the job

A skill is not a library. A library is code you call; a skill is *instructions
that get loaded into the assistant's context and followed*, plus — very often —
scripts the assistant will then run on the user's machine. `npm install` at least
gives you a lockfile and a diff. A skill silently changes what the assistant
does on every future session.

That asymmetry is the whole reason for the steps below. None of them assume bad
faith. They exist because "it turned out to also want to generate marketing
banners" and "it shipped 25 Python scripts" are things the user should hear
*before* the copy, not discover later.

## Procedure

### 1. Confirm the source is real, and is what it claims

Fetch the repo page before cloning. A typo'd or renamed repo should fail here,
not halfway through an install. Note what the README says it does — you will
compare that against what you actually find.

### 2. Clone to scratch — never straight into a skills directory

```bash
SCRATCH="${SCRATCH_DIR:-/tmp}/skill-vet"
rm -rf "$SCRATCH" && git clone --depth 1 -q https://github.com/<owner>/<repo>.git "$SCRATCH"
```

Shallow, and somewhere disposable. Cloning into `~/.claude/skills/` directly
would install it before anyone had a chance to look, which defeats the point.

### 3. Find the skills and take an inventory

Skills live in `.claude/skills/*/SKILL.md`, sometimes `skills/*/SKILL.md`. A
`.claude-plugin/marketplace.json` gives you the version and the author's own
description.

```bash
du -sh "$SCRATCH" "$SCRATCH"/.claude/skills 2>/dev/null
du -sh "$SCRATCH"/.claude/skills/*/
find "$SCRATCH"/.claude/skills -type f | sed 's/.*\.//' | sort | uniq -c | sort -rn | head
find "$SCRATCH"/.claude/skills -type f \( -name '*.py' -o -name '*.sh' -o -name '*.js' -o -name '*.cjs' \)
```

The file-type census matters more than the total size. Markdown and CSV are
reference data. `.py`, `.sh`, `.js` are **code the assistant may execute**, and
their count is the single most useful number to report.

### 4. Check self-containment

```bash
grep -rhoE '(\.\./)+[a-zA-Z0-9_/.-]+' --include=SKILL.md "$SCRATCH"/.claude/skills | sort -u
```

Nothing returned means each skill stands alone and copying just the skill
directories is enough. Hits mean it reaches outside — copying only the skills
would install something quietly broken, so say so rather than proceeding.

### 5. Validate the frontmatter

A `SKILL.md` without YAML frontmatter carrying `name` and `description` will not
load. It will also not *complain* — it simply never triggers, which reads as
"the skill is bad" rather than "the skill never ran". Check every one, and read
the descriptions properly: the description is the trigger, so it tells you what
will pull this skill into future sessions.

### 6. Check for name collisions

Against `~/.claude/skills/`, the project's `.claude/skills/`, and any enabled
plugins (`ListPlugins`). Two skills with one name is ambiguity the user will
experience as the assistant behaving unpredictably. Never overwrite — skip, and
report the skip.

### 7. Report before copying

Give the user, briefly:

- what it is, its version and commit
- how many skills, and **what each one's description would trigger on** — flag
  anything much broader than what they asked for
- how many executable scripts ship with it
- any name collisions
- anything the inventory contradicted about the README

### 8. Offer the two destinations, with the real tradeoff

| | Path | Lifetime |
|---|---|---|
| Container | `~/.claude/skills/` | Dies when the sandbox is reclaimed. Nothing committed. |
| Project | `<repo>/.claude/skills/` | Committed to git. Loads on every future session, for everyone. |

Recommend the container for anything being tried out, and the project only for
something the user is confident they want permanently — a committed skill shapes
the default behaviour of every session in that repo, including ones about
unrelated parts of the codebase.

Both are cheap to reverse. Say which one you would pick and why, rather than
just listing them.

### 9. Copy, skipping collisions

```bash
for d in "$SCRATCH"/.claude/skills/*/; do
  n=$(basename "$d")
  if [ -e "$DEST/$n" ]; then echo "  SKIP $n — already exists"; continue; fi
  cp -r "$d" "$DEST/$n" && echo "  + $n"
done
```

### 10. Leave a receipt

Write the version, commit SHA, source URL, date and the exact removal command
next to the install. Six weeks later "where did this come from and how do I get
rid of it?" should be answerable without archaeology.

```bash
printf '%s v%s (%s)\nfrom %s\ninstalled %s\nRemove: rm -rf %s/{%s}\n' \
  "$NAME" "$VER" "$SHA" "$URL" "$(date -u +%Y-%m-%d)" "$DEST" "$LIST" \
  > "$DEST/.$NAME-INSTALLED"
```

### 11. Confirm it actually loaded

Newly copied skills often appear in the available-skills list immediately — check
before telling the user to restart, because "you'll need a new session" is
annoying and frequently untrue. If they have not appeared, then say so.

## Removing

`rm -rf` the skill directories and the receipt file. If it was committed to the
project, that is a normal revert. Skills carry no install state anywhere else,
so there is nothing else to clean up.

## When the source is a marketplace command

The user may paste:

```
/plugin marketplace add owner/repo
/plugin install thing@marketplace
```

Read the owner/repo out of it and follow the procedure above — the marketplace
indirection does not change what ends up on disk. Mention once that those
commands only work in the desktop/CLI client, so they know why the paste did
nothing, then get on with installing it.
