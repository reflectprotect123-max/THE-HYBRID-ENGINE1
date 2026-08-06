# The coach builder becomes a guided flow

**Status:** design, approved in outline · **Date:** 2026-07-29

---

## The problem

A fresh-eyes walkthrough of `apps/coach` (documented earlier in this session) found a builder that shows too much at once: the exercise editor has a prescription table, mode/tempo, a rest stepper, and four icon-only buttons all visible simultaneously, with a real clipping bug in the block-heading input and an undecodable "HR" stat. The athlete app, walked the same way, was consistently better: one plain-language question per screen ("Is the training working?"), smart pre-filled defaults, honest dashes instead of fake zeros.

This redesign takes the coach builder's authoring surface — adding and editing what's actually in a session — and rebuilds it as a guided, full-screen, one-step-at-a-time flow, so a first-time coach can build a session without knowing a syntax or scanning a dense form.

## What stays, what changes

**The Plan tab (week/day view) is a deliberate exception.** It becomes a TrainHeroic-style grid — days as columns, exercises as rows — dense and built for arranging a week fast, not for the "one thing at a time" treatment applied everywhere else. This is intentional: judging a week's balance and moving things around is an overview task, not a sequential one, and the grid is the right tool for it.

- An **empty cell** offers two choices: **Create a session** (starts the guided flow below from scratch) or **Add from library** (reuses an existing session from the Library tab, unchanged).
- A **filled cell** shows **Edit**, opening that session in the guided flow.

**Authoring a session is a full-screen, drill-down flow**, replacing the current always-visible dense editor entirely (no toggle back to the old view):

1. **Adding a block** asks "What are we doing?" — Lift / Warm-up / Conditioning / Metcon, as big tappable choices, plain language over jargon.
2. **Adding an exercise** to a Lift block: the existing movement picker (unchanged — it tested excellently: clear title, good search, no complaints) → **sets** via a plain stepper (default 3) → **per set, "Warm-up or working?"** as its own toggle (replacing the "W10" prefix convention, which packed the warm-up flag and the target into one string) → **reps target** via tap chips (5 / 8 / 8-12 / max / custom) → **RPE** via chips (skipped when the set is marked warm-up) → **rest / tempo / notes** tucked behind one "more" step, not shown by default.
3. **Superset chaining is unchanged** — the seam/chain-link interaction between two cards tested excellently in the walkthrough (clear relabeling to A1/A2, a solid chain-link connector) and moves into this flow exactly as it works today.
4. **Coach instructions and Deliver/publish become the final full-screen step** in the flow, rather than a permanently-visible right-side panel the coach sees on every screen regardless of whether they're ready for it.
5. Every full-screen step keeps a persistent header — "Day 1 · Session · 2 of 4 exercises" — so a coach isn't fully cut off from where they are in the session while drilling into one exercise.

## Explicitly out of scope

These were found during the same walkthrough but are independent, small fixes — not part of this redesign, and not blocked on it:

- The block-heading input's clipping bug (`Editor.tsx`'s `size={...}` calculation not accounting for uppercase + letter-spacing).
- The "HR" stat label being undecodable without reading the source.
- Raw, unhumanized error text surfacing in two places (coach sign-in's "Failed to fetch," athlete Settings' WHOOP JSON-parse error) — worth a single shared fix, but not tied to this redesign.
- The athlete logger asking for RPE on warm-up sets.

## Testing

The grid's data model and the guided flow's step logic (which step comes next, what's required before advancing) should be pure, testable functions — not embedded in JSX — so they get real unit tests the way the rest of this app's logic does. The full flow (grid → create session → add block → add exercise → publish) gets a `checks/react-smoke.mjs` scenario end to end, replacing the existing coach-builder assertions that were written against the old dense editor.
