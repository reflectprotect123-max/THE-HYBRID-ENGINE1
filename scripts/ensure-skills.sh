#!/usr/bin/env bash
#
# ensure-skills.sh — restore the Claude toolchain this repo depends on.
#
# WHY THIS EXISTS
# ---------------
# The dev container is ephemeral. `~/.claude/skills/` — user scope — dies with
# it, and everything that was ever installed there dies with it too. The repo
# survives. So the durable answer is to keep as much of the toolchain as
# possible INSIDE the repo (vendored, committed, restored by `git checkout`)
# and to keep a short, explicit, pinned recipe for the two things that cannot
# live there because they need a real toolchain rather than markdown.
#
# `skills.md` at the repo root is the canonical record of what those things
# are and why. This script is the executable half of it: read the file, run
# the script, and a fresh container is back where the last one was.
#
# CONTRACT
# --------
# - Idempotent. A healthy install is never touched, never reinstalled, never
#   overwritten. The second run of this script prints the same lines as the
#   first and changes nothing.
# - One status line per entry, so the output is readable at a glance rather
#   than a wall of package-manager noise.
# - Exit non-zero ONLY on a real failure — something was dead AND could not be
#   brought back. A skipped optional entry is not a failure.
#
# WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
# -----------------------------------------
# - It never runs `graphify install --project`. That command writes PreToolUse
#   hooks into `.claude/settings.json` and appends a section to THIS REPO's
#   CLAUDE.md. Both are repo edits nobody asked for. User scope only.
# - It never installs omniroute. omniroute is not a Claude skill — it is a
#   3.3 GB npm AI gateway that routes prompts to third-party providers. That
#   belongs in environment setup with a human deciding, not in a session's
#   restore script. See the "NOT installed by this script" section of
#   `skills.md`.
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_SKILLS="${HOME}/.claude/skills"
FAILURES=0

ok()   { printf '  OK      %-28s %s\n' "$1" "$2"; }
fixed(){ printf '  FIXED   %-28s %s\n' "$1" "$2"; }
warn() { printf '  SKIP    %-28s %s\n' "$1" "$2"; }
fail() { printf '  FAIL    %-28s %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# Bucket 1 — VENDORED
#
# Markdown/data-only skills, committed under `.claude/skills/` (plus the
# cavecrew agents and caveman commands under `.claude/agents/` and
# `.claude/commands/`). These need NO install: Claude Code loads project-scope
# skills straight out of the working tree, they survive offline, and they
# arrive with the clone.
#
# The only way one of these goes missing is a damaged working tree — a bad
# checkout, a stray `rm -rf`. So the repair is `git checkout --`, and it is
# guarded to run ONLY when the path is absent. A vendored skill that exists
# but has local edits is left completely alone; this script must never be the
# reason someone loses work in progress.
# ---------------------------------------------------------------------------
VENDORED=(
  # superpowers v6.2.0 — 14 skills, cross-referencing, must stay together
  .claude/skills/brainstorming
  .claude/skills/dispatching-parallel-agents
  .claude/skills/executing-plans
  .claude/skills/finishing-a-development-branch
  .claude/skills/receiving-code-review
  .claude/skills/requesting-code-review
  .claude/skills/subagent-driven-development
  .claude/skills/systematic-debugging
  .claude/skills/test-driven-development
  .claude/skills/using-git-worktrees
  .claude/skills/using-superpowers
  .claude/skills/verification-before-completion
  .claude/skills/writing-plans
  .claude/skills/writing-skills
  # caveman family — 7 skills + 3 agents + 5 commands (.md and .toml each)
  .claude/skills/cavecrew
  .claude/skills/caveman
  .claude/skills/caveman-commit
  .claude/skills/caveman-compress
  .claude/skills/caveman-help
  .claude/skills/caveman-review
  .claude/skills/caveman-stats
  .claude/agents
  .claude/commands
  # supabase-agent-skills v1.1.0
  .claude/skills/supabase
  .claude/skills/supabase-postgres-best-practices
  # unattributed, see skills.md
  .claude/skills/session-start-hook
  # pre-existing, committed long before this script
  .claude/skills/frontend-design
  .claude/skills/install-skill
  .claude/skills/ui-ux-pro-max
)

echo "Vendored skills (committed in this repo — no install needed)"
for path in "${VENDORED[@]}"; do
  name="$(basename "$path")"
  abs="${REPO_ROOT}/${path}"
  if [ -d "$abs" ] && [ -n "$(ls -A "$abs" 2>/dev/null)" ]; then
    ok "$name" "$path"
    continue
  fi
  # Missing. Restore from the index — this only ever recreates tracked files.
  if git -C "$REPO_ROOT" checkout -- "$path" 2>/dev/null && [ -d "$abs" ]; then
    fixed "$name" "restored from git index"
  else
    fail "$name" "missing and 'git checkout -- $path' did not restore it"
  fi
done

# ---------------------------------------------------------------------------
# Bucket 2 — INSTALLED
#
# These cannot be vendored: they are not markdown, they are toolchains. Copying
# their files into the repo would produce something that looks installed and
# does not work.
# ---------------------------------------------------------------------------
echo
echo "Installed toolchains (ephemeral — reinstalled here when missing)"

# --- graphify v0.9.42 -------------------------------------------------------
# A Python package (`graphifyy` on PyPI) exposing the `graphify` and
# `graphify-mcp` binaries, plus a SKILL.md that graphify itself writes into
# user scope. The SKILL.md alone is useless — its entire content is
# instructions for driving the CLI — so the verify path is the BINARY, and the
# skill directory is checked as a second condition rather than the primary one.
GRAPHIFY_VERSION="0.9.42"
if command -v graphify >/dev/null 2>&1; then
  have="$(graphify --version 2>/dev/null | tr -d '\r' | awk '{print $NF}')"
  if [ -d "${USER_SKILLS}/graphify" ]; then
    ok "graphify" "${have:-unknown version} + user-scope SKILL.md"
  else
    # Binary alive, skill files gone. `graphify install` (NO --project) rewrites
    # just the user-scope skill; it does not touch this repo.
    if graphify install >/dev/null 2>&1 && [ -d "${USER_SKILLS}/graphify" ]; then
      fixed "graphify" "re-ran 'graphify install' (user scope)"
    else
      fail "graphify" "binary present but 'graphify install' did not restore the skill"
    fi
  fi
elif command -v uv >/dev/null 2>&1; then
  if uv tool install "graphifyy==${GRAPHIFY_VERSION}" >/dev/null 2>&1 \
     && command -v graphify >/dev/null 2>&1 \
     && graphify install >/dev/null 2>&1; then
    fixed "graphify" "uv tool install graphifyy==${GRAPHIFY_VERSION} + graphify install"
  else
    fail "graphify" "uv tool install graphifyy==${GRAPHIFY_VERSION} failed"
  fi
else
  # No `uv` is an environment problem, not a toolchain-restore problem. Say so
  # and move on rather than trying to bootstrap a package manager unasked.
  warn "graphify" "uv not on PATH — install uv, then re-run this script"
fi

# --- claude-obsidian v2.1.0 -------------------------------------------------
# 15 skills that are SYMLINKS into a cloned product repo at
# /root/claude-obsidian. They call $PRODUCT_ROOT/scripts/*.py, so the clone has
# to stay where it is; vendoring the skill markdown alone would give 15 skills
# whose every action fails on a missing script.
#
# Honest limit: this restores the DEFAULT branch of the upstream repo, not a
# pinned commit. The receipt records 1c1bc49 but the on-disk copy has no .git
# directory, so this script cannot verify that the working copy matches that
# SHA — see the claude-obsidian caveat in skills.md.
OBSIDIAN_ROOT="/root/claude-obsidian"
OBSIDIAN_REPO="https://github.com/AgriciDaniel/claude-obsidian"
OBSIDIAN_SKILLS=(autoresearch canvas defuddle obsidian-bases obsidian-markdown save think
                 wiki wiki-cli wiki-fold wiki-ingest wiki-lint wiki-mode wiki-query wiki-retrieve)

obsidian_link() {
  # Relink only what is missing or broken. An existing, resolving symlink is
  # left untouched so a hand-repointed link survives this script.
  local made=0 s
  for s in "${OBSIDIAN_SKILLS[@]}"; do
    if [ ! -e "${USER_SKILLS}/${s}" ]; then
      rm -f "${USER_SKILLS}/${s}"
      ln -s "${OBSIDIAN_ROOT}/skills/${s}/" "${USER_SKILLS}/${s}" && made=$((made + 1))
    fi
  done
  echo "$made"
}

if [ -d "${OBSIDIAN_ROOT}/scripts" ]; then
  mkdir -p "$USER_SKILLS"
  made="$(obsidian_link)"
  if [ "$made" -gt 0 ]; then
    fixed "claude-obsidian" "relinked ${made} of ${#OBSIDIAN_SKILLS[@]} skills"
  else
    ok "claude-obsidian" "${#OBSIDIAN_SKILLS[@]} symlinks into ${OBSIDIAN_ROOT}"
  fi
elif command -v git >/dev/null 2>&1; then
  if git clone --depth 1 "$OBSIDIAN_REPO" "$OBSIDIAN_ROOT" >/dev/null 2>&1 \
     && [ -d "${OBSIDIAN_ROOT}/scripts" ]; then
    mkdir -p "$USER_SKILLS"
    made="$(obsidian_link)"
    fixed "claude-obsidian" "cloned ${OBSIDIAN_REPO}, linked ${made} skills (default branch, NOT pinned)"
  else
    fail "claude-obsidian" "clone of ${OBSIDIAN_REPO} failed — network or auth"
  fi
else
  warn "claude-obsidian" "git not on PATH"
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "${FAILURES} entr$( [ "$FAILURES" -eq 1 ] && echo y || echo ies ) could not be restored. See skills.md."
  exit 1
fi
echo "Toolchain complete. Canonical record: skills.md"
