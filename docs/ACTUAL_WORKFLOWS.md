# Actual workflows

Written 8 August 2026 against `main` @ `a8ff104`. Behaviour as implemented.

Format per workflow: entry → steps → state/persistence → failure → gaps →
safety → tests.

---

## 1. First launch

**Entry**: app open, no stored slice. **Steps**: local slice initialises empty;
no onboarding wall — the athlete lands on Home. **Persistence**: an empty
`EngineDB` under `hybrid-engine-v1`. **Failure**: if the stored slice cannot be
parsed it is reset and `dataRecovered` is surfaced in-app.
**Gap**: no guided first-run. **Safety**: none. **Tests**: empty-state rendering
covered by mobile `screens.test.tsx`.

## 2. Account creation and sign-in

**Entry**: Settings. **Steps**: Supabase email/password. **Persistence**: web
`localStorage`; mobile MMKV via an explicit storage port, so a sign-in survives
a cold start — without it gotrue silently falls back to memory.
**Failure**: errors are humanised (`humanizeError`). **Gap**: no password
reset, email verification or account deletion flow inspected in the UI.
**Safety**: sign-in is not required to train — the app is fully usable offline
and unauthenticated. **Tests**: no sign-in flow test.

## 3. Profile setup

**Entry**: Settings. **Steps**: display name, age, units, timezone; goals and
weekly schedule. **Persistence**: `SharedCoreState.profile` / `.goals` /
`.schedule`, each with its own `updatedAt` so merges resolve independently.

## 4. Creating a session / adding blocks and prescriptions

**Entry**: Library → Planner, or GuidedBuilder (`/build/:id`).
**Steps**: blocks → exercises → sets, with supersets, warm-up blocks and text
blocks; prescriptions carry set type, target reps and RPE.
**Persistence**: `Workout` in the local slice. **Validation**: reps must be > 0
to count as a set anywhere downstream. **Tests**: `guidedBuilder.test.tsx`,
engine suites for superset/warmup/textblock.

## 5. Saving and scheduling a session

Scheduling is **guidance, not a gate** — an unscheduled session can be started
at any time (workflow 6). The Coordinator's weekly plan is a proposal set the
athlete may ignore.

## 6. Beginning an unscheduled session

**Entry**: Home / Training → start. **State**: a `Session` is created with
`kind` set from the active world. **Safety-relevant**: a live session in another
world is routed to `foreignActiveSession` and surfaced by `ForeignSessionNotice`
in **every** world — including Nutrition, fixed 7 August. Without it a session
started then abandoned mid-world was silently expired by
`expireStaleSessions` after the date rolled over.

## 7. Daily check-in

**Entry**: Settings check-in. **Steps**: sleep hours/quality, energy, soreness,
stress, physical load, available time, **pain areas** and **illness status**.
**Persistence**: `recovery` observations + `safety.painHold` / `safety.illness`
in shared core, each with its own timestamp.
**Safety**: pain and illness are flags, not penalties — they cause the
Coordinator to DROP sessions (`dropped_pain_safety`,
`dropped_illness_safety`), not to scale them.
**Tests**: covered in coordinator and state suites, plus a merge regression
suite added 7 August proving an unrelated write on another device cannot erase
a pain hold.

## 8. Pain, illness or uncertainty reporting

As above. **Missing data stays unknown** — `band(null)` is `'unknown'`, never
"clear". **Gap**: there is no explicit "stop" or "request human review" action;
the strongest available signal is a pain hold. Under the provisional
constraints, a stop request has no home. Unresolved.

## 9. Readiness calculation

`deriveAthleteState` composes WHOOP and manual signals, each tagged with
`source`, into a readiness band (`>= 70` / `>= 45`). See
`docs/COORDINATOR_AND_EVIDENCE_AUDIT.md` rule 4 — the composite is where athlete
report and vendor score are averaged rather than ranked.

## 10. Training execution

**Entry**: Logger. **Steps**: per set, enter weight/reps, rate RPE, mark done.
**On completion of a set**: `computeSetAdjustment` prints a verdict AND
pre-fills the next set's weight (RISK R1).
**Persistence**: every set write goes through `update()` on the whole slice —
reads may scope by world, writes never filter.
**Failure**: a failed save surfaces `saveFailed`; the engine store retries once
after pruning conditioning traces before reporting.

## 11. Partial or adapted completion

A session may be completed with any subset of sets done. `liftAdapt` banks only
movements with a completed working set — skipping a lift, or logging only
warm-ups, earns nothing. **A missed session creates no make-up debt**; it raises
`staleness` on the proposal, which competes better next week within unchanged
caps.

## 12. Post-session feedback

`PostSessionFeedback.tsx` (web) records how the session went, feeding the
auto-coach ledger. **Web only.**

## 13. Viewing progress

Progress, History, Exercise and Recap screens. Recap lists what each movement
earned, derived from the same traversal that stores it, so the number shown
cannot disagree with the number stored.

## 14. Device connection

WHOOP samples and Concept2/FTMS parsing exist (`ftms.test.ts`,
`concept2-contract.mjs`). **Not audited end to end in this pass.**

## 15. Cloud synchronization

Pull → additive merge → push, with a fold against the current ref so a set
logged during the pull's await survives. Domain snapshots go through
revision-guarded RPCs; a refused write is now reported and the push is not
marked clean, so the next one retries.
**Tests**: mobile `sync-merged.test.tsx`; **no web SyncProvider test**.

## 16. Export and restore

Export/backup of the local slice from Settings. **Restore destructiveness was
not traced in this pass** — flagged in the risk register as a gap rather than
described.

## 17. Error and offline recovery

All reads are local, so the app works offline throughout. A corrupt slice is
reset with `dataRecovered` shown. A failed save shows `saveFailed`.
**`/coach` is the exception — it fails offline** (RISK R7).
**Gap**: no test exercises any offline path.
