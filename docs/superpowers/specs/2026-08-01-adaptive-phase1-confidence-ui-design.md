# Phase 1 — Working-Weight Confidence Indicator (Design)

**Status:** Design. Scope decided by default (no response to two rounds of clarifying questions on decision/UI-element choice) — proceeding with the lower-risk, most-viewed-screen option per this session's established pattern of moving forward on unanswered decisions using the recommended default, logged transparently.

## What this is

Phase 1 of the adaptive-training-engine roadmap (`docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md` §14) calls for surfacing at least one engine decision's reason codes read-only in the UI, "why text renders for at least one existing decision per app." Pain-stop wiring (the other half of Phase 1) already shipped in a prior session — this is the remaining piece.

Phase 0 built four read-only "explain" wrapper functions (`packages/engine/src/adaptive/explain.ts`) that reshape existing engine decisions into a typed `TrainingDecisionExplanation` (`confidence`, `reasonCodes`, `note`, `safetyState`, `dataLimitations`). None have a UI consumer yet — confirmed by a repo-wide grep (zero hits outside `adaptive/explain.ts`, `index.ts`'s barrel re-export, and its own tests).

## What's changing

**Decision surfaced:** working weight, via `explainWorkingWeight(w, rec)`.

**Where:** `Logger.tsx`, both apps (`apps/web/src/screens/Logger.tsx`, `apps/mobile/src/screens/Logger.tsx`) — the per-set logging screen, already the site that computes `nextWorkingWeight(ex.name, settings, whoop)` and renders its `.note` as a `note` prop / inline label next to the weight field on every set.

**What's new to the athlete:** today, the note text ("earned 100kg last time" / "earned 97.5kg · eased for 20% recovery") is the same whether or not a WHOOP strap is connected — there is no way to tell a grounded number from a guess. `explainWorkingWeight`'s `confidence` field already distinguishes this (drops to `'low'` when no recovery reading exists, matching `explainConPrescription`'s already-consistent behavior after the Phase 0 final-review fix). Phase 1 surfaces that distinction: when `confidence === 'low'`, a small "estimate" tag renders next to the existing note text. When `confidence === 'high'`, nothing new renders — today's exact copy is unchanged.

**What's NOT changing:** the underlying weight number, `nextWorkingWeight`, any golden-tested function, or any other screen. This is purely additive UI on top of an already-computed, already-displayed value.

## Data flow

```
nextWorkingWeight(name, settings, whoop)  →  WorkingWeight | null   (unchanged, existing call)
todayRecovery(whoop)                       →  number | null         (existing engine function, already imported by conPrescription call sites)
explainWorkingWeight(w, rec)               →  TrainingDecisionExplanation   (Phase 0, already built/tested)
```

`Logger.tsx` already has `whoop` in scope at both call sites (it's already passed into `nextWorkingWeight`) — `todayRecovery(whoop)` is a one-line addition, no new prop threading required.

## UI treatment

Reuse the existing note-rendering slot exactly as it is today; append a short, low-emphasis tag only when `confidence === 'low'`:

- Web: `StepperField`'s existing `note` prop already accepts a string — append `' · estimate'` when low-confidence, or (if `StepperField` supports a secondary/muted slot) render it visually distinct. Implementer's call within the existing component's API — no new component.
- Mobile: same pattern next to the existing inline label.

No new Card, no new icon, no color change — this stays inside "small, additive, doesn't change what the athlete does," matching Phase 1's stated risk profile (Low-Medium, first real behavior change was the pain-stop wiring; this slice is UI-only, no gating, no acknowledgement required).

## Testing

- `explainWorkingWeight` itself is already tested (Phase 0). No engine test changes.
- Add/extend `checks/react-smoke.mjs` (or the equivalent scenario file) with one assertion: a logged set with no WHOOP data connected shows the estimate tag; one with WHOOP recovery data does not. Mirrors how the pain-hold banner got its own smoke coverage.
- No golden-suite risk: `Logger.tsx` is outside the golden fixture path entirely.

## Out of scope for this slice

- The other three explainers (`explainSetAdjustment`, `explainConPrescription`, `explainConAdapt`) stay unconsumed by UI for now — Phase 1's acceptance bar is "at least one," this is that one.
- `safetyState`/`reasonCodes` display — nothing meaningfully differentiates yet (all four explainers currently return `safetyState: 'approved'` always, per the Phase 0 final review's own Minor finding); not worth UI real estate until Phase 2+ populates it.
- Any change to `nextWorkingWeight`'s actual math or the weight number shown.
