# Strength adaptive engine V2 — research bundle

17 August 2026. Owner-commissioned Cowork research handoff
(`THE_Hybrid_Engine_Project_Handoff_2026-08-16.zip`), checked in here as raw
reference material. **This is a separate track from
`docs/superpowers/specs/2026-08-17-strength-rebuild-design.md`'s 30-slice
build — not yet folded into it.** The owner's own words: "this research is
what we are basing the adaptive engine off, but its separate from the 30
slice build but it will be integrated." Do not start building against this
bundle until that integration gets its own brainstorm/spec pass.

## What's here

- `README_FIRST.md` — the bundle's own index, including its "locked
  implementation decisions" (2.5% default progression of last stable
  opening load, equipment-aware rounding, 5% reactive reduction from the
  last successful anchor, pain as a separate safety pathway from ordinary
  fatigue, training gaps lower certainty rather than being ignored).
- `THE-Coach-Brain-v0-AI-Model-Spec.md` — an LLM-based decision-explanation
  layer: **"the rule engine decides, the AI explains."** Structured JSON
  input (athlete profile, readiness, training history, performance trends)
  → structured JSON decision output. Built around a D1–D7 weekly structure
  and a fixed session chassis (Prep → Secondary Explosive → Strength ×2 →
  Support → Conditioning → Cool Down) that does not match this repo's
  current week/day model — reconcile before adopting.
- `design.md` — a full product/technical design for an athlete PWA + coach
  app. **Describes a different codebase's shape** (its own nav, data model,
  screens) — read for concepts, not as a literal target.
- `AUDIT.md` + `HybridTraining_Audit.md` — architecture audits of **a
  different, unrelated codebase** (TanStack Start, `src/lib/load-math.ts`,
  `BlockEditor.tsx` at 1,134 LOC, `workout_template_exercises`/
  `workout_template_blocks`). None of these file paths exist in THE Hybrid
  System. Useful only as prior-art pattern references (e.g. "two parallel
  template systems is the #1 architectural risk" is a real lesson even
  though the two systems named aren't this repo's).
- `JARVIS_TAKEOVER_AUDIT.md`, `FILE_TREE.md`,
  `hybrid_adaptive_evidence_bundle_2026-08-01.md` — supporting evidence and
  file-tree snapshots from the same source project.
- `final-evidence-dossier.md` — the full 120k-word research dossier in
  searchable text (the source ZIP's PDF/DOCX versions were not checked in;
  this Markdown copy is the complete text).
- `exercise-library/` — 120 curated exercises (JSON canonical + CSV +
  README), categorized (Strength — Hinge/Squat/Push/Pull, Power & Athletic,
  Cardio, Core, etc.). This is real, directly usable data — closest thing
  in this bundle to something that plugs straight into Slice 16 (exercise
  picker) once reshaped to this repo's `exercise` table (Phase A, Slice 2).

## Before integrating

- Reconcile the D1–D7/session-chassis structure against this repo's actual
  week/day model (`athlete_weekly_plans`, `publish_coach_week`) — they are
  not obviously the same shape.
- Decide whether "the AI explains" layer is in scope at all for this
  rebuild, or a later addition — it's a genuinely different kind of
  component (an LLM call) from everything else in the 30-slice spec, which
  is pure deterministic engine code.
- The locked progression numbers (2.5% / 5%) are a real, usable starting
  point for whatever slice ends up rebuilding `decideStrengthProgression`
  (deleted 17 August with the rest of `packages/engine/src/adaptive/`) —
  see that file's history for the deterministic version this repo already
  built once (exposure classification, calibration state, anchor-load
  deload protection).
