# Hybrid Training — Deep Architecture, UX & Product Audit
_Brutally honest senior-engineer review. Beta stage._

## 0. TL;DR

You are polishing a **mostly good product on top of a fragile data model**. The core flow (Library → Template → Schedule → Start → Train → Log → Finish → Summary → Analytics) **works end-to-end** and the load math layer (`src/lib/load-math.ts`) is genuinely clean. But three structural problems will hurt you within ~2 months of real users:

1. **Two parallel template/block systems** (`workout_template_exercises` flat + `workout_template_blocks` block-based) still coexist, with auto-seeding fallbacks in `workout.$id.tsx`. This is the single biggest source of latent bugs.
2. **`BlockEditor.tsx` is 1,134 lines** and owns: editing, conditioning designer wiring, exercise picker, last-logged hints, 1RM, prescription, timing modes, copy/paste. This is the next module to break.
3. **Conditioning has 3 overlapping UIs** (`ConditioningDesigner`, `Z2TrainCard`, `IntervalTrainCard`, plus `SimpleConditioningCard`). You correctly hid the advanced ones for beta, but the *database columns and dead code paths remain* — a real maintenance tax.

Verdict: **the product is becoming coherent, but the architecture is not yet.** Ship beta on what exists, then do a focused refactor (not a rewrite) in Cursor.

---

## 1. What is genuinely good — do NOT touch

| Area | File | Why it's good |
|---|---|---|
| Load math | `src/lib/load-math.ts` (199 LOC) | Pure functions, no side effects, explicit confidence labels, EWMA done right. **This is the strongest file in the repo.** Treat it as canonical. |
| Server function pattern | `src/integrations/supabase/*` | Follows TanStack Start conventions cleanly. |
| Queries layer | `src/lib/queries.ts` | Small, focused, react-query keys are consistent. |
| Rest timer | `RestTimer.tsx` / `RestTimerSheet.tsx` | Self-contained, context-based, settings persist via localStorage. Solid. |
| Baseline gating | recent `index.tsx` + `dashboard.tsx` changes | Smart product call. Keep. |
| RLS policies | All tables scoped by `auth.uid()` | Correct and consistent. |
| Strength logging UX | `FastSetLogger.tsx` (145 LOC) | Tight, focused, low surface area. |

**Rule:** Do not refactor load math, queries, RestTimer, or FastSetLogger to "improve" them. They are done.

---

## 2. CRITICAL findings

### C1. Dual template schema — the #1 architectural risk
- `workout_template_exercises` (flat, legacy) **and** `workout_template_blocks` + `workout_template_block_exercises` (current) both exist in the DB and both have RLS.
- `workout.$id.tsx` lines ~70–145 contains an explicit "Legacy fallback" branch that auto-seeds a single Strength block when only flat exercises exist.
- Risk: every future template feature must be implemented twice or silently break old templates. Builder writes blocks; loaders read both.
- **Fix path:** one-time migration converting all `workout_template_exercises` rows into a single default block, then drop the table. Do this in Cursor — it's a destructive migration.

### C2. `BlockEditor.tsx` (1,134 LOC) is unmaintainable
- Owns 8+ responsibilities (block CRUD, exercise picker, conditioning designer entry, prescriptions, timing modes, last-logged, 1RM, copy).
- Any change risks regression in unrelated blocks.
- This is your "next thing that breaks." Do **not** keep iterating in Lovable here — Lovable will keep adding to it.
- **Fix path (Cursor):** split into `BlockList`, `BlockCard`, `BlockPrescriptionForm`, `ExercisePickerSheet`, `BlockTimingEditor`. No behavior change, structural only.

### C3. Conditioning has 4 layers of dead/overlapping code
- `ConditioningDesigner.tsx` (524 LOC) — builder side, advanced.
- `Z2TrainCard.tsx` (449 LOC) and `IntervalTrainCard.tsx` (564 LOC) — train side, advanced. **Currently bypassed** by `SimpleConditioningCard` in `TrainMode.tsx`.
- `SimpleConditioningCard.tsx` (299 LOC) — the only one users actually hit.
- The DB still has: `prescription_type`, `conditioning_type`, `target_metrics`, `check_in_frequency`, `intensity_tier`, `training_style`, `modality`, `conditioning_category`, `snapshots`, `result_fields`, `planned_load` on both `workout_blocks` and `workout_template_blocks` and `conditioning_sessions`.
- **Risk:** Builder still writes these columns (via `ConditioningDesigner` in template flow). They never round-trip to the user. Silent data drift.
- **Decision needed:** either commit to "Simple" (delete the advanced cards + dead columns post-beta) or commit to "Advanced" (re-enable and own the complexity). **Do not stay in the middle.**

### C4. Source-of-truth confusion on conditioning load
- `dashboard.tsx`, `index.tsx`, and `workout.$id.tsx` all repeat the **same** "stored ?? trimp ?? calc" coalescing pattern (lines 84–97, 119–129, 149–159, 38–57 respectively).
- 4 copies of the same logic = 4 places to fix a bug.
- **Fix:** extract `loadFromConditioningRow(c, profile)` into `src/lib/load-math.ts`. Pure, low risk, do this in Lovable now.

### C5. `useWorkouts(200)` / `useWorkouts(500)` fetches all sets and templates eagerly
- `useWorkouts` joins `workout_sets(*, exercises(name, category))` for every workout — 200 rows × N sets per workout.
- At 100 active users with 6 months of data this becomes the slowest query in the app and will hit the 1000-row default limit.
- **Fix path:** dashboard/index should pull a **server-side aggregate** (server function returning daily totals), not the raw join. Defer until you have >50 users, but it WILL bite.

---

## 3. HIGH findings

### H1. `index.tsx` (461 LOC) is doing too much
Three large `useMemo` blocks (analysis, todayLoad, thisWeek, baseline) each iterate over the same workouts/conditioning arrays. With 200 rows that's fine; it is a re-render risk if templates list grows. Extract into a single `useTrainingTotals(workouts, conditioning, profile)` hook.

### H2. `TrainMode.tsx` (738 LOC) still mixes block rendering + set logging + timer + summary
Less critical than BlockEditor because the abstractions are tighter, but the same fate awaits. After C2 is done, split this similarly.

### H3. No foreign keys on most tables
Schema shows "No foreign keys" on `workout_blocks`, `workout_sets`, `workout_template_blocks`, etc. RLS protects access but not referential integrity. Orphan rows are possible (and will happen on partial deletes). Add `ON DELETE CASCADE` FKs:
- `workout_blocks.workout_id → workouts.id`
- `workout_block_exercises.block_id → workout_blocks.id`
- `workout_sets.workout_id → workouts.id`
- `workout_template_blocks.template_id → workout_templates.id`
- `workout_template_block_exercises.block_id → workout_template_blocks.id`
- `conditioning_sessions.workout_id → workouts.id (ON DELETE SET NULL)`

### H4. Missing indexes
- `workouts(owner_id, started_at DESC)` — used on every Home/Dashboard load.
- `conditioning_sessions(owner_id, performed_at DESC)`
- `workout_sets(workout_id)`
- `workout_blocks(workout_id, position)`
- `readiness_logs(owner_id, date)`
Without these, every list query does a sequential scan. Cheap to add now.

### H5. `conditioning_sessions` has **two load columns** (`trimp` and `conditioning_load`) plus `hr_trimp` and `srpe_load`
This is the same C1 problem in miniature. UI reads `conditioning_load ?? trimp`. Pick one (`conditioning_load`), backfill, deprecate the rest. **Do not delete yet** — backfill first.

### H6. `workout.$id.tsx` does optimistic refetches via `refetch()` everywhere
After every mutation, full refetch of the joined workout. Fine for now, but every set log re-pulls the entire workout tree. Not scalable beyond ~30 sets per session.

### H7. No error boundaries on routes
`tanstack-errors-notfound` rules require `errorComponent` + `notFoundComponent` on every route with a loader. None of the `_authenticated` routes set them. Any thrown error in a query handler currently breaks the whole route subtree silently.

---

## 4. MEDIUM findings

- **M1.** `useEffect` in `workout.$id.tsx` (the seed-from-template effect) can race if a user navigates away mid-seed. Add an `aborted` flag.
- **M2.** `confirm()` used for destructive actions (abandon, finish, cancel). Inconsistent with the rest of the app which uses shadcn Dialog/AlertDialog. Use `AlertDialog`.
- **M3.** `as any` is everywhere (60+ in `index.tsx` alone) because `useQuery` types aren't propagated. Generate one typed accessor per query in `queries.ts`.
- **M4.** `library.tsx` (725 LOC) carries 5 tabs but only Sessions is wired (Programs/Teams/Exercises/Circuits are placeholders). Either ship them or hide the tabs in beta.
- **M5.** `calendar.tsx` (277 LOC) duplicates "completed vs scheduled" filtering already done elsewhere.
- **M6.** Two timer abstractions: `BlockTimer` and `RestTimer`. They don't conflict but they share zero code. Acceptable for now; revisit if a third timer appears.
- **M7.** `conditioning-defaults.ts` (338 LOC) is essentially configuration for the *hidden* advanced builder. Most of it is dead until C3 is decided.
- **M8.** `nutrition.tsx` (30 LOC) and `log.tsx` (5 LOC) are placeholder routes — hide from nav or finish.
- **M9.** PWA: `public/sw.js` + `public/manifest.json` exist but no version bump strategy — cached old JS will break users after a deploy.

---

## 5. LOW findings

- L1. Inconsistent uppercasing / italic styling between Library header and Dashboard.
- L2. `KIND_ICON` / `KIND_LABEL` / `KIND_META` defined separately in `TrainMode` and `BlockEditor` — same data, two declarations.
- L3. `as any` on `(c as any).session_rpe` everywhere — column exists on the table, regenerate types.
- L4. Some `lucide-react` icons imported but unused.
- L5. `wrangler.jsonc` + `server.ts` indicate Cloudflare deploy — fine, just be aware of the Worker runtime limits (see `<server-runtime>`).

---

## 6. The honest answers to your meta questions

**Is the app becoming coherent?**
The UX is. The architecture is **not yet** — two template systems, two load columns, three conditioning UIs, one giant editor. Coherence is one focused refactor away.

**Polishing a good product or bad architecture?**
Good product, **mediocre-to-fragile architecture**. The load math, RLS, query layer are good. The block/conditioning/template layer is not.

**Biggest future danger?**
The dual template schema (C1) combined with `BlockEditor` (C2). When you add a feature like "supersets" or "program weeks", you will be forced to touch both, in a 1,134-line file, with no FK guarantees. That is the moment a regression ships to paying users.

**Smartest next phase?**
1. Ship beta on the simplified conditioning + baseline gating you already have.
2. In Cursor: collapse template schema, split BlockEditor, add FKs + indexes, extract conditioning load helper.
3. Then — and only then — make a product decision on simple vs advanced conditioning.

**When should you stop using Lovable?**
For *additive UI work* (new screens, polish, copy, small components): keep using Lovable. It's faster.
For *the three refactors above* (schema migration, BlockEditor split, FK + index migration): **move to Cursor now**. Lovable will keep stacking on top of the existing files rather than restructuring them.

**What would break first at scale?**
The `useWorkouts(500)` + nested join on the dashboard. At ~100 active users with 6 months of history, you'll hit the Supabase 1000-row default and the dashboard will silently truncate.

**What feels genuinely strong?**
Load math, the Train Mode UX (now that conditioning is simplified), the Home baseline gating, RLS hygiene, the Finish summary dialog.

---

## 7. Disposition table

| Item | Action |
|---|---|
| `load-math.ts` | **Keep as-is.** |
| `queries.ts` | Keep, add typed wrappers later. |
| `RestTimer*` | Keep as-is. |
| `FastSetLogger` | Keep as-is. |
| `SimpleConditioningCard` | Keep. |
| `Z2TrainCard`, `IntervalTrainCard` | **Hide now, delete after beta** (already hidden). |
| `ConditioningDesigner` | **Hide in builder** for beta, decide later. |
| `BlockEditor` | **Rebuild in Cursor** — split, no behavior change. |
| `workout_template_exercises` table | **Migrate then delete** in Cursor. |
| `conditioning_sessions.trimp` column | **Backfill into `conditioning_load`, then drop.** |
| `nutrition.tsx`, `log.tsx` | Hide from nav until built. |
| `library.tsx` placeholder tabs | Hide Teams/Circuits/Programs until built. |
| Conditioning load coalesce logic | **Extract to load-math helper now (Lovable, safe).** |
| FKs + indexes | **Add via migration now (Lovable, safe).** |
| Error boundaries | Add per route in Lovable. |

---

## 8. TOP 10 highest-ROI fixes (ordered)

1. **Extract `loadFromConditioningRow()` helper** into `load-math.ts` and replace the 4 duplicates. _Impact: high · Risk: near zero · Effort: 30 min._
2. **Add DB indexes** on `(owner_id, started_at)`, `(owner_id, performed_at)`, `workout_sets(workout_id)`. _Impact: high (speed) · Risk: zero · Effort: 1 migration._
3. **Add FKs with ON DELETE CASCADE** to block/set/template tables. _Impact: high (data integrity) · Risk: low (no data should be orphaned yet) · Effort: 1 migration._
4. **Hide placeholder nav items** (Nutrition, Log, Teams, Circuits, Programs) for beta. _Impact: medium UX · Risk: zero · Effort: 15 min._
5. **Add `errorComponent` + `notFoundComponent`** to authenticated routes. _Impact: stability · Risk: zero · Effort: 1 hr._
6. **Backfill `conditioning_load` from `trimp`** in one migration; UI already prefers `conditioning_load`. _Impact: medium · Risk: low · Effort: 1 migration._
7. **Replace `confirm()` with `AlertDialog`** for abandon/finish/cancel. _Impact: UX polish · Risk: zero · Effort: 1 hr._
8. **Split BlockEditor.tsx** (move to Cursor). _Impact: huge maintainability · Risk: medium (touches builder) · Effort: ~1 day._
9. **Collapse template schema** to block-only (move to Cursor). _Impact: removes C1 entirely · Risk: medium (destructive) · Effort: ~half day._
10. **Server-side aggregate function for dashboard load** (`createServerFn` returning daily totals). _Impact: scaling · Risk: low · Effort: half day._

**Do #1–#7 in Lovable. Do #8–#10 in Cursor.**

---

## 9. What should stay exactly as-is
`src/lib/load-math.ts`, `src/lib/queries.ts`, `src/components/RestTimer.tsx`, `src/components/RestTimerSheet.tsx`, `src/components/workout/FastSetLogger.tsx`, `src/components/train/conditioning/SimpleConditioningCard.tsx`, RLS policies on every table, the baseline-gating logic on Home and Dashboard.

---

_End of audit._
