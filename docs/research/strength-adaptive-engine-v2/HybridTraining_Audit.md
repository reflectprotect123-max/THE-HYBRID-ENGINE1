# Hybrid Training System — Beta Architecture & UX Audit
_Date: 2026-05-12 · Scope: full app, brutally honest._

This is a beta-stage workout app on **TanStack Start + Supabase (Lovable Cloud) + React Query + shadcn/Radix + Tailwind v4**. Single-user RLS everywhere, file-based routing, no edge functions deployed for the core flow. Core flow is now intended to be: **Library → Template → Schedule → Start → Train Mode → Finish → Summary/Load**.

---

## 0. File-size reality check

Top offenders (LOC):

| File | Lines | Verdict |
|---|---:|---|
| `src/components/blocks/BlockEditor.tsx` | **1,134** | Dangerously large. Handles strength + conditioning + template + session in one file. |
| `src/components/train/TrainMode.tsx` | **762** | Too large; mixes block rendering, set logging, and conditioning routing. |
| `src/routes/_authenticated/library.tsx` | 725 | Borderline. Library + template management collapsed into a single route. |
| `src/components/blocks/conditioning/ConditioningDesigner.tsx` | 524 | Big, but cohesive. |
| `src/routes/_authenticated/index.tsx` | 395 | Home + load math composition; should be split. |
| `src/lib/conditioning-defaults.ts` | 338 | Heuristic mapping layer — see §3. |
| `src/routes/_authenticated/dashboard.tsx` | 278 | Overlaps with index. |
| `src/routes/_authenticated/calendar.tsx` | 277 | OK after Pass A. |

`useState` count: **43 in BlockEditor**, **6 in TrainMode** (plus a lot of derived memo state). That is the architectural smell.

---

## 1. What is GOOD ✅
- **TanStack Start file routing + RLS-only Supabase**: clean, type-safe, no auth foot-guns. `_authenticated/` boundary is correct.
- **`src/lib/load-math.ts`**: small, pure, well-named (`calculateStrengthVolume`, `calculateStrengthLoad`, `calculateHrTrimp`, `calculateSessionRpeLoad`, `calculateConditioningLoad`, `calculateTotalTrainingLoad`, `analyzeLoad` w/ EWMA + ACWR). This is the most maintainable file in the repo. Keep it.
- **`load_method` + `load_confidence` columns** on `conditioning_sessions`: honest data model — you can show *why* a number is what it is.
- **React Query usage**: queries are centralized in `src/lib/queries.ts` with sane keys.
- **Quick-start has been disabled** in favor of template-only Start flow during beta — correct call.
- **RLS policies** are uniform `owner_id = auth.uid()`, no role escalation surface.
- **Single Supabase client** import discipline (`@/integrations/supabase/client`).

## 2. What is DANGEROUS ⚠️
1. **`BlockEditor.tsx` is a god component (1134 LOC, 43 useState)**. Any conditioning/strength/template change risks regressions in the others. Highest blast-radius file.
2. **Two parallel template models still alive**:
   - `workout_template_exercises` (legacy flat)
   - `workout_template_blocks` + `workout_template_block_exercises` (new block-based)
   Auto-seed in `workout.$id.tsx` falls back to the flat shape. Both are queried in `useTemplates()`. Templates created via either path silently coexist — analytics/load math are not aware of which path produced data.
3. **`workouts.started_at` defaults to `now()` at insert** (DB default). You patched the timer, but any new code that reads `started_at` for a `scheduled` row will repeat the “1442 minutes” bug. The DB schema is the bug; the UI is just a guard.
4. **Three timer systems** with overlapping responsibilities: `WorkoutTimer`, `BlockTimer`, `RestTimer`/`RestTimerSheet`. No documented hierarchy of which owns the "now ticking" tick. Risk: drift, duplicate intervals, battery use on iOS PWA.
5. **`conditioning-defaults.ts` heuristic layer** (`deriveConditioningSessionType`) maps free-form `training_style`/`conditioning_category` strings to a constrained DB enum. Any new string from the UI silently falls through to `custom` or fails the CHECK. This is the most fragile path in conditioning logging.
6. **No unique constraint on `workouts(owner_id, scheduled_for, status='scheduled')`** — user can create N scheduled rows for the same date and templates. The Calendar Start picker doesn't check.
7. **`workout_block_exercises`, `workout_template_block_exercises`, `workout_blocks`, `workout_template_blocks`** have **no FKs declared**. RLS is fine, but cascading deletes are not — orphan blocks/exercises on template delete are likely.
8. **Auto-seed-from-template** runs as a side-effect inside a `useEffect` with `await` fan-out and no idempotency lock. Two fast renders or a quick refetch can double-seed blocks. Race condition exists today.
9. **Conditioning session insert is duplicated** in `Z2TrainCard` and `IntervalTrainCard` — both build their own payloads with no shared writer.

## 3. What is DUPLICATED 🔁
| Concept | Where |
|---|---|
| Block rendering | `BlockEditor` (edit) **and** `TrainMode` (train) — different shapes for same data |
| Template seeding | `workout.$id.tsx` (block path **and** legacy flat path) |
| Conditioning categorization | `prescription_type`, `conditioning_type`, `training_style`, `conditioning_category`, `intensity_tier`, `modality` — 6 columns, ~40% overlap |
| Workout dashboards | `index.tsx` (Home) and `dashboard.tsx` (Dashboard) compute load independently |
| Quick-start scaffolding | dead code paths in `workout.$id.tsx` (`isQuickStart`, `BlockEditor` fallback) after Pass D removed UI |
| Set logging | `FastSetLogger` + inline forms inside `BlockEditor` and `TrainMode` |
| KIND_META / KIND_LABEL maps | `BlockEditor` + `TrainMode` define their own copies |
| `setTonnage` / volume math | inline in `workout.$id.tsx`, `index.tsx`, `dashboard.tsx`, `load-math.ts` |

## 4. What should be REMOVED 🗑️
- **Dead code**: quick-start props/branches in `TrainMode`/`workout.$id.tsx` (`isQuickStart`, `onAddBlock`, `onOpenBuilder`, `onCancel`) — Pass D made Start template-only; these are now unreachable.
- **`/conditioning/new` route** (33 LOC, redirector): just delete and remove from nav.
- **`/log` route** (5 LOC stub).
- **`dashboard.tsx`** as a separate route — fold into `index.tsx` or vice versa.
- **Legacy `workout_template_exercises`** path in auto-seed — flag templates without blocks and migrate once, then remove the fallback (don't drop the table yet).
- **Strava/WHOOP code paths** in conditioning insert: tables exist but zero references in `src/`. Keep DB, remove any imports.

## 5. What should be SIMPLIFIED ✂️
- **Split `BlockEditor`** into: `BlockList`, `StrengthBlockCard`, `ConditioningBlockCard`, `BlockTypePicker`, `BlockReorder`. Same for `TrainMode`.
- **One canonical Conditioning shape** (one enum + one optional intensity), drop the 6-field cross-product.
- **One template model** (block-based). Auto-migrate legacy on read; don't branch on shape.
- **One “session writer”** module: `lib/session-writer.ts` with `logStrengthSet()`, `logConditioningSession()`, `finishWorkout()`. Today this is scattered.
- **Home page**: drop the 60-day backfill loop; let SQL or a tiny RPC return the daily series.

## 6. What should be HIDDEN 🙈
- Quick-start chooser (Strength / Conditioning / Build On The Fly) — already done in Pass D ✅
- `/conditioning/new` link from any nav (done in Pass A) ✅
- WHOOP/Strava UI (already invisible, keep that way until rebuilt)
- Nutrition page beyond a coming-soon stub
- `/dashboard` — duplicates `/`. Hide nav entry, keep route until merge.

## 7. What is OVERENGINEERED 🛠️
- **Conditioning data model** (`prescription_type` + `conditioning_type` + `training_style` + `conditioning_category` + `intensity_tier` + `modality` + `target_metrics jsonb` + `result_fields jsonb`): six taxonomy columns plus two JSONBs for an MVP that today logs Z2 and intervals.
- **Block timing fields** on both template and session blocks: `timing_mode`, `block_duration_seconds`, `first_set_offset_seconds`, `interval_seconds`, `target_sets`, `time_domain_min`, `work_s`, `rest_s`, `rounds`. Pick a timing model.
- **Auto-grow notes textarea** as a custom component when a `<textarea>` with field-sizing CSS would do.

## 8. What is UNDERBUILT 🚧
- **No Summary/Load screen after Finish**. `finish` toasts then nav to `/`. The user-stated core flow ends in “Summary / Load” — that screen does not exist.
- **No idempotency / no optimistic UI** on set logging — every Log Set is a round-trip.
- **No empty/error/skeleton states** for most queries (TrainMode shows nothing while loading).
- **No telemetry / no error capture wired beyond `error-capture.ts`** (file exists, looks unused).
- **No tests at all** — zero `.test.ts(x)`.
- **Offline / PWA**: `public/sw.js` + manifest exist, but workouts in progress are not persisted locally.
- **No data integrity guards**: scheduled date in past allowed, finish without sets allowed, finish twice allowed.

## 9. Biggest UX problems 🧨
1. **Two timers visible in Train Mode** (Workout + Block + Rest sheet) → cognitive overload on a 384px screen.
2. **Set logging requires opening a card** — the FastSetLogger is good, but discoverability inside `TrainMode` is poor.
3. **Finish button hidden top-right** at the same place as Cancel; high mistake rate.
4. **No “what is this number?”** — Strength Load and Conditioning Load are shown without method/confidence badges even though the data exists.
5. **Calendar Start → template picker requires 2 taps** for the most common action.
6. **Library and Templates routes feel duplicative**.
7. **Home shows scheduled + active + last template + readiness + 60-day analysis** stacked → no hierarchy.
8. **Empty states are silent**: no templates yet → button works, but Home + Calendar both look broken.

## 10. Biggest ARCHITECTURE risks 🏚️
1. **God components** (`BlockEditor`, `TrainMode`) — single point of failure.
2. **Schema sprawl** in `workout_blocks`/`workout_template_blocks` (30+ columns) makes migrations risky.
3. **Two template shapes coexisting** — implicit data model.
4. **Side-effectful auto-seed** in route effect (race + double-write potential).
5. **Started_at default = now()** semantically conflicts with `status='scheduled'`.
6. **No FKs / no cascade** — orphan rows accumulate.
7. **Single mega-route** (`workout.$id.tsx`) owns load, train, edit modes via flags.

## 11. Biggest PERFORMANCE risks 🐢
- **Massive joined query** in `useQuery(['workout', id])` pulls workout + blocks + block_exercises + sets + templates (+ template_blocks + template_block_exercises). One nested select per page load; bloats over time.
- **`useWorkouts(200)` + `useConditioning(200)` on Home**, full join with sets, then JS aggregation across 60 days every render.
- **No pagination** on history.
- **Three concurrent `setInterval`s** possible during Train Mode.
- **Re-renders**: `BlockEditor`'s 43 `useState`s cause cascade re-renders during set logging.

## 12. SCALING risks 📈
- Without FKs and with JSONB free-form fields, **multi-user data once shared** (teams/coaching) will be hellish to migrate.
- **No server-side aggregation** — load math runs on the client. Once a user has 6+ months of data, Home will jank on mobile.
- **No edge functions for heavy reads/writes** — every analytic is a wide select.
- **Conditioning enum drift** between client strings and DB CHECK will keep breaking inserts.

## 13. What should NOT be touched 🚫
- `src/lib/load-math.ts` — keep, it's clean.
- `src/integrations/supabase/client.ts` (auto-generated).
- `src/integrations/supabase/types.ts` (auto-generated).
- RLS policies (correct as-is).
- `__root.tsx` / router bootstrap.
- Auth flow.
- WHOOP/Strava/AI/macros/payments/teams/coaching surfaces (per scope).

## 14. Rebuild later in CURSOR 🧱
These need careful refactor with full repo grep + tests; not great for prompt-driven edits:
- **`BlockEditor.tsx`** decomposition.
- **`TrainMode.tsx`** decomposition + state machine (idle → active → resting → finished).
- **Conditioning data model unification** (DB + UI + writer).
- **Template model migration** (legacy flat → block-based).
- **Server-side load aggregation RPC** (`get_daily_load(user_id, days)`).
- **Test scaffold** (vitest + a few smoke tests).

## 15. Stay in LOVABLE 💜
- Route additions / removals.
- Hide/redirect nav entries.
- Small CSS / token / design tweaks.
- Adding the Summary/Load screen.
- DB migrations that are additive (constraints, indexes, defaults).
- Toasts, empty states, copy.
- Wiring `load_method` / `load_confidence` badges into UI.

## 16. Top 5 highest-ROI next moves 🎯
1. **Build the Summary/Load screen** after Finish. Closes the core flow loop. Pure additive route, low risk, big UX win.
2. **Fix `workouts.started_at` default** → make it nullable, set on `Start`. Removes a whole class of timer/load bugs. Single migration.
3. **Add unique partial index** `unique(owner_id, scheduled_for) where status='scheduled'` to prevent duplicate scheduled sessions. One-line migration.
4. **Extract a `lib/session-writer.ts`** with `logSet` / `logConditioningSession` / `finishWorkout`. Removes duplication in 4 files, makes the next refactor safe.
5. **Split `TrainMode.tsx`** into `<TrainHeader/>`, `<StrengthBlock/>`, `<ConditioningBlock/>`, `<TrainFooter/>`, plus a tiny `useWorkoutStatus` state machine. Cuts the largest active-flow surface in half.

(Bonus 6th, free): add `text-wrap: balance` and consistent `Card` paddings — visual polish for ~10 minutes.

---

## TL;DR
Core flow finally works. The **data model is louder than the UX** — six conditioning columns, two template shapes, a god component, and a DB default that lies. Beta is **stable enough to use** but **not stable enough to scale**. Don't add features for two more sprints; spend them on §16.
