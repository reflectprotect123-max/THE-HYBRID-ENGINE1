# AGENTS.md — read this before writing any code

> ## ⚠ This is not the live repository
>
> Active development moved to **[`reflectprotect123-max/the-coach-brain`](https://github.com/reflectprotect123-max/the-coach-brain)**
> on 8 August 2026, when the ARC coach workspace (302 files) was imported there.
> That repository is **strictly ahead of this one** and is the single source of
> truth. Do not start feature work here.
>
> A file-by-file comparison on 8 August (`the-coach-brain@cf4e80c` against this
> repository at `71b14b2`) found 30 files present only there — the entire coach
> workspace — and nothing here worth recovering. The two files present only here
> are renames that work performed.
>
> One deliberate difference, so nobody "fixes" it back: this repository still
> carries the Logger auto-apply pair (`apps/web/src/screens/Logger.tsx:297`,
> `apps/mobile/src/screens/Logger.tsx:382`) that writes an adjusted weight into
> the next set. `the-coach-brain` removed the web one on purpose, and its
> `coach-contract` check has a seventh rule forbidding it. The copy here has six
> rules and would not catch it.
>
> This repository's history, documentation and handoff bundle remain valid for
> reference. Its `main` is `71b14b2`.


> ## ⚠ This is not the live repository
>
> Active development moved to **[`reflectprotect123-max/the-coach-brain`](https://github.com/reflectprotect123-max/the-coach-brain)**
> on 8 August 2026, when the ARC coach workspace (302 files) was imported there.
> That repository is **strictly ahead of this one** and is the single source of
> truth. Do not start feature work here.
>
> A file-by-file comparison on 8 August (`the-coach-brain@cf4e80c` against this
> repository at `71b14b2`) found 30 files present only there — the entire coach
> workspace — and nothing here worth recovering. The two files present only here
> are renames that work performed.
>
> One deliberate difference, so nobody "fixes" it back: this repository still
> carries the Logger auto-apply pair (`apps/web/src/screens/Logger.tsx:297`,
> `apps/mobile/src/screens/Logger.tsx:382`) that writes an adjusted weight into
> the next set. `the-coach-brain` removed the web one on purpose, and its
> `coach-contract` check has a seventh rule forbidding it. The copy here has six
> rules and would not catch it.
>
> This repository's history, documentation and handoff bundle remain valid for
> reference. Its `main` is `71b14b2`.


Short on purpose. If you read one file in this repository, make it this one.

## What this is

A hybrid-training system for **one athlete**. Two engines — strength and
conditioning — propose sessions into one week and one body, and a deterministic
**Coordinator** resolves the collision and records why. Nutrition is a third
world that informs training but never competes with it.

That arbitration is the product. It is not a workout logger with cardio and a
food log bolted on.

## The five things that will make you build the wrong thing

**1. There is no multi-athlete access. None.**
Every RLS policy on athlete data is `auth.uid() = user_id`. There is no coach
role, no coach↔athlete table, no policy granting one user another's rows.
RLS **filters rather than raising**, so a UI that fetches another athlete gets
an empty screen, not an error — the worst failure mode to debug. Multi-athlete
is a backend project (new tables, new policies, an RLS review), not a
front-end task.

**2. The Coordinator alone picks the weekly plan.**
A coach or athlete steers by changing INPUTS — goals, schedule, constraints.
Nobody hand-places a session into a resolved plan. If your design has someone
dragging a session onto Thursday, it is the wrong design for this system.

**3. A week is a set of resolved conflicts, not a schedule.**
`WeeklyPlan` carries `decisions: PlanDecision[]` — one per proposal, with a
reason code: `dropped_interference`, `dropped_pain_safety`,
`dropped_illness_safety`, `dropped_spacing`, `dropped_domain_cap`,
`dropped_weekly_cap`, `dropped_no_available_slot`, `accepted`,
`locked_existing`. A surface that shows only what got scheduled throws away
the half worth talking about.

**4. Safety flags outrank everything.**
Pain and illness DROP a session rather than scaling it. No readiness score,
wearable metric or nutrition figure may outrank them. HRV must never be used as
a pain, injury or illness gate. Missing data stays `unknown` — never "clear".

**5. Writes are never filtered; deletes are never splices.**
Reads may be scoped by world. A filtered view must never become the thing
written back. Deleting stamps `deletedAt` — a spliced record returns from the
other device on the next sync. Merges are additive in BOTH directions. This has
cost real user data twice.

## Read these next, in this order

1. `PRODUCT_NOTES.md` — what the product is, what is ready, what is prototype.
2. `docs/COACH_INTEGRATION.md` — if you are touching anything coach-facing.
3. `docs/ACTUAL_ARCHITECTURE.md` — structure, dependency direction, diagrams.
4. `docs/COORDINATOR_AND_EVIDENCE_AUDIT.md` — every rule that changes training,
   and the three places the app contradicts its own safety constraints.
5. `CLAUDE.md` — the binding operating contract. One owner per decision domain.

`checks/*.mjs` are executable invariants and outrank all prose, including this
file. If this file disagrees with the code, the code wins and the disagreement
is worth reporting.

**`node checks/coach-contract.mjs` enforces five of the constraints above.** It
runs in CI. It will fail your build if the coach surface queries the backend
per-athlete, mints a weekly plan, imports nutrition into the coordinator,
collapses the safety reason codes, uses the allowlist as a data scope, or
splices a record out without a tombstone. Run it before you hand anything back
— a failure there is always real.

## Layout

- `packages/*` — engines and contracts, consumed as **raw TypeScript source**
  (`main: ./src/index.ts`, no build output).
- `apps/web` — React 19 + Vite. `apps/mobile` — Expo 54 / RN 0.81.
- `supabase/migrations/` — read in filename order.

`nutrition-core` and `nutrition-engine` import nothing from `@hybrid/*`. If you
add such an import, that is a real finding — tell someone.

## Where tests go

**Colocated.** `src/lift.ts` is tested by `src/lift.test.ts`, same directory.
Nothing test-shaped belongs in a `test/` directory; those hold only fixtures,
golden vectors and the mobile Jest setup.

Web and packages use **Vitest**. Mobile uses **Jest with `jest-expo` and
injected globals** — no runner import. Mixing them up is the most common
mistake here.

## Verify before you hand anything back

```bash
pnpm install
pnpm run typecheck                    # 17 projects
pnpm run test                         # 1,375 tests
pnpm run build                        # web
pnpm --filter @hybrid/mobile bundle   # Metro — catches what tsc cannot
node checks/docs.mjs
node checks/react-smoke.mjs           # real Chromium, includes the coach bench
```

That Metro line matters more than it looks: TypeScript resolves happily through
pnpm symlinks that Metro rejects outright. Four bugs invisible to `tsc` were
caught only by running the real bundler.

## Known open — do not report these as discoveries

- The shared food catalogue is **empty**; barcode lookups miss by design.
- `/coach` is excluded from `navigateFallback` in `apps/web/vite.config.ts`, so
  it works online and **fails offline**.
- `auto-coach` is a dependency of `apps/web` only, not `apps/mobile`.
- The auto-coach receipt ledger is device-local localStorage and never syncs.
- Six nutrition-engine defects are carried deliberately, documented as data in
  `packages/nutrition-engine/src/defects.ts`.
- The coach bench has no render tests.
