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

## The PWA trap, and it is aimed directly at you

`apps/web/vite.config.ts` excludes `/coach` from `navigateFallback`:

```js
/^\/coach(\/|$)/,
```

The comment says the coach is "a different app at the same origin". **It no
longer is** — it is a lazy chunk of the same SPA (`apps/web/src/App.tsx`:
`const Coach = lazy(() => import('./coach'))`, routed at `/coach/*`).

Effect today: **`/coach` works online and fails offline.** This is a known open
item, not a bug you found. If you are building a PWA for the coach, this line
is the first thing to deal with, and deciding what offline should even MEAN for
a coach view is a design question worth answering before you write the service
worker config.

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
2. What does the coach DO with what they see — is the output a decision, a
   message to the athlete, or a change to next week's inputs? The Coordinator
   constraint means it has to be the third, expressed as inputs.
3. What should `/coach` do offline?
