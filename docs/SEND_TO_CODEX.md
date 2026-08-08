# The brief to send

Copy everything below the line. It is self-contained: it works whether or not
the agent can clone the repository, because the constraints that matter are
stated inline rather than only linked.

Nothing here is secret — the repository is public.

---

## Context

You are building a coach-facing surface for **The Hybrid Engine**, an existing
production hybrid-training application.

**Repository (public):** https://github.com/reflectprotect123-max/THE-HYBRID-ENGINE1

**Read `AGENTS.md` at the repository root, in full, before writing any code.**
Then `PRODUCT_NOTES.md` and `docs/COACH_INTEGRATION.md`. Do not begin from the
screens — this app's structure is not visible from its UI.

## What the product actually is

Two engines — strength and conditioning — propose sessions into **one week and
one body**. A deterministic Coordinator resolves the collision between them and
records why. Nutrition is a third world that informs training but never
competes with it.

That arbitration is the product. It is **not** a workout logger with cardio and
a food log attached, and a surface that presents it as one has missed the point
even if every screen works.

## Five constraints. Breaking any of them means a rebuild.

**1. There is no multi-athlete data access.**
Every row-level security policy on athlete data is `auth.uid() = user_id`.
There is no coach role, no coach↔athlete relationship table, and no policy
granting one user another user's rows. Verified across all 26 policies.

RLS **filters rather than raising**. A UI that fetches another athlete's data
gets an empty result set, not an error — so the failure mode is a silently
blank screen. The existing bench at `/coach` is a different lens on the
**signed-in user's own** data; `VITE_COACH_USER_IDS` gates who sees the UI, not
whose data they see.

If your design assumes a roster of athletes, stop and raise it. Multi-athlete
is a backend project — new tables, new policies, an RLS review — not a
front-end task.

**2. The Coordinator alone picks the weekly plan.**
The coach steers by changing INPUTS: goals, schedule, constraints. Nobody
hand-places a session into a resolved plan. If your design has someone dragging
a session onto Thursday, it is the wrong design for this system.

**3. A week is a set of resolved conflicts, not a schedule.**
`WeeklyPlan` carries `decisions: PlanDecision[]` — one per proposal, each with
a reason code:

`accepted` · `locked_existing` · `dropped_interference` · `dropped_pain_safety`
· `dropped_illness_safety` · `dropped_spacing` · `dropped_domain_cap` ·
`dropped_weekly_cap` · `dropped_no_available_slot`

Proposals also carry interference tags — `heavy_lower`, `high_intensity`,
`upper`, `easy_aerobic`, `full_body`, `pain_sensitive` — which is how the
collision is computed.

**A surface that shows only what got scheduled throws away the half worth
talking about.** The squat session dropped because Thursday's intervals were
already `high_intensity`; the run dropped for spacing; a day cleared by a pain
flag. That is the conversation with the athlete, and the engine already emits
it — nothing has to be inferred.

**4. Safety flags outrank everything.**
Pain and illness DROP a session rather than scaling it. No readiness score,
wearable metric or nutrition figure may outrank them. HRV must never be used as
a pain, injury or illness gate. Missing data stays `unknown` — never "clear",
never "normal".

**5. Writes are never filtered. Deletes are never splices.**
Reads may be scoped by world; a filtered view must never become the thing
written back. Deleting stamps `deletedAt` — a spliced record returns from the
other device on the next sync. Merges are additive in both directions. This has
cost real user data twice.

## Things that are already broken, so you do not report them as discoveries

- `/coach` is excluded from `navigateFallback` in `apps/web/vite.config.ts`, so
  it works online and **fails offline**. If you are building a PWA, this is the
  first thing to deal with — and "what should a coach view do offline?" is a
  design question worth answering before you write service worker config.
- The shared food catalogue is **empty**; barcode lookups miss by design.
- The auto-coach receipt ledger is device-local localStorage and never syncs,
  so nothing off-device can currently see that automation adjusted a session.
- The coach bench has no render tests.

## What to hand back

1. Which of these you are building: a **single-athlete lens** (nothing
   server-side changes) or **real multi-athlete** (backend project first).
   Answer this before designing.
2. How the week is represented — and specifically where `decisions[]` and the
   reason codes appear.
3. Where nutrition sits: beside training as context, never arbitrated, never
   presented as though a macro target caused a training decision.
4. What `/coach` does offline.

## Verify before handing anything back

```bash
pnpm install
pnpm run typecheck                    # 17 projects
pnpm run test                         # 1,375 tests
pnpm run build
node checks/react-smoke.mjs           # real Chromium, includes the coach bench
```

`checks/*.mjs` are executable invariants and outrank all prose, including this
brief. If something here disagrees with the code, the code wins — and the
disagreement is worth reporting back.
