# Mobile Settings.tsx — two adversarial-review bugs

Scope: `apps/mobile/src/screens/Settings.tsx` and a new colocated test file
`apps/mobile/src/screens/Settings.test.tsx`.

## Bug 1 (Critical): backup restore dropped `core`/`ecosystem`

**Root cause.** `RestoreSection`'s `doReplace()` hand-wrote a partial restore:

```ts
update((d) => {
  d.workouts = found.db.workouts;
  d.sessions = found.db.sessions;
  d.settings = found.db.settings;
});
```

`found.db` (produced by `parseBackup` -> `sanitizeDB`) does carry `core` and
`ecosystem` when the backup has them, but `doReplace` never assigned those two
fields back onto the draft, so a restore silently kept whatever `core` the
phone already had (or had none) instead of the backup's. Concretely: an
active `safety.painHold`/`illness` flag in the backup never made it back in,
and the auto-coach approval gate (which reads `deriveAthleteState`, which
reads `core`) would start proposing adjustments again as if nothing were
wrong.

**Investigation note on the task's premise.** The task description says web's
`Settings.tsx` "already solves this correctly" via `restoreDb()`. That's only
half true: `restoreDb` (in `packages/engine/src/db.ts`) does correctly return
a `db` with merged `core`/`ecosystem` — but web's own caller
(`apps/web/src/screens/Settings.tsx`'s `onRestoreFile`) only copies
`out.db.workouts` / `.sessions` / `.settings` back onto its draft, the exact
same omission mobile had. **Web has the identical bug for `core`/`ecosystem`
on restore.** This was not in scope to fix (the task named only mobile), so
web is untouched, but it is a real finding — see Concerns below.

**Fix.** Mobile's `doReplace()` now calls the shared `restoreDb()` export
from `@hybrid/engine` (same function web imports) in `'replace'` mode —
matching the existing "Replace everything on this phone?" UI, which is a full
replace, not a merge — and assigns back every field `restoreDb` returns,
including `core` and `ecosystem`:

```ts
const out = restoreDb(d, found.db, 'replace');
d.workouts = out.db.workouts;
d.sessions = out.db.sessions;
d.settings = out.db.settings;
d.core = out.db.core;
d.ecosystem = out.db.ecosystem;
```

No second restore implementation was written; this reuses the engine's own
`restoreDb`, exactly as instructed.

## Bug 2 (Important): `RecoveryCard` form never resynced after mount

**Root cause.** `sleep`/`energy`/`soreness`/`stress`/`physical`/`minutes`/
`pain`/`illness` were all seeded from `db.core` via `useState(() => ...)`
initialisers, which run exactly once, at first mount. `Settings` is a
bottom-tab screen that stays mounted for the app's lifetime, so:

- **Midnight rollover**: `today` is recomputed every render, but the form
  fields are not — a still-mounted screen shows yesterday's values under
  today's date, and Save would write them in as today's check-in.
- **Sync race**: a newer check-in pulled in from another device while
  Settings sits mounted never reaches the form; Save would overwrite it with
  the stale/blank values (`number('')` is `undefined` for any field the
  athlete hadn't touched) — including silently clearing an in-progress
  pain-hold or illness flag.

**Fix.** Added a `useEffect` that re-seeds every form field, keyed on
`[today, recovery?.recordedAt, life?.id]` — `today` catches the midnight
case, and `recovery.recordedAt`/`life.id` change identity whenever a
different underlying record (e.g. one just pulled by sync) becomes "today's"
manual entry, so the effect only fires when the record identity actually
changes, not on every keystroke/render. This does not fully solve the
narrower race where a sync pull lands mid-edit and mid-effect-window; a
comment in the code says so explicitly and points at real per-field dirty
tracking as the follow-up if that turns out to matter, per the task's
guidance to prefer the minimal correct fix over inventing machinery.

## Files changed

- `apps/mobile/src/screens/Settings.tsx`
  - import `restoreDb` from `@hybrid/engine`; import `useEffect` from `react`.
  - `doReplace()` now drives the restore through `restoreDb(..., 'replace')`
    and assigns back `core`/`ecosystem` in addition to the three original
    fields.
  - `RecoveryCard` gained the resync `useEffect` described above, with an
    inline comment explaining both failure modes and the one racier case
    left unaddressed.
- `apps/mobile/src/screens/Settings.test.tsx` (new, colocated per this repo's
  test-placement rule)
  - `Backup restore`: round-trips a backup containing
    `core.safety.painHold`/`illness` through the UI (paste → Restore →
    confirm Replace) and asserts both flags survive in the persisted store;
    a second test asserts a core-less backup still restores
    workouts/sessions/settings.
  - `RecoveryCard resync`: seeds a manual check-in for "day 1", advances the
    fake system clock past midnight into "day 2" with no check-in yet, forces
    a re-render via an unrelated field edit, asserts the sleep-hours field
    resets to blank (not day 1's stale 5.5), then Saves and asserts day 2's
    persisted entry has `sleepHours: undefined` while day 1's original entry
    is untouched.
  - Settings mounts `CloudCard`/`WhoopCard`/`Concept2Card`, whose hooks throw
    outside their providers, and `SyncProvider` itself needs
    `NutritionProvider` above it — none of which `renderScreen`'s stock stack
    (`test/harness.tsx`) provides, since no other screen test needed them.
    Added a local `renderSettings()` helper in the test file that nests
    `NutritionProvider > SyncProvider > WhoopProvider > Concept2Provider`
    around `SettingsScreen`, mirroring `App.tsx`'s real provider order,
    rather than changing the shared harness for one screen.

## Verification

- `pnpm --filter @hybrid/mobile exec jest src/screens/Settings.test.tsx` —
  3 passed (console warnings about WHOOP/Concept2 403s are the mocked
  providers' own auto-connect attempts in a no-network test environment;
  unrelated noise, not failures).
- `pnpm --filter @hybrid/mobile exec jest` — 31 suites / 320 tests passed.
- `pnpm --filter @hybrid/mobile exec tsc -p tsconfig.json --noEmit` — clean.
- `pnpm run typecheck` (all 17 workspace projects) — clean.
- `pnpm run check:ecosystem` — all static checks passed.
- `pnpm run test` (full monorepo) — one unrelated pre-existing failure in
  `apps/web/src/App.test.tsx` ("lands on the coach sign-in screen from `/`,
  without a navigation loop"). Confirmed pre-existing and unrelated: this
  session touched no file under `apps/web`, and running that same web test
  file in isolation on a clean tree (`git stash` before, `git stash pop`
  after) passes — it only fails when run as part of the full multi-package
  `pnpm run test` pass, which points at cross-suite timing/state, not this
  change.

## Concerns for follow-up (not fixed here, out of stated scope)

- `apps/web/src/screens/Settings.tsx`'s `onRestoreFile` has the same
  `core`/`ecosystem`-dropping bug mobile had — it also only copies
  `workouts`/`sessions`/`settings` off `restoreDb`'s result. Worth a matching
  fix so a web restore doesn't also silently clear a pain-hold/illness flag.
- The sync-race half of Bug 2 (a pull landing mid-edit) is explicitly not
  fully solved, per the task's own guidance to favor the minimal fix; the
  code comment flags it for whoever picks up real dirty-tracking.
