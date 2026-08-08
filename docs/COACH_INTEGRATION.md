# Building the coach front end — what the app side already decides for you

For whoever is building the coach PWA. This is the integration boundary: what
exists, what it will and will not give you, and the four rules that are not
yours or mine to change.

Written 7 August 2026 against `main` @ `a8ff104`. Every claim here was checked
against the code, not recalled. Where this disagrees with the code, the code
wins and the disagreement is worth reporting.

## Read this first, because it invalidates the obvious design

**There is no multi-athlete data access. None. Not "not wired up yet" — the
policies do not exist.**

Every row-level security policy in `supabase/migrations/` is the same shape:

```sql
create policy athlete_core_select on public.athlete_core
  for select using (auth.uid() = user_id);
```

That is `athlete_core`, `athlete_domain_snapshots`, `athlete_events` and
`athlete_weekly_plans`. There is no coach role, no `coach_athletes` join table,
no policy anywhere granting one user another user's rows.

Check it rather than believe me — there are 26 `create policy` statements
across the migrations, and two of them read `using (true)`, which looks like a
hole until you see which tables they are on:

- `foods` and `food_servings` — the SHARED food catalogue. Reference data every
  athlete reads, read-only to clients, written only by a service-role importer.
  Not athlete data.
- Every other policy resolves to `auth.uid()`, either directly or through a
  parent-table `exists (...)` join (`recipe_items` → `recipes.user_id`,
  `macro_program_days` → `macro_programs.user_id`).

`checks/migrations-apply.mjs` proves this against a real Postgres with two
signed-in athletes, including six cross-owner write attempts. Run it.

So a coach UI that signs in as the coach and fetches athlete X's data gets an
empty result set, not an error — RLS filters rows, it does not raise. **A
silently empty screen is the failure mode**, which is the worst kind to debug.

What the existing bench at `/coach` actually is: **a different lens on the
signed-in user's own data.** Every panel reads `useDb()` — the same local store
the athlete dashboard reads. Nothing under `apps/web/src/coach/` talks to
Supabase at all; confirm with `grep -rn "supabase\|\.rpc(" apps/web/src/coach/`,
which returns nothing.

`VITE_COACH_USER_IDS` reinforces this. It is an allowlist of Supabase user ids
that decides **who sees the /coach UI** — not whose data they see. It is a UI
gate, not an authorization boundary. See `apps/web/src/coach/guard.ts`.

### What this means for you

Pick one, knowing the cost:

1. **Single-athlete bench** (what exists). The coach and the athlete are the
   same account. Ship a better lens on that data and nothing server-side
   changes.
2. **Real multi-athlete.** Needs new tables, new policies, a coach↔athlete
   relationship model, and a data path that does not exist today. That is a
   backend project with an RLS design review, not a front-end task. The data
   model was deliberately kept multi-athlete-SHAPED, so this is anticipated —
   but it is not built.

Do not design for (2) and assume (1) will stretch. It will not.

## Three worlds, two authority models — this is the product

This is not a strength app with cardio and a food log bolted on. Get this wrong
and the coach surface is generic, which is the most likely way to build the
wrong thing while ticking every box.

```
WorldId = ProductId | 'nutrition'
ProductId = 'strength' | 'conditioning'     <- the two TRAINING identities
SessionDomain = 'strength' | 'conditioning' <- what the Coordinator arbitrates
```

Three worlds in one install, three sync partitions
(`SYNCED_SNAPSHOT_DOMAINS = ['strength', 'conditioning', 'nutrition']`), and
**two different authority models over them**:

- **Strength and Conditioning are ARBITRATED against each other.** They are two
  engines proposing sessions into one week and one body. The Coordinator
  resolves the conflict. That conflict IS the hybrid problem — the reason this
  system exists rather than two apps.
- **Nutrition is NOT arbitrated.** The Coordinator has no knowledge of it —
  `grep -rin nutrition packages/coordinator/src/*.ts` returns nothing outside
  its boundary test, and that is enforced deliberately. Nutrition runs
  alongside with its own prescription domain (`nutrition-engine`) and feeds
  training only as CONTEXT, through `whole-athlete-state`.

So a coach view is not one list of sessions with a food log beside it. It is
two competing training domains whose conflict was resolved by a deterministic
engine, plus a third domain that informs but never competes.

### The Coordinator already tells you WHY, and this is the material

`reconcileWeeklyPlan` returns a `WeeklyPlan` carrying `decisions:
PlanDecision[]`, one per proposal:

```ts
interface PlanDecision {
  proposalId: string;
  action: 'scheduled' | 'dropped';
  reasonCode: PlanReasonCode;
  explanation: string;
}
```

And the reason codes are a complete account of the week:

| Code | What it means |
|---|---|
| `accepted` / `locked_existing` | It made the week |
| `dropped_illness_safety` / `dropped_pain_safety` | A SAFETY flag removed it — outranks everything |
| `dropped_interference` | It collided with another domain's session — the hybrid trade-off, made explicit |
| `dropped_spacing` | Too close to a session it must be spaced from |
| `dropped_domain_cap` / `dropped_weekly_cap` | The strength/conditioning balance or the weekly ceiling |
| `dropped_no_available_slot` | The athlete's schedule had nowhere to put it |

Proposals also carry `InterferenceTag`s — `heavy_lower`, `high_intensity`,
`upper`, `easy_aerobic`, `full_body`, `pain_sensitive` — which is how
interference is actually computed.

**A coach surface that shows only what got scheduled is throwing away the
interesting half.** What a coach needs is what COMPETED and lost: the squat
session that was dropped because Thursday's intervals were already
`high_intensity`, the run dropped for spacing, the whole day cleared by a pain
flag. That is the conversation with the athlete, and the engine already emits
it — nobody has to infer it.

`apps/web/src/coach/DecisionTrace.tsx` and `trace.ts` are the existing attempt
at rendering this. Read them before rebuilding: they are where the reason codes
get grouped against the constraints that caused them.

## The four rules that are fixed

These are from `CLAUDE.md`, which is binding. A design that breaks one of them
cannot be merged, however good it looks.

1. **The Coordinator alone picks the weekly plan.** It is deterministic. The
   coach steers by changing INPUTS — goals, schedule, constraints — and never
   hand-places a session into a resolved plan. If your design has the coach
   dragging a session onto Thursday, it is the wrong design for this system.
2. **`auto-coach` may adjust ONE session within an athlete-set policy.** Every
   adjustment is recorded and the athlete can undo it. It never programs a week
   and never overrides the Coordinator.
3. **Pain and illness are safety flags, not readiness penalties.** They outrank
   every other signal — readiness score, wearable metric, nutrition figure. HRV
   must never be used as a pain, injury or illness gate.
4. **Nutrition is CONTEXT, never an instruction.** `whole-athlete-state` may
   read nutrition facts (energy availability, adherence) to shape constraints.
   It must not read a nutrition target as a directive, and nutrition never
   edits a weekly plan.

## What you can read, and from where

The bench composes from these packages. All are consumed as raw TypeScript
source — there is no build step, `main` points at `./src/index.ts`.

| Package | Gives you |
|---|---|
| `@hybrid/engine` | The training data model, sessions, workouts, merge and sync primitives |
| `@hybrid/whole-athlete-state` | Recovery/life context turned into CONSTRAINTS |
| `@hybrid/coordinator` + `-adapter` | The resolved weekly plan and the projection into it |
| `@hybrid/auto-coach` | The autonomy policy and the one-session resolver |
| `@hybrid/nutrition-adapter` | The ONE projection from `NutritionDB` to every reader. Reads only |

`nutrition-adapter` is where the nutrition FACTS `whole-athlete-state` may see
are separated from the TARGETS it may not. Go through it; do not reach into
`NutritionDB` yourself.

## The PWA trap — RESOLVED (8 August 2026)

This section used to warn that `apps/web/vite.config.ts` excluded ALL of
`/coach` from `navigateFallback`, with a stale comment claiming the coach was
"a different app at the same origin" — wrong even then, since it is a lazy
chunk of the same SPA (`apps/web/src/App.tsx`:
`const Coach = lazy(() => import('./coach'))`, routed at `/coach/*`).

That has since been fixed with a real answer to "what should offline even
mean for a coach view", not just a blanket unblock:

```js
navigateFallbackDenylist: [
  /^\/\.netlify\//,
  // Review routes are part of this SPA and are safe to reopen from its
  // precached shell. Progression decisions are explicitly local demo
  // records; the screen labels that boundary. Keep authoring and the
  // mutation-heavy legacy bench online-only until a real outbox exists.
  /^\/coach(?:\/?$|\/(?!(?:review|nutrition|progression)(?:\/|$)).*)/,
],
```

`/coach/review`, `/coach/nutrition` and `/coach/progression` — the three
read-oriented ARC layer-3 routes — now reopen from the precached shell
offline. `/coach` (the command centre), `/coach/author`,
`/coach/roster-plan`, `/coach/build`, `/coach/planner` and `/coach/legacy`
stay online-only, deliberately: those are the mutation-heavy routes, and
there is still no offline outbox that could replay a save/publish/decision
made while disconnected. If you add a new mutation-heavy `/coach/*` route,
it is denylisted by default (the pattern only ALLOWS the three named
prefixes) — check that default is still what you want before shipping.

## Practical facts

- `/coach` is a lazy chunk, so athletes never download it. Keep it that way —
  it is why a failure in the bench cannot take down the athlete's app.
- It has its own stylesheet, `apps/web/src/coach/coach.css`.
- **Tests are colocated**: `src/coach/diff.ts` is tested by
  `src/coach/diff.test.ts`, in the same directory. Nothing test-shaped goes in
  a `test/` directory any more — that was verified as of `a8ff104`.
- Web and packages use **Vitest**; the mobile app uses **Jest with injected
  globals**. Mixing them up is the most common failure when adding a test.
- The coach bench has **no render tests**. Its logic is unit-tested; roughly
  2,700 lines of UI are exercised only by `checks/react-smoke.mjs`, which
  drives real Chromium. If you rebuild the UI, that check is what will catch
  you, so read it before you rename things.

## Before you hand work back

```bash
pnpm install
pnpm run typecheck          # 17 projects
pnpm run test               # all suites
pnpm run build              # web
node checks/react-smoke.mjs # real Chromium, includes the coach bench
node checks/docs.mjs        # every path named in README still resolves
```

`checks/` holds executable invariants and is more authoritative than any prose,
including this file.

## Questions worth asking before building

1. Single-athlete lens, or real multi-athlete? Everything else follows from
   this, and (2) is a backend project first.
2. Does the design show the week as a SCHEDULE, or as a set of RESOLVED
   CONFLICTS between strength and conditioning? Only the second is this
   product. If the coach cannot see what lost and why, the surface is generic.
3. Where does nutrition sit? Beside training as context — never merged into the
   same authority, never arbitrated by the Coordinator, never presented as
   though a macro target caused a training decision.
4. What does the coach DO with what they see — is the output a decision, a
   message to the athlete, or a change to next week's inputs? The Coordinator
   constraint means it has to be the third, expressed as inputs.
5. What should `/coach` do offline?

## Implemented progression-review contract (8 August 2026)

The web front end now treats Strength and Conditioning progression as an
explicit coach decision rather than a side effect of completing work.

- `apps/web/src/coach/progression.ts` owns the pure typed proposal contract.
  Strength reuses `liftMoves`; Conditioning reuses `conAdapt` and
  `explainConAdapt`. The UI does not invent a second progression algorithm.
- `apps/web/src/coach/progression-store.ts` is a local demonstration adapter.
  Proposals and decision events are separate append-only arrays under
  `hybrid-coach-progression-v1`.
- `/coach/progression` renders both domains using Status → Intent → Change →
  Reason → Next. It requires a rationale for approve, reject, or hold.
- An approval applies only when the accepted prescription still matches the
  proposal's recorded before-state. A stale proposal is held; it is never
  last-write-wins.
- A pain stop, active pain hold, or illness constraint creates a review state.
  It cannot be approved as progression.
- Completing a Strength session no longer writes `settings.liftProgress`.
  Completing a Conditioning session no longer writes `settings.conProgress`.
  The in-session Logger still explains its computed adjustment, but no longer
  silently prefills the next set from that result.

This is a front-end contract, not a security boundary. The local coach ledger
does not sync and is not an authoritative audit record. Backend integration
should replace the ledger adapter with versioned proposal and decision
commands; it should not move decision logic into JSX. At minimum, an approval
command needs organization/athlete authorization, a proposal id, idempotency
key, base prescription version, rationale, actor, rule version/hash, and one
transaction that writes the new accepted prescription and immutable decision
event together.

For a synthetic downloadable build only, `VITE_COACH_DEMO_MODE=true` opens the
coach routes without a signed-in user. This is an explicit build-time flag; an
ordinary production build still fails closed when `VITE_COACH_USER_IDS` is
unset. Demo mode changes only the client-side UI gate and grants no backend
access or authorization.

### Standalone coach-only navigation

The generated one-file demo is intentionally a coach product, not the athlete
app with a coach route attached:

- `/coach` opens the command center rather than redirecting to one feature.
- Coach session creation and editing stay under `/coach/build/:id` and
  `/coach/planner/:id`, while reusing the same tested authoring components.
- Every builder return target is a coach route.
- The single-HTML generator watches hash navigation and replaces any non-coach
  location with `#/coach`. A completion, stale link or manual `#/` therefore
  cannot reveal the athlete home screen.
- `checks/coach-contract.mjs` makes these route boundaries executable.

The command center restores the deeper operational workspace: risk-first
action queue, Strength/Conditioning/Nutrition system cards, resolved week,
athlete operating context, trends, and the Intent → Resolution → Actual →
Decision truth model. It does not invent multi-athlete access; the current
screen remains an explicit single-athlete local demonstration.

`ArcCoachFrame.tsx` is now the shared shell for every coach workflow. Plan
authoring, progression review, week ledger, Nutrition context, deep inspection,
the guided builder and the dense planner retain the ARC identity, navigation,
active section, authority reminder and local-demo disclosure. Coach source is
also statically checked for direct athlete-route strings, so a future button
cannot quietly reintroduce the same coach-to-athlete navigation leak.
