# AI as the prescribing engine — build scope

**Status:** scope, not a design and not built. Written 13 August 2026.
**Split across three tools:** Claude (in-repo), ChatGPT (model layer), Codex (service layer).

---

## The one constraint that shapes everything

**The deterministic engine is not deleted. It becomes the floor.**

`apps/mobile` must work in a basement gym with no signal. `liftAdapt`
(`packages/engine/src/lift.ts:154`) and `conAdapt`
(`packages/engine/src/conditioning.ts:354`) run locally, instantly, free, and
are pinned by 25 golden-vector files. An LLM is none of those things.

So "AI replaces the engine" can only honestly mean:

> AI decides the prescription when it is reachable, trusted and within bounds.
> The existing engine decides when it is not. The athlete cannot tell which
> happened, except that the app never stops working.

Anything else ships a training app that fails when the wifi does.

## What makes this safe is the schema, not the prompt

The model never returns prose that something parses. It returns a validated
struct, and an invalid struct is REJECTED — falling through to the engine —
rather than repaired or obeyed. Every existing safety gate stays downstream of
it: pain and illness still outrank the output, and the Coordinator or the coach
still owns placement.

---

## The three streams

Partitioned by **contract and file ownership**, so three tools can work
simultaneously without touching each other's files. This is the same discipline
that made today's parallel agent work land cleanly.

**Stream A must finish first.** B and C both build against the schema it
freezes; starting them early means building against a moving target.

---

### Stream A — contract, fallback and evaluation (Claude, in-repo)

The part with the deepest coupling to existing code, and the part that decides
whether the other two are safe. Needs full repo context: colocated test rules,
the golden vectors, the engine internals, `CLAUDE.md`'s ownership boundaries.

**Owns:** a new `packages/ai-prescription/` and nothing else in the engine.

**Deliverables**

1. `AiPrescription` — the output struct. Per-exercise or per-piece prescription,
   plus a mandatory `reasonCode` and `rationale`. It must carry `basis`:
   which facts the decision used. A prescription that cannot say what it was
   based on is not auditable and is rejected.
2. The **validator**, and this is the real work. Not "is it valid JSON" —
   is it physiologically sane and within bounds:
   - load delta inside a percentage band of the last known working weight
   - volume inside the athlete's recent range
   - no increase at all while a pain or illness flag is live
   - domain matches what was asked for
   Every rejection returns a reason. Rejections are counted, not swallowed.
3. The **fallback policy**: unreachable, slow, invalid, or low-confidence all
   resolve to `liftAdapt` / `conAdapt`. One code path, tested for each cause.
4. The **eval harness**, built on the 25 existing golden vectors. They stop
   being only regression tests and become the bar: given the same inputs, does
   the model's answer stay within the band the deterministic engine defines?
   Reports agreement rate, out-of-band rate, and rejection rate. This is the
   number that decides whether tier 3 ever ships.
5. Feature flag, defaulting OFF. Engine-only is the shipped behaviour until the
   eval says otherwise.

**Done when:** the harness runs against a stubbed model in CI, every fallback
cause has a test, and no existing engine test changed.

---

### Stream B — the model layer (ChatGPT)

Design work, deliberately almost repo-free. Deliverable is a document plus a
prompt pack, not a pull request.

**Owns:** `docs/ai/` — prompts, rubric, model notes. Touches no source.

**Deliverables**

1. Model choice with reasoning, and a second choice for fallback.
2. The prompt pack: system prompt, the athlete-context template, and the
   structured-output schema binding to Stream A's `AiPrescription`.
3. Few-shot examples derived from the golden vectors.
4. A **failure taxonomy**: the ways this model gets programming wrong —
   over-progression after one good session, ignoring accumulated fatigue,
   hallucinating an exercise not in the catalogue, drifting on units. Each with
   the check that catches it, cross-referenced to Stream A's validator.
5. Cost and latency budget per prescription, and what happens when it is
   exceeded.
6. A written answer to: what does this do better than 170 lines of arithmetic?
   If there is no honest answer, tier 3 should not be built and this is the
   cheapest possible place to discover that.

**Done when:** the prompt pack produces a schema-valid prescription for every
golden-vector input, and the taxonomy has a named check for each failure.

---

### Stream C — the service layer (Codex)

Mechanical, well-specified, high-volume. Depends entirely on A's frozen schema.

**Owns:** `supabase/functions/prescribe/` and one new client module in each
app. Touches no engine file, no coach file.

**Deliverables**

1. A Supabase Edge Function `prescribe`. The API key lives there and NEVER on
   a device — an athlete's phone must not carry a provider credential.
2. Request validation, per-user rate limiting, and a hard timeout matched to
   Stream A's fallback trigger — the client must give up before the athlete
   notices rather than after.
3. Response cache keyed on the input facts. The same athlete, the same state,
   the same day should not be billed twice.
4. Telemetry: per call, whether it was served, cached, rejected by the
   validator, or fell back — and why. Without this there is no way to know if
   the feature works in the field.
5. The client call path in `apps/web` and `apps/mobile`, offline-first: it asks,
   and on any failure or timeout it uses the engine result it already has.
6. Kill switch, server-side, so the feature can be turned off without shipping
   an app build.

**Done when:** the function is deployable, the cache and rate limit have tests,
and pulling the network mid-call lands on the engine result with telemetry
recording it.

---

## Sequencing

```
A (schema + validator + harness)  ──┬──▶  B (prompts, evaluated by A's harness)
        freeze the schema           └──▶  C (service, built to A's schema)
                                             │
                                    A's eval gate ──▶ ship or don't
```

## Handoff rules between the three tools

Learned the hard way, and non-negotiable if three tools work in one repo:

- **One owner per path.** A owns `packages/ai-prescription/`, B owns `docs/ai/`,
  C owns `supabase/functions/prescribe/` plus its two client modules. No file
  is written by two streams.
- **The schema is a file, not a message.** B and C import A's type. They never
  keep their own copy of the shape — a second copy drifts, silently.
- **Nobody weakens a check to make their part pass.** If C's timeout makes the
  validator reject, the answer is the timeout, not the validator.
- **Tests are colocated**, `src/foo.ts` beside `src/foo.test.ts`, in every
  stream. Repo rule, no exceptions.
- **No migration is applied by anyone.** Files only.

## The kill criterion

Written now, while it is still cheap to act on.

If Stream A's eval shows the model agreeing with the deterministic engine most
of the time, tier 3 costs money and network to reproduce arithmetic that
already works offline for free — ship the Advisor tier instead. If it shows the
model frequently outside the band, it is not ready to prescribe to a human
body. **Tier 3 is only worth shipping in the narrow middle: meaningfully
different, defensibly better, reliably in-bounds.** Decide against the eval
number, not against how good the demo felt.
