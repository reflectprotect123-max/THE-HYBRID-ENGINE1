# AI prescription, Stream A — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the contract, the validator, the fallback and the eval harness
that decide whether an AI-prescribing engine is safe to ship at all — and
freeze the schema the other three streams build against.

**Scope:** `docs/superpowers/specs/2026-08-13-ai-engine-build-scope.md`,
Stream A only. Streams B (ChatGPT), C (Codex) and D (Gemini) are briefed at the
bottom of this file and are not implemented here.

**Nothing in this plan makes a model call.** Stream A is provider-agnostic by
construction: it defines the shape, checks the shape, and measures the shape.
Stream C supplies the transport. If Stream A finds itself importing an SDK,
that is the signal to stop.

## Why the order is what it is

Task 1 unblocks three other tools, so it ships first and small. Tasks 2–4 are
the actual value: a validator nobody can argue with, a fallback that always
lands, and a number that decides whether this feature ever ships. Task 5 keeps
it dark. Task 6 is the seam with Gemini's evidence base.

## What must not change

| Rule | Where it comes from |
|---|---|
| `liftAdapt` / `conAdapt` keep working, untouched, offline | `packages/engine/src/lift.ts:154`, `conditioning.ts:354` |
| The 25 golden vectors keep passing, unmodified | `packages/engine/test/golden/` |
| Pain and illness outrank any prescription | `CLAUDE.md` — safety flags, not readiness penalties |
| The Coordinator or the coach still places the week | `CLAUDE.md`, and the week-publish design |
| Tests are colocated, `src/x.ts` beside `src/x.test.ts` | `CLAUDE.md` |

No file under `packages/engine/` is edited by this plan. The new package
depends on the engine; the engine never learns the AI exists.

---

## Task 1 — Package skeleton and the frozen schema

**Unblocks Streams B, C and D. Ship it before anything else.**

- [ ] Create `packages/ai-prescription/` with the workspace's standard
      `package.json` / `tsconfig.json`, named `@hybrid/ai-prescription`.
- [ ] `src/contract.ts` — the `AiPrescription` type. Required fields:
      the domain, the prescribed values, a `reasonCode` from a closed union, a
      human `rationale`, a `confidence`, and `basis`: the facts the decision
      used. A prescription that cannot say what it was based on is not
      auditable — `basis` is required, never optional.
- [ ] `src/contract.ts` — `validateShape(value: unknown): AiPrescription`,
      throwing with a specific message per failure. Shape only; physiology is
      Task 2.
- [ ] `src/contract.test.ts` — every required field missing, every union
      violated, extra fields ignored rather than trusted.
- [ ] Add to the workspace and confirm `pnpm run typecheck` sees it.

**Gate:** `pnpm run typecheck` clean; `pnpm --filter @hybrid/ai-prescription test`
green. **Then tell B, C and D the schema is frozen.**

---

## Task 2 — The bounds validator

The real work. Not "is this valid JSON" — is this safe to give a human body.

- [ ] `src/bounds.ts` — the limits, as named exported constants in ONE place,
      each with a comment marking it `PLACEHOLDER — Stream D replaces this`.
      Hard-coding them is acceptable now and is not acceptable at ship; Task 6
      is where that debt is paid.
- [ ] `src/validate.ts` — `checkBounds(p, context): BoundsVerdict`. At minimum:
      - load delta outside a band of the last known working weight → reject
      - volume outside the athlete's recent observed range → reject
      - ANY increase while a pain or illness flag is live → reject, and this
        one is not a band, it is absolute
      - domain mismatch against what was requested → reject
      - an exercise not in `packages/engine/src/catalogue.ts` → reject
- [ ] Every rejection returns a `reasonCode` and the value that failed.
      Rejections are returned and counted, never swallowed.
- [ ] `src/validate.test.ts` — one test per rule, each proving the rule fires,
      plus a test that a clean prescription passes untouched.

**Gate:** a test asserting that a prescription raising load with a pain flag
live is rejected regardless of every other field. If that test can be made to
pass by changing a constant, the constant is in the wrong place.

---

## Task 3 — The fallback policy

- [ ] `src/resolve.ts` — `resolvePrescription(request, deps)`. One path, four
      causes of falling back: unreachable, timed out, shape-invalid,
      bounds-rejected. A fifth, low confidence, is a threshold in `bounds.ts`.
- [ ] Fallback calls `liftAdapt` / `conAdapt` and returns their result tagged
      with `source: 'engine'`. A served AI result is tagged `source: 'ai'`.
      Callers must be able to tell; the ATHLETE must not have to.
- [ ] `deps` is an injected interface — `{ prescribe(), now(), engine() }`.
      That is what keeps this package free of any SDK and testable without a
      network.
- [ ] `src/resolve.test.ts` — every cause lands on the engine result, and each
      records its cause distinctly.

**Gate:** a test where the model returns a beautifully-formed, in-bounds,
confidently-wrong prescription for a pain-flagged athlete, and the resolver
returns the engine's answer. That is the whole feature working.

---

## Task 4 — The eval harness

The deliverable that decides whether tier 3 ships.

- [ ] `src/eval/harness.ts` — replays the 25 golden vectors through a supplied
      `prescribe()` and reports, per vector and in aggregate: agreement with
      the deterministic engine, in-band-but-different, out-of-band, rejected,
      failed to parse.
- [ ] Read the vectors from `packages/engine/test/golden/` — do not copy them.
      A second copy drifts.
- [ ] `src/eval/harness.test.ts` — drive the harness with a STUB model, not a
      real one: one stub that always agrees, one that is always wildly out of
      band, one that returns junk. The reported numbers must be exactly right
      for each, or the harness cannot be trusted to judge a real model.
- [ ] A script entry so the report can be produced on demand, and a written
      note that it is not part of `pnpm run test` — it needs a model.

**Gate:** the three stub runs produce their expected numbers. This runs in CI;
the real-model run does not.

---

## Task 5 — Feature flag, dark by default

- [ ] `AI_PRESCRIPTION_ENABLED`, defaulting **off**, checked in `resolve.ts`.
      Off means the AI path is never called at all — not called and discarded.
- [ ] Telemetry hooks as an injected optional callback: served, cached,
      rejected, fell-back and why. Stream C fills these in; Stream A defines
      their shape so both ends agree.
- [ ] `src/resolve.test.ts` — with the flag off, `deps.prescribe` is never
      invoked. Assert on the spy, not on the output.

**Gate:** flag off, no call. Engine behaviour byte-identical to today.

---

## Task 6 — Replace the placeholders with Stream D's bounds

**Blocked on Gemini's bounds table. This plan is not complete until it lands.**

- [ ] Import the bounds from `docs/ai/evidence/`'s table rather than the
      constants in `bounds.ts`, keeping a single named export so nothing
      downstream changes.
- [ ] Every bound carries its source through to the rejection reason, so a
      refusal can say what it was based on.
- [ ] Delete the `PLACEHOLDER` comments. A grep for `PLACEHOLDER` in this
      package returning nothing is the completion signal.
- [ ] Re-run Task 4's harness. The numbers WILL move — record the before and
      after in this file rather than replacing one with the other.

**Gate:** no `PLACEHOLDER` remains; harness re-run recorded.

---

## Final verification

- [ ] `pnpm run typecheck`
- [ ] `pnpm run test` — including every existing engine test, unmodified
- [ ] `pnpm run check:lanes`, `pnpm run check:ecosystem`
- [ ] `node checks/coach-contract.mjs`
- [ ] Confirm no file under `packages/engine/` changed: `git diff --stat`

---

# Briefs for the other three tools

Copy-paste. Each names one directory and one job. **None of them start until
Task 1 says the schema is frozen — except Gemini, which starts now.**

## Gemini — Stream D, start immediately

> Build a cited evidence base for a strength-and-conditioning prescribing
> system. Output goes in `docs/ai/evidence/` and is DATA, not prose.
>
> The deliverable that matters is a **bounds table**: for each thing a
> prescription can specify — load change, set count, rep range, session
> volume, intensity, weekly frequency — the range the literature supports, for
> beginner / developing / experienced athletes, in strength and in
> conditioning.
>
> Every record carries: the assertion, the bounds it implies, the source, and
> how strong that source is. A paragraph about periodisation is not a record.
> Nothing uncited goes in the file. Where sources disagree — concurrent
> training interference especially — record BOTH positions rather than picking
> one; a base that hides disagreement produces a system confident about
> contested things. Record the licence of each source: this is a commercial
> product.
>
> You decide nothing. You supply bounds that a validator will enforce.

## ChatGPT — Stream B, after the schema freezes

> Design the model layer for an AI prescribing engine. Output goes in
> `docs/ai/` (NOT `docs/ai/evidence/`, which belongs to another stream) and is
> documents and prompts. Touch no source code.
>
> Deliver: model choice with reasoning plus a fallback choice; a system prompt
> and athlete-context template; a structured-output binding to the
> `AiPrescription` type you will be given — import the shape, never restate it;
> few-shot examples derived from the project's golden vectors; a cost and
> latency budget per prescription.
>
> The most important deliverable is a **failure taxonomy**: the specific ways a
> model gets programming wrong — over-progressing after one good session,
> ignoring accumulated fatigue, inventing an exercise, drifting units — each
> paired with the validator check that catches it.
>
> And answer this in writing: what does this do better than 170 lines of
> arithmetic that already runs offline for free? If there is no honest answer,
> say so. That is a useful result, not a failure.

## Codex — Stream C, after the schema freezes

> Build the service layer for an AI prescribing engine. You own
> `supabase/functions/prescribe/` and one client module in each of `apps/web`
> and `apps/mobile`. Touch no engine file, no coach file, no other stream's
> directory.
>
> Deliver: a Supabase Edge Function `prescribe` holding the provider API key —
> it must NEVER reach a device; request validation; per-user rate limiting; a
> hard timeout matched to the client's fallback trigger; a response cache keyed
> on the input facts so the same athlete in the same state on the same day is
> not billed twice; telemetry recording served / cached / rejected / fell-back
> with the reason; and a server-side kill switch so the feature can be disabled
> without shipping an app build.
>
> The client path is **offline-first**: it asks, and on any failure or timeout
> it uses the engine result it already holds. Pulling the network mid-call must
> land on the engine answer with telemetry recording it — that is your
> acceptance test.
>
> Follow the repo's conventions: tests colocated beside their source, and you
> never apply a migration, only write one.
