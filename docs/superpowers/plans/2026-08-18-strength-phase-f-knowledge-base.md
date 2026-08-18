# Strength Rebuild — Phase F (Knowledge Base + Retrieval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the coaching-notes knowledge base and its retrieval
infrastructure — the `coaching_note` table with `pgvector` embeddings, the
Voyage AI embedding call, the cosine-similarity search function, and the
pure function that turns an athlete's current state into search text. No
reasoning/decision call (that's Phase G, on hold pending a model/hosting
decision — see the spec's build-order note).

**Architecture:** A Postgres table + `pgvector` index (data layer, additive
migration), a Supabase Edge Function for the async embedding call (isolated
from the pure-TS package — this is I/O, unlike everything Phase A/E ship),
and one new pure-function file in the existing `@hybrid/strength-engine`
package for the query-text template.

**Scope note:** the spec's Slice 35 ("note authoring UI" — a coach-bench
screen for writing notes) is explicitly OUT of this plan. It's UI, and per
the owner's direction this session, coach/mobile UI work is its own
separate build, done after the current non-UI sweep. This plan ships
Slices 34, 36, 37, 38, 39 only — the backend a UI would sit on top of, not
the UI itself. A coach cannot write a note through this plan's work alone;
that's Phase B/coach-UI's job later.

**Tech Stack:** Postgres + `pgvector`, Supabase Edge Functions (Deno), Voyage
AI's `voyage-3` embedding model (Anthropic's own recommended embedding
provider — Claude's API does not serve embeddings itself), TypeScript,
Vitest.

## Global Constraints

- Additive-only SQL. This plan's migration is
  `supabase/migrations/20260819_phase_f_knowledge_base.sql` — a NEW file,
  following the exact precedent Phase E's fix wave just established (never
  edit an already-shipped migration in place; a new additive file is always
  safe).
- Colocated tests only for the TS package work (`src/foo.ts` /
  `src/foo.test.ts`). The Edge Function is not part of `@hybrid/strength-engine`
  and is tested separately (Task 2's own test approach, since it's Deno
  runtime code, not Vitest/Node).
- No live network calls inside `pnpm run verify` / CI — this repo's
  standing discipline (documented in CLAUDE.md's "Safe workflow" section
  for every other check). The embedding call is mocked in tests.
- `hnsw` is the pgvector index type, per the spec's explicit choice
  (Supabase's currently recommended default over `ivfflat`).
- Full source: `docs/superpowers/specs/2026-08-17-adaptive-engine-v2-design.md`,
  Phase F (Slices 34-39).

---

### Task 1: `coaching_note` table + pgvector index

**Files:**
- Create: `supabase/migrations/20260819_phase_f_knowledge_base.sql`

**Interfaces:**
- Produces: the `coaching_note` table — Task 2 (embedding pipeline) writes
  its `embedding` column; Task 3 (retrieval query) reads it.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260819_phase_f_knowledge_base.sql
-- ============================================================================
-- PHASE F — coaching-notes knowledge base. Additive only. Does not touch
-- 20260818_strength_rebuild.sql, 20260819_phase_e_pain_metric.sql, or
-- anything else. See docs/superpowers/specs/2026-08-17-adaptive-engine-v2-
-- design.md, Phase F (Slices 34, 36-39 — Slice 35's authoring UI is a
-- separate, later, UI-track build).
-- ============================================================================

create extension if not exists vector;

create table coaching_note (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  body        text not null,
  tags        text[] not null default '{}',
  embedding   vector(1024),
  created_at  timestamptz not null default now()
);

create index coaching_note_embedding_idx on coaching_note
  using hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 2: Apply the migration locally and verify it applies clean**

Run: `node checks/migrations-apply.mjs`
Expected: all migrations, including this new one, apply without error. If
the `vector` extension isn't available in whatever Postgres this check
spins up locally, the check's own output will say so explicitly — if that
happens, note it in your report rather than guessing at a workaround; this
is exactly the class of "a check that spins up its own Postgres tests the
schema, not the platform" gap CLAUDE.md already documents for pgcrypto, and
`hnsw`/`vector` may hit the same local-vs-Supabase mismatch. Supabase's
hosted Postgres has `pgvector` preinstalled; a bare local one may not.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260819_phase_f_knowledge_base.sql
git commit -m "Add coaching_note table + pgvector index (Slice 34)"
```

---

### Task 2: Embedding pipeline (Edge Function)

**Files:**
- Create: `supabase/functions/embed-coaching-note/index.ts`
- Create: `supabase/functions/embed-coaching-note/index.test.ts` (or this
  repo's established pattern for testing an Edge Function in isolation —
  check whether any existing `supabase/functions/*/` directory already has
  a test file and match its exact pattern; if none exists yet, write a
  pure-function unit test for the embedding-request-building logic,
  factored out so it doesn't require a live Deno runtime to test)

**Interfaces:**
- Consumes: `coaching_note.id`/`body` (Task 1's table, read via a
  `pg_net`-style trigger payload or direct invocation — see Step 1).
- Produces: writes `coaching_note.embedding` — Task 3's retrieval query
  depends on this column being populated.

- [ ] **Step 1: Check this repo's existing Edge Function pattern**

Run: `ls supabase/functions/ 2>/dev/null`

If Edge Functions already exist in this repo, read one end-to-end (its
`index.ts`, how it reads its Supabase client, how secrets/env vars are
accessed, how the repo tests it if at all) and match that exact pattern for
structure and secret access. If this repo has no Edge Functions yet, this
is the first one — use Supabase's standard Deno Edge Function shape:

```ts
// supabase/functions/embed-coaching-note/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Voyage AI's voyage-3 embedding model — Anthropic's own recommended
// embedding provider, since Claude's API does not serve embeddings itself.
// Async by design: a coach's note is saved and usable in the UI immediately
// (Slice 35, a later build); the embedding — and therefore retrievability —
// lands a few seconds later via this function.
async function embedText(body: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: [body], model: 'voyage-3' }),
  });
  if (!res.ok) throw new Error(`Voyage embed failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data[0].embedding;
}

Deno.serve(async (req) => {
  const { record } = await req.json(); // { record: { id, body } } — webhook payload shape
  const voyageKey = Deno.env.get('VOYAGE_API_KEY');
  if (!voyageKey) return new Response('VOYAGE_API_KEY not configured', { status: 500 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const embedding = await embedText(record.body, voyageKey);

  const { error } = await supabase
    .from('coaching_note')
    .update({ embedding })
    .eq('id', record.id);

  if (error) return new Response(JSON.stringify(error), { status: 500 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
```

- [ ] **Step 2: Extract the pure request-shaping logic into something testable without a live Deno server**

Since `embedText`'s HTTP call itself can't run in CI (no live network calls
allowed), split out the request body construction as its own pure function
and test THAT:

```ts
// append to the same file, or a sibling _requestShape.ts if this repo's
// Edge Function convention prefers that — match whatever Step 1 found:
export function voyageRequestBody(text: string): { input: string[]; model: string } {
  return { input: [text], model: 'voyage-3' };
}
```

```ts
// supabase/functions/embed-coaching-note/index.test.ts
import { describe, it, expect } from 'vitest';
import { voyageRequestBody } from './index';

describe('voyageRequestBody', () => {
  it('wraps the text in a single-element input array with the voyage-3 model', () => {
    expect(voyageRequestBody('deload when RPE climbs 3 sessions running')).toEqual({
      input: ['deload when RPE climbs 3 sessions running'],
      model: 'voyage-3',
    });
  });
});
```

Note: this test file lives outside `@hybrid/strength-engine`'s own
`vitest.config.ts` scope (it's under `supabase/functions/`, a Deno
directory) — check this repo's root `package.json`/CI config for whether
there's already a way root-level Vitest picks up tests outside package
directories (e.g. a root `vitest.config.ts` or a `pnpm run test` script
that globs beyond `packages/*`). If nothing already covers
`supabase/functions/`, add this file to whatever collects it, or note
in your report that this test exists but isn't wired into `pnpm run test`
yet and flag it as a real gap for Task 6 (Phase F's own closing test-suite
task) to fix — don't silently leave a written-but-uncollected test.

- [ ] **Step 3: Run the test**

Run whatever command Step 2 determined actually collects this test (likely
`pnpm run test` from repo root if wired in, otherwise a Deno-native test
runner if this repo has one — check `deno.json`/`supabase/functions/deno.json`
if present).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/embed-coaching-note/
git commit -m "Add coaching-note embedding pipeline (Slice 36)"
```

---

### Task 3: Retrieval query

**Files:**
- Modify: `supabase/migrations/20260819_phase_f_knowledge_base.sql` (append)

**Interfaces:**
- Consumes: `coaching_note.embedding` (Task 1's column, populated by Task 2).
- Produces: `search_coaching_notes(query_embedding, match_count)` SQL
  function — Task 5's `AiRetrievalDecider` (Phase G, on hold, not part of
  this plan) would call this when it's built.

- [ ] **Step 1: Append the SQL**

```sql
-- Slice 37: cosine-distance retrieval. top-5 default is chosen to fit
-- comfortably inside a decision call's context without needing tuning
-- infrastructure; revisit only if real usage data shows retrieval quality,
-- not count, is the bottleneck.
create function search_coaching_notes(query_embedding vector(1024), match_count int default 5)
returns setof coaching_note language sql stable as $$
  select * from coaching_note
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

- [ ] **Step 2: Apply and verify**

Run: `node checks/migrations-apply.mjs`
Expected: applies clean, function created.

Sanity-check the function directly against the local Postgres this check
spins up (if the check gives you a connection string/way to run ad hoc
SQL — check the script's own output or source for how; if it doesn't expose
one, skip this manual check and rely on Step 2's apply-clean result plus
Task 4's integration test instead):

```sql
insert into coaching_note (id, owner_id, body, embedding) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'test note', array_fill(0.1, array[1024])::vector);
select * from search_coaching_notes(array_fill(0.1, array[1024])::vector, 5);
```
Expected: the inserted row comes back.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260819_phase_f_knowledge_base.sql
git commit -m "Add coaching-note retrieval query (Slice 37)"
```

---

### Task 4: Query text builder

**Files:**
- Create: `packages/strength-engine/src/queryText.ts`
- Create: `packages/strength-engine/src/queryText.test.ts`

**Interfaces:**
- Consumes: `StrengthExposure`, `ExposureClass` (`exposure.ts`, Phase E);
  `CalibrationState` (`calibration.ts`, Phase E); `Exercise` (`exercise.ts`,
  Phase A).
- Produces: `progressionQueryText()` — a future `AiRetrievalDecider`
  (Phase G, on hold) would embed this text and pass it to Task 3's search
  function.

- [ ] **Step 1: Write the failing test**

```ts
// packages/strength-engine/src/queryText.test.ts
import { describe, it, expect } from 'vitest';
import { progressionQueryText } from './queryText';
import type { Exercise } from './exercise';
import type { StrengthExposure } from './exposure';

const squat: Exercise = {
  id: 'sq', ownerId: null, name: 'Back Squat', videoAssetId: null, cues: null,
  equipment: null, defaultMetrics: ['reps', 'load'], referenceMaxExerciseId: null,
  trackAsExerciseId: null, e1rmFormula: 'epley',
};

function exposure(overrides: Partial<StrengthExposure>): StrengthExposure {
  return {
    exerciseId: 'sq', assignedSessionId: 'as1', reps: 5, loadKg: 100, rated: true,
    onTarget: true, painFlagged: false, exposureClass: 'successful',
    performedSetId: 'p1', performedAt: '2026-08-20T10:00:00Z', ...overrides,
  };
}

describe('progressionQueryText', () => {
  it('names the exercise, calibration state, and recent exposure classes', () => {
    const exposures = [
      exposure({ performedSetId: 'p1', exposureClass: 'successful', performedAt: '2026-08-10T10:00:00Z' }),
      exposure({ performedSetId: 'p2', exposureClass: 'missed', performedAt: '2026-08-15T10:00:00Z' }),
      exposure({ performedSetId: 'p3', exposureClass: 'missed', performedAt: '2026-08-20T10:00:00Z' }),
    ];
    const text = progressionQueryText(squat, exposures, 'calibrated');
    expect(text).toBe('Back Squat: calibration=calibrated, recent exposures: successful, missed, missed');
  });

  it('flags a pain-flagged exposure inline', () => {
    const exposures = [exposure({ exposureClass: 'pain_blocked', painFlagged: true })];
    const text = progressionQueryText(squat, exposures, 'building');
    expect(text).toBe('Back Squat: calibration=building, recent exposures: pain_blocked (pain flagged)');
  });

  it('only names the last 3 exposures, oldest of the window first', () => {
    const exposures = Array.from({ length: 5 }, (_, i) => exposure({
      performedSetId: `p${i}`,
      exposureClass: i < 3 ? 'missed' : 'successful',
      performedAt: `2026-08-${10 + i}T10:00:00Z`,
    }));
    const text = progressionQueryText(squat, exposures, 'calibrated');
    expect(text).toBe('Back Squat: calibration=calibrated, recent exposures: missed, successful, successful');
  });

  it('is deterministic — the same inputs always produce the same text, so the same query embeds the same way', () => {
    const exposures = [exposure({})];
    expect(progressionQueryText(squat, exposures, 'building')).toBe(progressionQueryText(squat, exposures, 'building'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test queryText.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/strength-engine/src/queryText.ts
import type { Exercise } from './exercise';
import type { StrengthExposure } from './exposure';
import type { CalibrationState } from './calibration';

/**
 * Turns structured athlete state into the text a future decision call would
 * embed and search against. Deliberately terse and templated, not free
 * prose — the same athlete state must always produce the same query
 * (reproducibility, same discipline as the e1RM `formula` field carrying
 * its own provenance).
 */
export function progressionQueryText(exercise: Exercise, exposures: StrengthExposure[], calibration: CalibrationState): string {
  const recent = exposures.slice(-3).map(e =>
    e.painFlagged ? `${e.exposureClass} (pain flagged)` : e.exposureClass
  ).join(', ');
  return `${exercise.name}: calibration=${calibration}, recent exposures: ${recent}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test queryText.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add to the package barrel**

```ts
// packages/strength-engine/src/index.ts — append:
export * from './queryText';
```

Add one assertion to the existing barrel-completeness test in
`packages/strength-engine/src/index.test.ts`:
```ts
expect(typeof engine.progressionQueryText).toBe('function');
```

- [ ] **Step 6: Commit**

```bash
git add packages/strength-engine/src/queryText.ts packages/strength-engine/src/queryText.test.ts packages/strength-engine/src/index.ts packages/strength-engine/src/index.test.ts
git commit -m "Add progression query-text builder (Slice 38)"
```

---

### Task 5: Fixture corpus

**Files:**
- Create: `packages/strength-engine/test/fixtures/coaching-notes.json`

**Interfaces:**
- Consumes: nothing (static data).
- Produces: a seeded set of ~20 synthetic `coaching_note`-shaped rows —
  Task 6's own test suite reads this for a fixed retrieval baseline; a
  future Phase G test suite (not part of this plan) would reuse it too.

- [ ] **Step 1: Write the fixture file**

```json
[
  { "body": "Two consecutive missed sessions with no illness or travel and RPE climbing on the top set is a real deload trigger, not just a bad week.", "tags": ["deload"] },
  { "body": "A single poor session on its own — bad sleep, one missed set — does not independently justify a deload. Hold and re-test next session.", "tags": ["deload", "hold"] },
  { "body": "Pain is a separate safety pathway from ordinary fatigue. A pain-flagged set is excluded from progression math entirely, never treated as a miss to average against.", "tags": ["pain"] },
  { "body": "Training gaps (missed weeks, illness, travel) lower confidence in a working max rather than being ignored — treat the exercise as building, not calibrated, after a real gap.", "tags": ["calibration", "gaps"] },
  { "body": "Default progression is 2.5% of the last stable opening load, with equipment-aware rounding — never a raw arithmetic bump that lands off-increment.", "tags": ["progression"] },
  { "body": "Default reactive reduction is 5% from the last successful anchor, not from wherever a bad set within the same session already walked the load down to.", "tags": ["deload", "anchor"] },
  { "body": "If the available equipment jump between increments is too large for a clean 2.5% step, prefer adjusting reps or RPE target instead of forcing an oversized load jump.", "tags": ["progression", "equipment"] },
  { "body": "Unrated (no RPE logged) successful sets are real evidence of completion but not of readiness — don't progress load on unrated sessions alone.", "tags": ["progression", "rpe"] },
  { "body": "A missed top set followed by two clean backoff sets at reduced load is still a missed exposure for that top-set weight — don't let backoff success mask a real miss.", "tags": ["missed"] },
  { "body": "Three consecutive on-target, rated sessions is the calibration floor before trusting an autonomous progress or deload call for that exercise.", "tags": ["calibration"] },
  { "body": "An athlete who consistently exceeds the prescribed rep target at the same load is a candidate for a bigger jump next session, not just the default 2.5%.", "tags": ["progression"] },
  { "body": "Bodyweight-percentage-prescribed exercises (e.g. weighted pull-ups) should re-price off current bodyweight, not a stale figure from weeks ago.", "tags": ["bodyweight"] },
  { "body": "A coach-set or test-result working max should hold until superseded by another manual event — don't let an auto-estimate quietly overwrite a deliberately tested number.", "tags": ["working-max"] },
  { "body": "Illness lasting more than a few days should reset calibration for affected exercises, not just count as one more gap in the exposure window.", "tags": ["gaps", "illness"] },
  { "body": "A PR at a rep count the athlete rarely trains (e.g. a 1-rep max attempt during an 8-rep block) shouldn't itself trigger a working-max update unless it was a declared test.", "tags": ["pr", "working-max"] },
  { "body": "Swapping an exercise mid-block (e.g. front squat for back squat) resets exposure history for progression purposes — they are different exercises even if related by reference-max.", "tags": ["exercise-swap"] },
  { "body": "A session logged well outside the athlete's normal training days (e.g. a make-up session) still counts as a real exposure — don't discount it just because of timing.", "tags": ["scheduling"] },
  { "body": "Optional sets that go uncompleted should never count against compliance or feed a missed-exposure classification — they were never required.", "tags": ["compliance", "optional"] },
  { "body": "A tempo-prescribed set performed noticeably faster than prescribed (rushed eccentric) is a real form deviation worth a coaching note, even if the load and reps were technically hit.", "tags": ["tempo", "form"] },
  { "body": "Repeated RPE creep at the same prescribed load across several sessions (getting harder without the number changing) is an early deload signal, even before a set is actually missed.", "tags": ["deload", "rpe"] }
]
```

- [ ] **Step 2: Commit**

```bash
git add packages/strength-engine/test/fixtures/coaching-notes.json
git commit -m "Add coaching-notes fixture corpus (Slice 39, part 1)"
```

---

### Task 6: Phase F test suite + full verification

**Files:**
- Create: `packages/strength-engine/src/queryText.test.ts` (already created
  in Task 4 — this task is about the CROSS-cutting verification, not new
  query-text tests)
- Modify: none (verification-only task, plus resolving Task 2's Step 2
  coverage gap if it was flagged)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: nothing new — this is Phase F's closing gate, matching Phase A
  and Phase E's own closing-task pattern.

- [ ] **Step 1: Resolve Task 2's coverage gap if one was flagged**

If Task 2's report noted that `supabase/functions/embed-coaching-note/index.test.ts`
isn't collected by any existing `pnpm run test` invocation, fix that now —
find the right place to wire it in (a new `vitest.config.ts` scoped to
`supabase/functions/`, or an addition to the root test script) rather than
leaving a written test that silently never runs. If Task 2 already wired
it in successfully, skip this step (note "already wired" in your report).

- [ ] **Step 2: Run the full package suite**

Run: `pnpm --filter @hybrid/strength-engine test && pnpm --filter @hybrid/strength-engine typecheck`
Expected: PASS — Phase A (55) + Phase E (88) + Phase F's `queryText.test.ts`
(4) all green, no regressions.

- [ ] **Step 3: Run repo-wide verification**

Run: `pnpm run typecheck && pnpm run test && pnpm run check:ecosystem`
Expected: all green. This task's changes are additive (new migration, new
Edge Function, one new TS file, one new fixture) and shouldn't touch any
existing consumer, but confirm rather than assume — same discipline as
every prior phase's closing task.

- [ ] **Step 4: Run the migrations-apply check specifically**

Run: `node checks/migrations-apply.mjs`
Expected: every migration in the repo, including both this plan's file and
every prior one, applies cleanly in order from scratch. This is the
strongest available proof the whole migration history — Phase A, Phase E's
fix wave, and Phase F — composes as one coherent schema.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Phase F closeout: verification + any coverage-gap fix (Slice 39, part 2)"
```

(If Step 1 found nothing to fix and Steps 2-4 are simply green with no code
changes, this commit may be empty-diff — in that case, skip committing and
note in your report that Phase F closed clean with no fixes needed.)

---

## Self-Review Notes

**Spec coverage**: Slice 34 (table+index) → Task 1. Slice 35 (authoring UI)
→ explicitly OUT of scope, deferred to the coach/mobile UI build per the
owner's direction. Slice 36 (embedding pipeline) → Task 2. Slice 37
(retrieval query) → Task 3. Slice 38 (query-text builder) → Task 4. Slice
39 (fixture corpus + test suite) → Tasks 5-6.

**Not in this plan, by design**: Phase G onward (the AI decision call
itself, guardrails, scheduling, feedback loop) — on hold per the spec's
build-order note, no model/hosting decision made. This plan only builds
the knowledge base and retrieval machinery a future decision call would
read from; nothing in this plan can decide anything on its own.

**Type consistency checked**: `progressionQueryText`'s parameters
(`Exercise`, `StrengthExposure[]`, `CalibrationState`) match Phase A's
`Exercise` (`exercise.ts`) and Phase E's `StrengthExposure`/
`CalibrationState` (`exposure.ts`/`calibration.ts`) exactly — no new shapes
invented for data that already has a canonical type. `search_coaching_notes`'s
`vector(1024)` parameter matches `coaching_note.embedding`'s column type
(Task 1) and Voyage's `voyage-3` output dimensionality (Task 2's comment).

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-18-strength-phase-f-knowledge-base.md`.**
