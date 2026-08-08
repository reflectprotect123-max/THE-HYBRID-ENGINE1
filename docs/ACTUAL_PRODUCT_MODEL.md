# Actual product model

Written 8 August 2026 against `main` @ `a8ff104`. Inference is labelled.

## Purpose

A hybrid-training system for an athlete training strength and conditioning
together, with nutrition tracked alongside. Its distinguishing act is
**arbitration**: two specialist engines propose sessions into one week and one
body, and a deterministic Coordinator resolves the collision and records why.

## Intended users and current roles

- **The athlete** — the only role the system actually implements.
- **A "coach"** — exists as a UI surface at `/coach`, gated by
  `VITE_COACH_USER_IDS`, but reads the **signed-in user's own** data
  (`apps/web/src/coach/AthleteStatus.tsx:111` uses `useDb()`). There is no
  coach identity, no coach↔athlete relationship, and no RLS policy for one.
  *[Inference]* the bench was built as a second lens for the owner, not as a
  product for a third party.

## Core value loop

Log training → engines propose → Coordinator resolves the week with reasons →
athlete trains → progression banks → repeat, with recovery and nutrition as
context.

## Route catalogue

**Web** (`apps/web/src/App.tsx`): `/` Home · `/training` · `/library` ·
`/conditioning` · `/history` · `/progress` · `/exercise[/:name]` · `/calendar` ·
`/day/:date` · `/recap/:id` · `/nutrition` · `/settings` · `/log/:bi/:ei`
Logger · `/planner/:id` · `/build/:id` GuidedBuilder · `/coach/*` (lazy, gated)
· `*` → redirect.

**Mobile** (`apps/mobile/src/App.tsx`) — two navigators by world:
- Training tabs: Home · Train · Library · Progress · Settings; stack adds
  Logger, Planner, GuidedBuilder, Recap, Conditioning, History, Calendar,
  Exercise, Day.
- Nutrition tabs: Log · Food · Weight · Coach · Settings.

## Implemented

- Session logging with RPE-based autoregulation, warm-up exclusion, supersets,
  text and warm-up blocks.
- Conditioning with modalities, intervals, HR zones, Concept2/FTMS parsing.
- Coordinator weekly resolution with a full decision trace.
- Whole-athlete state from manual check-ins, WHOOP and life load.
- Nutrition: quick add, custom foods, recipes, barcode scan, label OCR,
  weigh-ins, adaptive expenditure and weekly check-in.
- Additive cross-device sync with tombstones and RLS-isolated storage.
- Import/export/backup of the local slice.

## Partially implemented

- **`auto-coach`** — full policy and resolver, wired into web only. The phone,
  where training is actually logged, does not depend on it.
- **Ecosystem sync** — behind `VITE_HYBRID_ECOSYSTEM_SYNC` /
  `EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC`; the legacy `app_state` blob is still the
  live path.
- **Coach bench** — 11 panels, no server-side coach concept, no render tests.

## Mock or demonstration-only

- **The shared food catalogue is empty.** `foods` / `food_servings` ship with no
  rows; the seed lives in a retired repository. Barcode lookups always miss and
  route to "create the food" — correct by design, indistinguishable from a bug.
- **`simulateFixtures.ts`** (`apps/web/src/coach/`) — canned scenarios for the
  Simulate panel, not athlete data.

## Terminology

| Term | Meaning here |
|---|---|
| **World** | One of Strength / Conditioning / Nutrition — a view, never a data filter |
| **Domain** | `strength` or `conditioning` — what the Coordinator arbitrates |
| **Proposal** | A session an engine wants scheduled, with interference tags |
| **Decision** | Accept/drop plus a reason code — the Coordinator's audit trail |
| **Earned / banked** | A working weight won by performance (`liftProgress`) |
| **Gate** | A one-directional easing of prescribed load on a low-recovery day |
| **Receipt** | An inspectable record of an automated change (ledger) |
| **Basis** | Whether a nutrition panel is per-serving or per-100 |

## Product promises visible in the interface

- "These numbers are stored as you type them and are never recalculated later"
  (`apps/mobile/src/screens/nutrition/FoodSearch.tsx`) — **true**; verified by
  the snapshot tests.
- Coach screen coverage ring plus a sentence naming the direction of harm when
  weigh-ins are sparse — **true**, and unusually honest.
- Check-in screen prints the macro/calorie contradiction with its cause —
  **true**.

## Contradictions between copy and implementation

1. **`vite.config.ts:75-79`** says the coach is "a different app at the same
   origin". It is a lazy chunk of the same SPA. Effect: `/coach` fails offline.
2. **`apps/mobile/src/screens/nutrition/CustomFood.tsx:36`** comments that any
   unit other than g/ml/serving "is typed" — there is no unit text input, only
   three chips.
3. **The Logger's advisory framing.** It prints a hint about the next set, then
   writes the number into the field (`Logger.tsx:296-297`). The copy reads as
   advice; the behaviour is a change.
4. **`fields.tsx`** formerly justified a whole-number keypad for macros while
   the label reader produced decimals — fixed 7 August, noted because the class
   of contradiction recurs.

## The five most important workflows

1. Log a training session. 2. Coordinator resolves the week. 3. Daily check-in.
4. Log food. 5. Sync across devices. (Detail in `docs/ACTUAL_WORKFLOWS.md`.)

## The five biggest product risks

1. Automatic load increase with no confirmation or receipt (R1).
2. Progression applied without approval (R2).
3. Receipts device-local, so automation is invisible off-device (R3).
4. Composite readiness blends athlete report with vendor score, so neither
   outranks the other (R5).
5. Unsourced thresholds presented as authoritative bands (R6).

Full register in `docs/RISK_REGISTER.md`.
