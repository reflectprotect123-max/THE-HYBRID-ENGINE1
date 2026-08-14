# The coach publishes the week

**Status:** design, not built. Written 13 August 2026.
**Decision owner:** the repository owner, who chose this shape on 13 August.
**Phase 1 scope:** 1:1 only. Teams are designed for but deliberately not built.

---

## What is being asked for

A coach programs a full week of training, presses **Publish**, and it appears
on that athlete's phone as their week. The reference is TrainHeroic: what the
coach wrote is what the athlete opens on Tuesday morning.

## Why this is not a small feature

Because this repository was built on the opposite premise, and has defended it
harder than anything else in it.

`CLAUDE.md`: "`@hybrid/coordinator` owns weekly conflict resolution and is the
only layer allowed to choose the final weekly plan." That is not a convention.
It is a `check` constraint:

```sql
-- supabase/migrations/20260804_fitness_ecosystem_contracts.sql:71
constraint athlete_plan_writer check (writer = 'coordinator'),
```

The database physically refuses a weekly plan written by anyone else, and
`publish_athlete_weekly_plan` writes against `auth.uid()` — the ATHLETE's own
id. Today a week is computed on the athlete's device, by their Coordinator,
from proposals. A coach has no way to author one and no permission to store
one.

So "press Publish and it lands" is a change of authority, not a screen. Every
other decision in this document follows from that one.

## The authority model, stated exactly

The owner chose **coach wins outright**. Read literally that phrase could also
delete the injury stop, which was not asked for and is not built here. The
split this design implements:

| Concern | Who decides, after this change |
|---|---|
| Which sessions, in which order, on which days | **The coach.** The Coordinator no longer arbitrates the week for a coached athlete. |
| Whether today's session runs at all, given pain or illness | **Unchanged — the safety layer.** |
| Progression inside a coached block | **The coach.** Increases stay approval-only, and the approver is now a real person. |
| A self-coached athlete's week | **Unchanged — the Coordinator.** Nothing here touches an athlete with no coach. |

The reason the second row does not move: `@hybrid/auto-coach` "applies
whole-athlete-state constraints to one session; it never programs a week"
(`CLAUDE.md`). It is a different layer from the Coordinator, operating at a
different granularity. Taking the WEEK from the Coordinator does not require
taking the SESSION from the safety resolver, and the two are worth keeping
apart — one is a scheduling opinion, the other is the rule that a person in
pain does not get told to squat.

**A held session is not a silent hole.** If the safety layer holds a coach's
session, the coach is told which session, on which day, and that it was a pain
or illness flag rather than a skipped workout. A coach who cannot tell "held
for injury" from "ignored me" will distrust the whole system within a week.

### What this costs, recorded honestly

This weakens a guarantee the repo has enforced since 4 August: that exactly one
component decides an athlete's week. After this there are two regimes — coached
and self-coached — and the athlete's device has to know which it is in. That is
a real increase in the number of states the system can be in, and the honest
price of the product the owner wants. It is written here so the next reader
finds the reasoning rather than an unexplained constraint change.

---

## Data model

### `coach_week_plans` — the coach's authored week

A week is NOT a program template. Templates are domain-scoped
(`strength` | `conditioning`), carry a progression model, and are reusable
across athletes. A published week is a specific set of dated sessions for one
athlete, mixing both domains, authored once.

```
coach_week_plans
  id, organization_id, coach_user_id, athlete_user_id,
  week_start (date, Monday),
  status ('draft' | 'published'),
  created_at, updated_at
  unique (organization_id, athlete_user_id, week_start)
```

```
coach_week_plan_versions          -- immutable, exactly like program_template_versions
  id, week_plan_id, version (int),
  body (jsonb: the seven days, each a list of sessions),
  published_at, published_by
```

Versioning is not optional. A coach edits a published week; the athlete may
already have trained Monday off version 1. An immutable version per publish is
what makes "what did they actually see" answerable, and it is the shape the
rest of this schema already uses.

### `athlete_weekly_plans.writer` — the constraint that must change

```sql
constraint athlete_plan_writer check (writer in ('coordinator', 'coach')),
```

And the precedence rule, which belongs in ONE place — the merge, not the UI:

> For a given `week_start`, a row with `writer = 'coach'` wins over
> `writer = 'coordinator'`, regardless of revision. A coach's week is not a
> newer opinion, it is a different kind of thing.

**Corrected 13 August 2026, by the schema.** This paragraph used to say a
coordinator-written row "is not deleted, it stays as the fallback for the
moment the athlete leaves the roster". It cannot: `athlete_weekly_plans` is
keyed `primary key (user_id, week_start)`, so there is exactly one row per
athlete per week and a coach publish REPLACES it.

That is the better model rather than a compromise. The stored row is a
published ARTEFACT, not the source — the Coordinator computes the week on
device, from proposals, locally and offline. An athlete who leaves a roster
loses nothing, because their device regenerates the week on the next
reconcile. The fallback was never the row. The fallback is the Coordinator.

One thing this section also missed, found the same way: `revision` is
load-bearing. The existing upsert only wins `where revision < excluded.revision`,
so a coach publish that does not clear the row's current revision is silently
DISCARDED — the statement succeeds, nothing changes, and the coach is told it
worked. `publish_coach_week` reads the current revision and steps past it,
inside its transaction, behind a row lock. There is a behaviour check for
exactly this in `checks/migrations-apply.mjs`.

### Publishing

```
publish_coach_week(
  p_organization_id, p_athlete_user_id, p_week_start,
  p_body, p_base_version, p_idempotency_key
) returns coach_week_plan_versions
```

`security definer`, `search_path` pinned, actor from `auth.uid()`, coach↔athlete
relationship checked server-side, `select … for update` on the plan row. It
writes the version, the `athlete_weekly_plans` row with `writer = 'coach'`, and
a receipt, in one transaction. `p_base_version` makes a concurrent second coach
fail loudly rather than silently overwrite.

No client role gets INSERT on any of these tables. Same rule as every other
coach table, for the same reason.

---

## Surfaces

### Coach — `/coach/week/:athleteId/:weekStart`

Seven day columns, each holding zero or more sessions, built with the session
builder that already exists (`coach/library/DayBuilderRoute` and the authoring
screens now living in `coach/authoring/`). Publish is one button with a
confirmation that names the athlete and the dates.

Composed at 1440px, must hold at 420px, joins `checks/screens.mjs` in the same
commit — the standing rule for any new `/coach` route.

After publishing, the same screen shows per-day state: published, completed,
**held (pain)**, **held (illness)**, not done. That is the feedback loop that
makes the product worth paying for, and it is not a second phase.

### Athlete — Android

The week arrives through the existing sync. It renders as the athlete's week,
attributed to the coach by name. Two things it must NOT do:

- **No accept/decline.** That is the assignment flow, which is a proposal. A
  published week from a coach the athlete has already consented to is not
  re-negotiated session by session. The consent boundary is the roster link.
- **No silent divergence.** If the safety layer holds a session, the athlete
  sees why, and so does the coach.

---

## Teams — designed for, not built

Phase 1 is 1:1 by the owner's choice, and the schema above must not make teams
expensive later. Two forward decisions, taken now:

1. `coach_week_plans` is keyed by `athlete_user_id`, not by a target that could
   be either an athlete or a team. A team publish will FAN OUT into one plan row
   per member. Divergence is the normal case, not the exception — one athlete
   gets injured in week 2 and their copy must change without touching anyone
   else's — so per-athlete rows are the correct primitive and a shared row
   would have to be split the first time it was used.
2. A future `teams` / `team_memberships` pair carries `source_team_id` and
   `source_week_plan_version` on each fanned-out plan, so "everyone on version
   3 except Dan, who is on 3-modified" is answerable.

Unanswered on purpose, because they are team questions and phase 1 does not
need them: what a mid-block joiner receives, and whether a team publish should
be all-or-nothing when one member's write fails.

---

## Build order

1. Migration: `coach_week_plans`, versions, `publish_coach_week`, the `writer`
   constraint change, RLS, explicit revokes, rollback section. Behaviour checks
   in `checks/migrations-apply.mjs` — including that a coach cannot publish to a
   non-athlete, and that the base-version guard actually refuses.
2. Precedence in the merge, in `@hybrid/engine`, with tests. Coach beats
   coordinator for a week; coordinator still owns every other week; leaving the
   roster falls back cleanly.
3. Coach week builder + publish, behind `layer3Ready`, with the 420px shot.
4. Android: render a coach-written week, attributed, no accept/decline.
5. Held-session reporting back to the coach.
6. `CLAUDE.md` amendment. The Coordinator section becomes untrue the moment
   step 1 lands, and this repo's own rule is that a stale statement is worse
   than none.

## What would make this the wrong design

Recorded so it can be checked rather than defended:

- If coaches turn out to want to publish a REPEATING block rather than one
  week, `week_start` on the plan row is the wrong grain and this becomes a
  block entity with weeks inside it.
- If athletes routinely want to move a coach's session by a day, "coach wins
  outright" was the wrong answer and the middle option — coach proposes,
  Coordinator arranges — was right.
