# MacroTrack rebuild into THE Hybrid System — full scope

**Date:** 2026-08-07
**Status:** Scope approved direction ("rebuild"), awaiting review of this document
**Decision:** Full rebuild of MacroTrack inside this repository as a third
world of the merged app — NOT the data-bridge alternative (offered, declined).

## Source of truth being rebuilt

`reflectprotect123-max/thehybridsystem`, branch `main` at `079b356` (the
retired repo, explicitly re-opened for this audit on 2026-08-07). What's
there: a native Kotlin/Jetpack Compose Android app — 90 Kotlin files
(~9.4k lines), 11 screens (2,248 screen-lines), 13 repositories, CameraX +
ML Kit barcode scanning and nutrition-label OCR, its own Supabase schema
(5 migrations, 593 lines, 12+ tables), a 328-line Python adaptive engine
with a 79-line Kotlin contract doc, an Australian food-database seed
pipeline (OFF + AUSNUT, 471/5,000 foods seeded), 24 test files, green CI.

Nothing merges mechanically: the UI is the wrong framework (Compose), the
data model is the wrong shape (relational vs engine-blob). This is a rebuild
with a working reference, and the reference is good.

## Contract changes this REQUIRES (decide before code)

1. **`CLAUDE.md`'s nutrition boundary is amended, not deleted.** Today:
   *"Nutrition is intentionally outside this repository's prescription
   logic."* Becomes: nutrition prescription lives in `@hybrid/nutrition-engine`
   and NOWHERE else; Coordinator arbitrates training, never macros; pain and
   illness gates outrank any nutrition-derived suggestion; whole-athlete-state
   may consume nutrition *facts* (energy availability, adherence) as context
   only. The spirit — one owner per decision domain — survives; the wall moves.
2. **Ecosystem contract gains a `nutrition` domain.** New SQL migration
   (staging first, per the storage rules), new partition in the sync
   namespace, `product-scope` learns the domain. The relational tables
   (foods, recipes, log entries) do NOT go into the engine blob — see
   architecture.

## Architecture decisions (locked unless you object)

- **Nutrition is a third WORLD in the merged app**, alongside Strength and
  Conditioning: same discipline-switch mechanism (the `ProductId` union grows
  `'nutrition'`), its own accent in `@hybrid/design`, its own tab layout.
  The web dashboard gains a nutrition surface showing all three.
- **Two-tier data model, mirroring what MacroTrack got right:**
  - *Reference data server-side, relational:* the food catalogue, servings,
    barcodes stay in Postgres tables (ported migrations) — a 5,000-food
    catalogue does not belong in a synced JSON blob.
  - *Athlete data in the engine:* daily log entries, weight entries, macro
    program state, check-ins live in a new `NutritionDB` slice synced as the
    `nutrition` ecosystem partition — NOT inside `EngineDB`'s
    workouts/sessions, so training sync and nutrition sync cannot corrupt
    each other. One writer: `hybrid:mobile` / `hybrid:web` (web logs food too).
- **The adaptive engine ports from the Python reference** (`adaptive_engine.py`
  is deliberately deterministic/configurable/explainable — port it
  function-for-function to TypeScript with the same fixtures), not from
  guesses about MacroFactor. Its rule set keeps MacroTrack's own CLAUDE.md
  constraints: explainable, versioned, never a black box.
- **Cameras:** `react-native-vision-camera` + ML Kit frame processors for
  barcode; label OCR via ML Kit text recognition. This is the one area where
  the RN ecosystem is genuinely weaker than CameraX — it gets a dedicated
  spike task with a kill criterion (if OCR quality can't match, label
  scanning ships later than the rest, not never).

## Phases (each = own spec → plan → build → review cycle, like the merge)

### Phase 0 — Contracts & foundation (~1 wk)
CLAUDE.md amendment; `nutrition` domain in the ecosystem migration +
`product-scope` + namespace builders (staging rehearsal per storage rules);
`@hybrid/nutrition-core` package: ported data model types
(Food/Serving/LogEntry/Weight/MacroProgram/CheckIn), sanitizers, zod-style
validation; `NutritionDB` slice + storage + sync partition wiring, test-first
against the C1/C2 lessons. **Gate:** ecosystem checks + staging migration
rehearsal green.

### Phase 1 — Engine port (~1 wk)
`@hybrid/nutrition-engine`: weight trend (EWMA), expenditure estimation,
coverage rules, adaptive target adjustment — ported from `adaptive_engine.py`
with its Python test expectations converted to Vitest fixtures so the two
implementations provably agree. Config surface identical to `EngineConfig`.
**Gate:** fixture parity with the Python reference on every function.

### Phase 2 — Food catalogue backend (~0.5–1 wk)
Port migrations 001–005 into this repo's `supabase/migrations` (renamed,
staged); port the OFF/AUSNUT import pipeline scripts; decide seeding target
(the 471 already-seeded rows carry over if the same Supabase project, else
re-run). RLS parity with the owner-reference policies MacroTrack already has.
**Gate:** catalogue queryable from staging with RLS proven.

### Phase 3 — Mobile UI, the long pole (~2.5–3 wk)
Eleven screens rebuilt in RN/NativeWind inside the nutrition world, in
dependency order: Daily Log → Food Search → Quick Add → Custom Food →
Recipe Builder → Weight → Check-in → Macro Program (Coach) → Barcode
scanner → Label scanner (the spike) → world wiring (tabs, theme accent,
switch row grows a third destination). Reuses the app's existing primitives
(`Tap`, cards, tokens) — MacroTrack's *behavior* is the reference, this
repo's *design system* is the look.

### Phase 4 — Web + coach surfaces (~1 wk)
Dashboard nutrition card (today's macros, adherence, weight trend) and a
food-log screen on web; coach bench nutrition panel; whole-athlete-state
consumes energy-availability/adherence facts as constraints-context (context,
never a workout prescription — Coordinator untouched).

### Phase 5 — Hardening & release (~1 wk)
Full check-suite extension (contrast for the third accent, smoke flows for
logging food, sync E2E extended to three domains), real-device gate
(barcode + OCR on your phone, both cameras), EAS build, OTA, handoff
checkpoint.

## Total: 7–8 weeks of build time

Sequential lower bound ~6.5 wk; realistic with review cycles and the OCR
spike risk: **7–8 wk**, deliverable in ~5 independent shippable slices (the
app works after every phase; nutrition world simply grows).

## Risks, ranked

1. **Camera/OCR parity** (Phase 3 spike) — RN's ML story vs CameraX. Kill
   criterion defined above; barcode is low-risk, label OCR is the gamble.
2. **Sync blast radius** — a third domain touches the code the C1/C2 bugs
   lived in. Mitigation: `NutritionDB` is a separate slice, so training sync
   paths are structurally untouched; every 5 Aug test re-runs regardless.
3. **Migration collision** — MacroTrack's tables land in the same Supabase
   project as `app_state` + ecosystem tables. Staging rehearsal is mandatory,
   rollback plan written before apply (repo rule).
4. **Scope creep via MacroFactor-envy** — the reference app's own CLAUDE.md
   warns about this; each phase ships only what MacroTrack already had.
5. **Two sources of truth during the build** — freeze MacroTrack (no new
   features there) once Phase 0 starts, or ported fixtures chase a moving
   target.

## Explicitly out of scope

- Micronutrient UI beyond what MacroTrack shipped; retailer scraping
  (declined in its own handoff); iOS; the coaching-platform brainstorm
  (separate, next); the athlete-dashboard cockpit redesign (parked, designed,
  in the 7 Aug conversation record).
