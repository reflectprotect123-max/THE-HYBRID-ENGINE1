# Set timer — design

## Problem

`seconds`-mode exercises (cooldown/warm-up holds like "30 sec Side Plank", "20-30s/side Pec Stretch") render as a bare numeric input today — the athlete types how many seconds they held, after the fact. No live countdown exists for these. Conditioning-modality items (walk, jog, bike) already get a full live-clock treatment via the `Conditioning` screen's phase clock and BPM zone bar — that's out of scope here and needs no change.

## Scope

**In scope:** a live countdown timer for `seconds`-mode sets inside Strength blocks (warm-up and cooldown holds/stretches), in both `apps/web/src/screens/Logger.tsx` and `apps/mobile/src/screens/Logger.tsx`.

**Out of scope:**
- Conditioning-block timing (already solved — phase clock + BPM, untouched).
- Heart rate on this timer (decided: no zone target on a static hold, adds a Bluetooth-connect step for no payoff — skip).
- Any new per-side data model (decided: "X sec/side" is authored as two consecutive sets in the block, labeled via the existing `note`/name text, matching how the reference program itself represents it — no `PlannedSet`/`LoggedSet`/`Exercise` schema change).
- `reps_seconds` mode (e.g. tempo work counting both reps and seconds) — different shape, not touched by this plan.

## Design

### Timer engine — `useSetTimer`, mirrors `useRest` exactly

New hook/context, structurally identical to `apps/web/src/store/rest.tsx` (`RestProvider`/`useRest`) and its mobile mirror — same reasons apply: an end-timestamp survives backgrounding/reload where a decrementing counter doesn't, and the existing pattern is proven in production.

Kept **separate** from `useRest` rather than reused, because they're different concerns that can be live at once (an athlete could in principle skip rest and go straight into a held stretch, or want rest after a hold) and have different completion behavior (rest expiring does nothing but buzz; the set timer expiring should offer to mark the set done).

- New localStorage keys: `${LS_KEY}-set-timer-ends`, `${LS_KEY}-set-timer-total`.
- Same shape: `{ left, total, running, frac, start(sec), stop() }`. No `add()` — unlike rest, there's no "add 15 seconds" affordance for a hold.
- 250ms tick, `Date.now()`-diffed, vibrate-on-zero, clamped duration — copy `rest.tsx`'s existing logic wholesale.

### UI — attaches to the existing `seconds`-mode `PlainField` slot

Current location: `Logger.tsx` (web) lines ~370-376, the final `else` branch of the lift/`reps_seconds`/else chain, a bare `PlainField label={ex.mode === 'seconds' ? 'Secs' : 'Reps'}`. Mobile mirrors this at ~444.

For `ex.mode === 'seconds'` specifically (the `reps` branch of that same else keeps its current bare field — untouched):

- Replace the bare input with a small timer control: shows the target (`fmtRest(st.t)`), a Start/Stop toggle, and while running a live `fmtRest(left)` readout (reusing the existing `fmtRest` from `@hybrid/engine`, same formatter `RestChip` already uses).
- Tapping Start begins the countdown from the set's own `t` value (the authored target, same value the athlete would otherwise have typed against).
- At zero: vibrate (same as rest), and write the actual held seconds into `v1` via the existing `writeVal(1, ...)` path — same field the athlete's own typing uses today, no new write path, matching the precedent set by Phase 2's Apply button.
- Athlete can stop early (e.g. held less than target) — stopping writes elapsed seconds into `v1` the same way, then the athlete can still hand-edit before Finish Set, since it's the same plain field underneath, just pre-filled.
- No Apply/opt-in gate needed here (unlike Phase 2's strength suggestion) — this isn't a recommendation, it's just timing the thing the athlete is already about to do. Starting the timer is itself the opt-in; an athlete who'd rather hand-type can just ignore Start and type as they do today.

### Scope of "running" — global, like rest

Mirrors `useRest`'s own model exactly: one timer, session-wide, not tied to a specific set index. If the athlete starts a hold and navigates away before it finishes, the timer keeps running in the background (same as rest does today) and shows wherever a `seconds`-mode field is next on screen — it does not silently attach its result to a different exercise, because starting it only arms the countdown; the zero-write targets whichever `seconds`-mode set is mounted when it completes or is stopped. Two holds can never run concurrently, matching the single-set-at-a-time logging flow.

### Existing test compatibility

The current bare `PlainField` for `seconds` mode is targeted by existing smoke/RNTL assertions (aria-label, input value). The implementer must locate and update these rather than let them silently break — the field must stay a real, directly-editable input at all times (timer pre-fills it, never replaces or hides it), so hand-typing without ever touching Start keeps working exactly as it does today.

### Per-side authoring

Confirmed via the reference program screenshots: "30 sec (per side)" is authored there as two separate rows (L / R), each with its own dial and Start button — not one row with a doubled duration. Same shape fits this app with zero schema change: author two consecutive sets in the block, exercise name or `note` carrying the "L"/"R" label. The timer control above just runs twice, once per set, exactly as designed — no special-casing needed.

## Files touched (expected, confirmed at plan-writing time)

- New: `apps/web/src/store/setTimer.tsx` (mirrors `rest.tsx`)
- New: `apps/mobile/src/store/setTimer.tsx` (mirrors mobile's `rest.tsx`)
- Modify: `apps/web/src/screens/Logger.tsx` (seconds-mode branch)
- Modify: `apps/mobile/src/screens/Logger.tsx` (seconds-mode branch)
- Modify: wherever `RestProvider`/mobile equivalent is mounted (App root) — mount the new provider alongside it.
- Test: `checks/react-smoke.mjs` (web), RNTL test (mobile) — new scenario per app.

## Sequencing note

This branches off `main` after Phase 2 (`phase2-strength-progression`) merges — Phase 2 Task 4 already modified the lift-mode branch of the same `Logger.tsx` files; starting this worktree post-merge avoids a needless merge conflict in a file both plans touch. Phase 2 is still finishing (Task 4's fix loop, Task 5, Task 6, final review) in the background; this plan is queued behind it.
