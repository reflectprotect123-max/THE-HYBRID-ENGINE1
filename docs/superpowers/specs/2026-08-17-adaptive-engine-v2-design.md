# Adaptive engine V2 — deterministic progression + retrieval-backed AI decisions

17 August 2026. Second half of the strength rebuild series, continuing
directly from `2026-08-17-strength-rebuild-design.md` (Slices 1-30, Phases
A-D). This doc is Slices 31-60, Phases E-I. **60 slices total across the two
documents is the whole build.** Grounded in the research bundle filed at
`docs/research/strength-adaptive-engine-v2/` and three rounds of scoping with
the owner this session:

- The AI does real decision work, silently, in the background — no
  "AI explains itself to the athlete" chat surface (rejecting the research
  bundle's own "rule engine decides, AI explains" framing).
- It's retrieval-backed, not a fine-tuned model — the owner's "you + a
  stupid sized information database" is a knowledge corpus an AI call
  searches at decision time, not training examples baked into new model
  weights. Fine-tuning was explicitly ruled out (needs thousands of
  labeled examples and training infra this repo has neither).
- It "works symbolically with the app" — one interface seam
  (`decideProgression`) that both a deterministic implementation and an
  AI-backed implementation satisfy interchangeably. Neither this doc nor
  Phase A needed to be rewritten to fit each other.

> **Build-order note, added after further scoping the same day.** The owner
> ruled out Claude API (no ongoing per-call dependency on Anthropic
> specifically), ruled out a cloud-rented GPU running an open model like Kimi
> K3 (cost/infra disproportionate to what a progression decision needs), and
> has no local hardware to self-host a smaller open model on today. Their
> own words: **"we are not hosting it. just build the engine."**
>
> So the build order is: **Phases E and F ship now. Phase G (the actual
> model call) does not.** Phase F's knowledge base and retrieval are real,
> useful on their own — a coach can search their own notes — and `Phase
> E`'s `DeterministicDecider` is the only `ProgressionDecider` wired into
> the app. `AiRetrievalDecider` (Slice 40) stays defined as an interface
> shape and nothing more: no model is chosen, no hosting decision is made,
> and Slices 41-45 (the actual call, guardrails, scheduling) do not get
> built until a model/hosting choice exists. Phases H and I, which assume
> Phase G is live, wait with it. This is not a scope cut — nothing here was
> descoped, it is a hold on the one phase whose infrastructure isn't
> decided, with a real seam already in place for whenever it is.

## Architecture

**Phase E extends `@hybrid/strength-engine`** (no new package) — the
deterministic side of the seam.

**New package `@hybrid/coach-brain`** for the AI side — retrieval, the
Claude API call, and the feedback loop. Depends on `@hybrid/strength-engine`
for types, never the reverse: the deterministic engine must build and run
with zero knowledge that an AI implementation exists, so `decideProgression`
stays swappable rather than the AI quietly becoming load-bearing.

**The seam**, defined once, in `@hybrid/strength-engine/src/progression.ts`:

```ts
export interface ProgressionDecision {
  exerciseId: string;
  action: 'progress' | 'hold' | 'deload' | 'retest';
  deltaKg?: number;          // signed; present for progress/deload
  deltaPct?: number;         // the 2.5% / 5% the decision was expressed as, before rounding
  confidence: number;        // 0-1
  source: 'deterministic' | 'ai_retrieval';
  reasonCodes: string[];     // machine-readable, never prose — see Slice 33
}

export interface ProgressionDecider {
  decide(exposures: StrengthExposure[], calibration: CalibrationState, ctx: DecideCtx): Promise<ProgressionDecision>;
}
```

Both Phase E's `DeterministicDecider` and Phase G's `AiRetrievalDecider`
implement `ProgressionDecider`. The caller (Slice 60's integration point)
picks one per athlete via a stored preference, defaulting to
`DeterministicDecider` — nothing athlete-facing changes if the AI is never
turned on for that athlete.

**Database**: additive migration
`supabase/migrations/20260819_adaptive_engine_v2.sql`, plus the `pgvector`
extension (already available on Supabase, not self-hosted — see the
`supabase` skill's guidance to load before touching any of this).

---

## Phase E — Deterministic engine V2 (3 slices)

Ports the deleted `packages/engine/src/adaptive/{exposures,strength}.ts`
onto the new metric-registry schema. Same logic, new foundation — this is
the literal "V2" the owner asked for, not new behavior.

### Slice 31 — exposure classification

```ts
export type ExposureClass = 'successful' | 'successful_but_uncertain' | 'missed' | 'pain_blocked';

export interface StrengthExposure {
  exerciseId: string;
  reps: number;
  loadKg: number | null;
  onTarget: boolean;
  rated: boolean;          // an RPE measurement was present
  painFlagged: boolean;
  exposureClass: ExposureClass;
  performedSetId: string;
}

export function strengthExposuresFor(
  athleteId: string, exerciseId: string, performed: PerformedSetWithMeasurements[]
): StrengthExposure[] {
  // one exposure per session: the LAST completed, non-warmup performed_set
  // for this exercise that carries a real load measurement — mirrors the
  // deleted lastWorkingSet selection rule exactly, ported onto
  // performed_set/performed_measurement instead of LoggedSet.
}
```

`pain_blocked` outranks `missed` — checked first, exactly as the deleted
version did: a set can be both under target and pain-flagged, and treating
it as an ordinary miss would feed a real injury signal into load-cutting
math instead of excluding it from strength evidence entirely. This is
still narrow and still does not reinstate a session stop (CLAUDE.md, "The
auto-coach is deleted" — unchanged by this rebuild). Test: a pain-flagged
missed set classifies as `pain_blocked`, never `missed`.

### Slice 32 — calibration state

```ts
export type CalibrationState = 'calibrated' | 'building' | 'uncalibrated';

const MIN_EXPOSURES = 3;

export function calibrationStateFor(exposures: StrengthExposure[]): CalibrationState {
  const usable = exposures.filter(e => e.exposureClass !== 'pain_blocked');
  if (usable.length === 0) return 'uncalibrated';
  return usable.length >= MIN_EXPOSURES ? 'calibrated' : 'building';
}
```

An `uncalibrated`/`building` exercise never gets an autonomous `progress`/
`deload` decision (Slice 33 returns `hold` with `reasonCodes: ['insufficient_exposure']`)
— per the research bundle's own locked decision, "training gaps enter
calibration; missing data lowers certainty" rather than being papered over
with a confident-looking number.

### Slice 33 — `decideProgression` (deterministic)

```ts
export function decideProgression(exposures: StrengthExposure[], ctx: DecideCtx): ProgressionDecision {
  const calibration = calibrationStateFor(exposures);
  if (calibration !== 'calibrated') {
    return { ...base(ctx), action: 'hold', confidence: 0.3, source: 'deterministic', reasonCodes: ['insufficient_exposure'] };
  }
  const anchor = anchorKgFor(exposures);   // last ON-TARGET exposure — see below
  const recent = exposures.slice(-3);
  const allSuccessful = recent.every(e => e.exposureClass === 'successful' && e.onTarget);
  const repeatedDeterioration = recent.filter(e => e.exposureClass === 'missed').length >= 2;

  if (allSuccessful) {
    return { ...base(ctx), action: 'progress', deltaPct: 0.025, source: 'deterministic', confidence: 0.9, reasonCodes: ['three_on_target'] };
  }
  if (repeatedDeterioration && anchor != null) {
    return { ...base(ctx), action: 'deload', deltaPct: -0.05, source: 'deterministic', confidence: 0.85, reasonCodes: ['repeated_deterioration'] };
  }
  return { ...base(ctx), action: 'hold', confidence: 0.7, source: 'deterministic', reasonCodes: ['mixed_signal'] };
}

function anchorKgFor(exposures: StrengthExposure[]): number | null {
  for (let i = exposures.length - 1; i >= 0; i--) {
    if (exposures[i].onTarget && exposures[i].loadKg != null) return exposures[i].loadKg;
  }
  return null;   // real state, not a fallback to a missed weight — see below
}
```

**The anchor-load rule is the one piece of the old engine that must not be
lost in translation**: a deload is a percentage off the last *successful*
load, never off a load a missed set already walked down within-session.
`anchorKgFor` returning `null` when nothing on record is on-target is a
real, held state — the caller must not fall back to the most recent
(missed) weight, because that fallback IS the double-compounding the rule
exists to prevent. Test, ported directly from the deleted engine's own
suite: a session opened at 100kg, walked down to 94kg by a missed set
within-session, still anchors a deload at 100, not 94.

`deltaPct` values (2.5% / 5%) come from the research bundle's "locked
implementation decisions" verbatim. `reasonCodes` are the only trace of
"why" — deliberately not prose, because nothing surfaces this to the
athlete (the owner's "no explaining" instruction) and a coach reviewing the
history later needs a stable, filterable code, not a sentence that drifts
across engine versions.

---

## Phase F — Knowledge base + retrieval infra (6 slices)

### Slice 34 — `coaching_note` table

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE coaching_note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,        -- the coach who wrote it
  body        text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',   -- 'deload'|'pain'|'plateau'|'nutrition_interaction'|...
  embedding   vector(1024),          -- NULL until Slice 36 backfills it
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coaching_note_embedding_idx ON coaching_note
  USING hnsw (embedding vector_cosine_ops);
```

One row per note — a coach's own written-down judgment ("Athlete missed 2
sessions from illness, RPE was climbing before that — treat as a
legitimate deload trigger, not just a gap"), not a chunked document. This
is what "you + a big information database" actually becomes: the coach's
accumulated calls, searchable, not a single monolithic corpus. `hnsw`
index per pgvector's current recommended default (the `supabase-postgres-
best-practices` skill's guidance, loaded before writing this migration).

### Slice 35 — note authoring UI

Minimal coach-bench screen (`apps/web/src/coach/library/CoachingNotes.tsx`):
a free-text box + tag picker, writing directly to `coaching_note`. No AI
involved in authoring — this is the coach's own knowledge, typed in their
own words. Bulk-import path also lands here: a coach can paste in a large
block of prior notes (e.g. the research bundle's `hybrid_adaptive_evidence_
bundle_2026-08-01.md`), split into one row per paragraph via a simple
blank-line splitter, reviewed before commit — never auto-ingested silently.

### Slice 36 — embedding pipeline

```ts
// Voyage AI's voyage-3 embedding model — Anthropic's own recommended
// embedding provider, since Claude's API does not serve embeddings itself.
export async function embedNote(body: string): Promise<number[]> {
  const res = await voyageClient.embed({ input: [body], model: 'voyage-3' });
  return res.data[0].embedding;
}
```

A Supabase Edge Function (`embed-coaching-note`) triggered on
`coaching_note` insert/update via a `pg_net` webhook, per the `supabase`
skill's pattern for calling out to an external API from a database
trigger — writes the embedding back once computed. Async by design: a
coach's note is saved and usable in the UI immediately; the embedding
(and therefore its retrievability) lands a few seconds later. Test: a note
inserted with `embedding IS NULL` never blocks Slice 35's UI from
confirming the save.

### Slice 37 — retrieval query

```sql
CREATE FUNCTION search_coaching_notes(query_embedding vector(1024), match_count int DEFAULT 5)
RETURNS SETOF coaching_note LANGUAGE sql STABLE AS $$
  SELECT * FROM coaching_note
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

Cosine distance (`<=>`), top-5 default — a number chosen to fit comfortably
inside Slice 40's decision-call context without the retrieval step itself
needing tuning infrastructure; revisit only if Phase H's feedback data
shows retrieval quality, not count, is the bottleneck.

### Slice 38 — query embedding: athlete state → search text

```ts
export function progressionQueryText(exercise: Exercise, exposures: StrengthExposure[], calibration: CalibrationState): string {
  const recent = exposures.slice(-3).map(e => `${e.exposureClass}${e.painFlagged ? ' (pain flagged)' : ''}`).join(', ');
  return `${exercise.name}: calibration=${calibration}, recent exposures: ${recent}`;
}
```

A pure function turning structured state into the text that gets embedded
and searched against — deliberately terse and templated, not free prose,
so the same athlete state always produces the same query (reproducibility,
same discipline as Slice 8's `formula` field in the first spec doc).

### Slice 39 — Phase F test suite + fixture corpus

A seeded set of ~20 synthetic `coaching_note` rows covering the research
bundle's own locked decisions (deload triggers, pain-vs-fatigue, training
gaps), used by every later Phase G/H test so retrieval quality has a fixed
baseline to test against rather than each test hitting the live embedding
API.

---

## Phase G — AI decision call + integration (6 slices)

### Slice 40 — `AiRetrievalDecider`

```ts
export class AiRetrievalDecider implements ProgressionDecider {
  async decide(exposures: StrengthExposure[], calibration: CalibrationState, ctx: DecideCtx): Promise<ProgressionDecision> {
    const notes = await searchCoachingNotes(await embedNote(progressionQueryText(ctx.exercise, exposures, calibration)));
    const det = decideProgression(exposures, ctx);   // Slice 33 — always computed, used as a floor
    if (!notes.length) return { ...det, source: 'ai_retrieval', confidence: det.confidence * 0.8, reasonCodes: [...det.reasonCodes, 'no_relevant_notes'] };
    return callClaudeForDecision(exposures, calibration, notes, det, ctx);
  }
}
```

**The deterministic decision is always computed first and passed in as a
floor, never bypassed.** This is the safety design, not a redundancy: the
AI call can refine or override within reason, but Slice 41's structured
output is validated against Slice 42's guardrails before it's trusted, and
Slice 40 itself falls back to the deterministic result outright when
retrieval finds nothing relevant — an AI call reasoning with zero grounding
is worse than the plain rule engine, not better.

### Slice 41 — structured decision call

```ts
const DECISION_TOOL = {
  name: 'submit_progression_decision',
  input_schema: {
    type: 'object',
    required: ['action', 'confidence', 'reasonCodes'],
    properties: {
      action: { enum: ['progress', 'hold', 'deload', 'retest'] },
      deltaPct: { type: 'number' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasonCodes: { type: 'array', items: { type: 'string' } },
    },
  },
};
```

Forced tool call (`tool_choice: { type: 'tool', name: 'submit_progression_decision' }`)
against the Claude API, per the `claude-api` skill's guidance on structured
output — the model returns exactly this shape or the call is retried, never
freeform text parsed after the fact. Prompt includes: the deterministic
decision (Slice 33) as a stated floor, the retrieved notes (Slice 37,
verbatim, with their `owner_id` and `created_at` so the model can weigh
recency), and the athlete's exposure summary (Slice 38's query text). The
system prompt explicitly instructs: never contradict a `pain_blocked`
exposure's exclusion from load-progression math, never invent a
`reasonCode` not present in the retrieved notes' tags — a hallucinated
justification is worse than an honest `no_relevant_notes`.

### Slice 42 — guardrails

```ts
export function validateAiDecision(ai: ProgressionDecision, det: ProgressionDecision): ProgressionDecision {
  if (ai.action === 'progress' && det.action === 'deload') {
    // AI must never progress load where the deterministic floor says deload —
    // this is the one hard override, matching CLAUDE.md's standing rule that
    // a safety-shaped signal outranks an ordinary readiness/progression call.
    return { ...det, reasonCodes: [...det.reasonCodes, 'ai_overridden_unsafe_progress'] };
  }
  if (Math.abs(ai.deltaPct ?? 0) > 0.10) {
    return { ...det, reasonCodes: [...det.reasonCodes, 'ai_delta_out_of_bounds'] };
  }
  return ai;
}
```

Two hard rules, not a general-purpose sanity checker: the AI can never turn
a deterministic `deload` into a `progress` (the direction that could hurt
someone), and any single-decision delta beyond 10% is rejected outright,
regardless of what the retrieved notes seemed to justify. Everything else
— holding instead of progressing, a smaller deload than 5%, a `retest` call
— is within the AI's real latitude. Test: a synthetic AI response
progressing load against a deterministic deload floor is rejected and the
deterministic result returned, with the override reason code present.

### Slice 43 — background scheduling

Per the owner's "everything is in the background doing the work": decisions
are computed **ahead of the session**, not at logger-open time. A daily job
(Supabase's `pg_cron`, per the `supabase` skill) runs `AiRetrievalDecider`
for every `assigned_session` scheduled for the next day whose exercises are
`calibrated`, writing the result into a new `progression_decision` table
(Slice 44) — so publish-time resolution (Phase A Slice 6/20) can read a
decision that already exists rather than blocking on a live AI call during
publish.

### Slice 44 — `progression_decision` table

```sql
CREATE TABLE progression_decision (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          uuid NOT NULL,
  exercise_id         uuid NOT NULL,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  action              text NOT NULL,
  delta_pct           numeric,
  confidence          numeric NOT NULL,
  source              text NOT NULL,     -- 'deterministic'|'ai_retrieval'
  reason_codes        text[] NOT NULL,
  used_note_ids        uuid[] NOT NULL DEFAULT '{}',  -- Phase H reads this
  applied_to_session_id uuid REFERENCES assigned_session(id)
);
```

`used_note_ids` is the provenance trail Phase H's feedback loop depends on
— without it, "which note led to this call" is unanswerable after the
fact, and a coach reviewing a bad decision has nothing to correct.

### Slice 45 — publish-time consumption

Slice 20's (Phase B) publish action, when the athlete has AI decisions
enabled, reads the most recent `progression_decision` for each exercise
being published and applies its `deltaPct` as an `lwp_delta`-equivalent
target (Phase A Slice 4's resolution pipeline) instead of a coach-typed
literal. A coach can always override before publishing — the decision
pre-fills, it does not lock.

---

## Phase H — Feedback loop (6 slices)

The mechanism that improves the AI over time without retraining: every
decision's real-world outcome gets recorded, and a coach can turn a bad
outcome directly into a new, better `coaching_note` — closing the loop
through the same authoring surface (Slice 35), not a separate ML pipeline.

### Slice 46 — outcome capture

```ts
export function outcomeFor(decision: ProgressionDecision, nextExposure: StrengthExposure | null): 'confirmed' | 'contradicted' | 'pending' {
  if (!nextExposure) return 'pending';
  if (decision.action === 'progress') return nextExposure.onTarget ? 'confirmed' : 'contradicted';
  if (decision.action === 'deload') return nextExposure.onTarget ? 'confirmed' : 'contradicted';
  return 'confirmed';   // 'hold'/'retest' have no wrong outcome to contradict
}
```

Runs whenever a new `StrengthExposure` lands for an exercise with a prior
`progression_decision` — a pure function over data Phase A/E already
produce, no new capture from the athlete.

### Slice 47 — `decision_outcome` table + write path

```sql
CREATE TABLE decision_outcome (
  progression_decision_id uuid PRIMARY KEY REFERENCES progression_decision(id),
  outcome                 text NOT NULL,   -- 'confirmed'|'contradicted'|'pending'
  evaluated_at             timestamptz NOT NULL DEFAULT now()
);
```

Written by the same background job as Slice 43, on its next run after a
new exposure lands.

### Slice 48 — coach review screen

`apps/web/src/coach/library/DecisionReview.tsx`: lists recent
`progression_decision` rows with their `outcome`, filterable to
`contradicted` first (the ones worth a coach's attention). Each row shows
the `used_note_ids` notes inline and a one-click "this call was wrong" →
opens Slice 35's note editor pre-filled with the athlete's exposure context,
so correcting the knowledge base is a single flow, not a context switch.

### Slice 49 — confidence calibration

```ts
export function adjustedConfidence(note: CoachingNote, outcomes: DecisionOutcome[]): number {
  const withThisNote = outcomes.filter(o => o.usedNoteIds.includes(note.id));
  if (withThisNote.length < 3) return 1.0;   // not enough evidence to distrust it yet
  const confirmedRate = withThisNote.filter(o => o.outcome === 'confirmed').length / withThisNote.length;
  return Math.max(0.3, confirmedRate);       // never fully zeroed — a coach can still override by editing the note directly
}
```

A per-note reliability multiplier, applied to Slice 40's `confidence`
output when that note was used — the closest this design gets to "learning"
without ever touching model weights: notes that keep leading to
contradicted outcomes get down-weighted in retrieval ranking (Slice 37's
query gains an `ORDER BY (embedding <=> query) / adjustedConfidence` term),
not deleted. A coach who disagrees with the down-weighting edits the note's
text directly; there's no separate "un-penalize" control, because the note
itself is the thing to fix.

### Slice 50 — pain/illness invariant test

A dedicated adversarial test suite: construct a `coaching_note` corpus that
would, if followed literally, suggest progressing load through a
`pain_blocked` exposure — assert `AiRetrievalDecider` never does, because
`callClaudeForDecision`'s system prompt (Slice 41) and `validateAiDecision`
(Slice 42) both refuse it independently. This is the one place in Phase
G/H that gets doubled guardrails on purpose: CLAUDE.md's standing rule that
pain/illness outrank ordinary progression logic must survive an AI layer
that has never read CLAUDE.md.

### Slice 51 — Phase G/H integration test

End-to-end: seed a `coaching_note` corpus, run `AiRetrievalDecider` against
a synthetic exposure history, assert the decision, simulate the next
session's outcome, assert `decision_outcome` and the confidence adjustment
— the same "golden vector" discipline the first spec's Phase A closes with,
extended to cover the whole retrieval → decide → outcome → adjust loop.

---

## Phase I — Ops, safety rails, closeout (9 slices)

### Slice 52 — per-athlete opt-in

`assigned_session`'s athlete gains a `progression_source` setting
(`'deterministic' | 'ai_retrieval'`, default `'deterministic'`) on their
profile. AI decisions never apply to an athlete who hasn't been switched
on — matches the "coach wins outright" precedent CLAUDE.md already
documents for who-owns-the-week, extended here to who-owns-the-number.

### Slice 53 — coach visibility, not athlete explanation

The owner's "no explaining" is athlete-facing only — a coach reviewing
their own roster (Slice 48) sees the full reasoning trail, because a coach
who can't audit the tool is a coach who can't trust it. The athlete's app
shows only the resulting number, identical in appearance whether it came
from `deterministic` or `ai_retrieval` — no UI branch, no "AI suggested"
badge, per the explicit instruction that this runs invisibly.

### Slice 54 — cost + rate controls

Per-organization daily decision budget (a simple counter in
`organizations`, incremented by Slice 43's job, gating further Claude API
calls once exhausted for the day) — the background-job design means a
runaway loop can't silently rack up API cost against a coach's roster
without a ceiling that fails safe (falls back to `DeterministicDecider`
when exhausted, never blocks publishing).

### Slice 55 — latency budget

Slice 43's background job is explicitly the reason live-request latency
never becomes a problem — documented here as a constraint the design
depends on: nothing in Phase B/C's publish or logging path makes a
synchronous Claude API call. If a decision is missing at publish time
(job hasn't run yet, e.g. a same-day session), publish falls back to
`DeterministicDecider` inline rather than blocking on a live AI call.

### Slice 56 — corpus growth path

`coaching_note` has no ceiling built into this design — `hnsw` indexing
(Slice 34) scales to the tens of thousands of rows range without a
redesign, well past what one coach's roster will produce in years. Noted
explicitly so a future reader doesn't mistake the lack of a pagination/
archival slice here for an oversight — at this scale it's genuinely not
needed yet.

### Slice 57 — audit log

Every `progression_decision` is permanent and immutable (no UPDATE path in
the schema — a correction happens by writing a new decision, never editing
history) so a later dispute about "what did the system tell this athlete
to lift" has a real, unedited record. Matches this repo's existing
event-sourcing discipline (`working_max_event`, `pr_event` in the first
spec doc) rather than introducing a new pattern.

### Slice 58 — `@hybrid/coach-brain` test suite

Full unit coverage for Slices 34-51's pure functions plus the mocked-
Claude-API integration tests (Slice 51) — no live API calls in CI, per
this repo's existing discipline of not depending on external network
calls inside `pnpm run verify`.

### Slice 59 — CLAUDE.md + README

Dated section recording the adaptive engine V2 build, the seam design, and
the explicit scope boundary ("the AI decides silently in the background;
it is never a chat surface; pain/illness always outrank it") — matching
every prior deletion/rebuild's own dated-record convention. `README.md`
gains `@hybrid/coach-brain` to its package tree; `checks/docs.mjs` re-run.

### Slice 60 — closeout

`pnpm run verify` green, `checks/screens.mjs` covers Slice 48's new
`DecisionReview` route, full 60-slice series (this doc + the first) marked
complete in `handoff.md`'s checkpoint.

---

## Explicitly rejected

Fine-tuning a custom model (ruled out this session — no labeled-example
volume, no training infra). A chat/explanation surface for the athlete
(ruled out — "no explaining"). A synchronous AI call in the publish or
logging path (ruled out — Slice 43/55's background-job design exists
specifically to avoid this). Letting the AI override a safety-shaped
deload (ruled out — Slice 42's hard guardrail).

## Dependency graph

Phase E depends only on the first spec's Phase A (needs `performed_set`/
`performed_measurement`, `StrengthExposure`'s inputs). Phase F depends on
nothing but the `vector` extension and a coach willing to write notes —
can be built in parallel with Phase E. Phase G depends on both E (the
deterministic floor) and F (retrieval). Phase H depends on G producing
real decisions to evaluate. Phase I is closeout, last by construction, same
as the first spec's Phase D.
