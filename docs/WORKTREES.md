# Phase worktrees

Use one worktree per phase so Strength, Conditioning, sync and release work do
not accidentally share an unreviewed working directory.

```bash
git fetch origin
git worktree add ../hybrid-shared-core -b phase/shared-core origin/main
git worktree add ../hybrid-state -b phase/whole-athlete-state origin/main
git worktree add ../hybrid-coordinator -b phase/coordinator origin/main
git worktree add ../hybrid-conditioning-canary -b phase/conditioning-canary origin/main
```

Before opening a worktree, inspect the main checkout with `git status --short`.
Existing user changes belong to the user; do not reset, clean or overwrite
them. Each phase should finish with a focused commit, the full typecheck/test
suite, and a written migration or rollback note when it changes data.

Remove a worktree only after its branch is merged or intentionally abandoned:

```bash
git worktree list
git worktree remove ../hybrid-shared-core
```
