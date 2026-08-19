# Click-by-click flow — TrainHeroic coach app

**Status: steps 1–8 captured.** Steps 9–15 (team calendar interactions, session builder,
analytics) remain — those surfaces are already documented in `01-deep-dive.md` and
`02-spec-addendum.md`, so this file adds only what was newly observed.

Purpose: give a designer/agent enough to replicate the flows exactly — not just the
static screens, but what changes on each interaction.

Confidence: **[V]** observed directly · **[I]** inferred · **[U]** unknown.

---

## Global design tokens — measured from the live DOM [V]

Read out of `getComputedStyle` on the running app, not eyeballed.

| Token | Value |
|---|---|
| Type family | **`Poppins, sans-serif`** |
| Base font size | 16px |
| Viewport measured at | 2969 × 1207 CSS px, DPR 1 |
| Top bar | height **64px**, background **`#000000`** (pure black) |
| Top bar shadow | `rgba(0,0,0,0.2) 0 2px 4px -1px, …` (MD-style elevation) |
| Top bar greeting | 20px, weight 400, `#ffffff` |
| Left nav rail | width **64px**, total content height 368px |
| Nav item | 68 × 44px, 16px, weight 400, `#ffffff` |
| Primary button label | 14px / 19.6px, weight **700**, `text-transform: capitalize`, `#ffffff` |
| "Latest" pill label | 12px, weight **700**, `#ffffff` |

> The `capitalize` transform on button labels is a real detail — TrainHeroic writes
> button text in sentence case and lets CSS capitalise it. Replicate the transform,
> not the literal casing.

---

## Architecture correction — a fifth host [V]

Coach Home is **not** a single React app. It is a shell that embeds two
**cross-origin iframes** from a previously undocumented host:

```
coachapp.trainheroic.com  (shell: top bar, nav rail)
├── iframe  https://adapter.trainheroic.com/home?timestamp=…    1031 × 1143  ← the feed
└── iframe  https://adapter.trainheroic.com/alerts?timestamp=…   515 × 1143  ← Needs Programming rail
```

Both are `sameOrigin: false` from the shell, so the shell cannot read or style them.
There are 11 `<iframe>` elements on the page in total; the other 9 are zero-sized
(`about:blank` / `javascript:false`) — typical auth and analytics plumbing.

**Implication for the architecture map:** add `adapter.trainheroic.com` as a fifth
front-end host. The cache-busting `?timestamp=` on both URLs suggests these panels are
re-mounted rather than updated in place.

**Implication for replication:** do not build this. It is legacy-integration scaffolding —
an "adapter" layer letting older panels render inside the newer shell. Build the feed as
a first-class component.

---

## Step 1 — Coach Home (landing) [V]

**Entry:** `https://coachapp.trainheroic.com/`

**Layout:** two columns. Feed left (~1031px), alerts rail right (~515px), against a
white page. Left nav rail 64px, dark. Top bar 64px, black, full width.

**Controls, left to right / top to bottom:**

| Control | Behaviour |
|---|---|
| `All Athletes` select | scopes the feed to one athlete or team |
| `Latest` pill (active) | toggles feed ordering mode |
| calendar icon | switches feed → calendar view |
| `Expand all cards` toggle | expands every card at once |
| Session card | one per athlete per completed session, grouped under a date heading |
| `See More` / `See Less` | per-card expand |
| `Session Comment` (full-width, primary blue) | opens the comment composer |

**Session card anatomy:**
- Avatar + athlete name (blue link) + session title beneath in grey
- Five-KPI row, always the same five and always in this order:
  `Blocks · Readiness · Minutes · Intensity · KG`
- Each KPI = icon above, value below, label beneath. Nulls render as `–` **and the whole
  KPI dims** rather than disappearing.
- The Blocks KPI icon is a **donut ring** filled proportionally (3/5 → ~60%).

**Date grouping:** cards are grouped under full-date headings (`Monday, August 10, 2026`),
newest first, with a scrollbar on the feed column only.

**Right rail — Needs Programming:** card listing teams whose calendar has run dry, with a
red warning triangle and elapsed time (`7 Days Ago`), plus two icon actions (go to
calendar, message team).

---

## Step 2 — click `See More` [V]

**Click target:** `See More`, bottom-left of the collapsed card.
**Result:** label flips to `See Less`; the card expands downward in place; the KPI row and
`Session Comment` button stay pinned above the expansion. No navigation, no modal.

### What the expansion reveals — the important part

The expanded body renders the **session as executed**, and this is where TrainHeroic's
deviation model becomes visible.

```
WARM UP
 (A)   2 minutes cardio of choice
       1A. Pogo hops - 2 x 10-12
       1B. Med ball chest press into floor - 2 x 10-12
       1C. Rotational med ball slam - 2 x 10-12
       For Completion                    ← circuit result type, rendered in blue

STRENGTH/POWER
 (B)   Bench Press
       8,8,6 @ 80,100,105kg              ← performed

STRENGTH/POWER
 (C)   Romanian Deadlift
       7,8,6 @ 100,105,110kg

STRENGTH/POWER
 (D1)  Lat Pulldown
       3 x 10-12                         ← PRESCRIBED, struck through + greyed
       2 x 12 @ 70,75kg                  ← PERFORMED, bold
 (D2)  DB Reverse Lunge
       3 x 10-12                         ← struck
       2 x 10 @ 27kg

CONDITIONING
 (E)   2-3 x E5OM
       complete a 30m heavy farmers carry
```

### Block letter badge — three states [V]

This is the single most replicable detail on the screen, and it is not documented anywhere.

| State | Appearance | Meaning |
|---|---|---|
| Not completed | outline circle, no fill | block has no results |
| Complete | **green filled** circle | every prescribed set resulted |
| **Partial** | **amber/yellow filled** circle | some but not all sets resulted |

`D1` and `D2` render amber because the athlete performed **2 sets where 3 were
prescribed**. `B` and `C` are green. `A` and `E` are outline.

### Deviation rendering rule [V]

When performance differs from prescription, the card shows **both**:

- prescribed value — **struck through, muted**
- performed value — **bold, full contrast**, directly beneath

When they match, only the performed value is shown.

> This confirms the schema position in `docs/01-deep-dive.md` §1.5 and `src/schema.sql`:
> prescription and performance are **separate objects**. TrainHeroic clearly stores both
> and diffs them at render. Their limitation is not that they lack the concept — it is
> that the prescription itself can only hold two metrics.

### Result notation [V]

`8,8,6 @ 80,100,105kg` — reps as a comma list, loads as a parallel comma list, joined by
`@`, unit suffixed once. Compact and readable, but it only works because there are exactly
two metrics. A third would break the notation, which is a good illustration of why the
2-metric ceiling is load-bearing in the UI as well as the schema.

### Block category as heading [V]

Categories render as uppercase section headings above each block: `WARM UP`,
`STRENGTH/POWER` (repeated per block, not merged), `CONDITIONING`. Note `WARM UP` here
versus `Prep` in the builder's category picker — the athlete/coach-facing label and the
builder enum label differ. **[I]** likely a display-name mapping over the same enum.

---

## Step 3 — click the scope select (`All Athletes`) [V]

**Click target:** the chevron at the right edge of the select. Clicking the select *body*
does nothing — only the chevron opens it. (Minor usability bug; don't replicate.)

**Result:** dropdown opens in place, overlaying the feed. Options mix three different
kinds of entity in one flat list:

| Option | Icon | Kind |
|---|---|---|
| All Athletes | H logo | system group |
| 1:1 Athletes | H logo | system group — athletes not on any team |
| New Members | H logo | system group |
| Me | user avatar | self |
| hybrid training system. | team logo | team |

**Replication note:** the icon carries the type distinction, not a heading or divider.
System groups get the product mark, teams get their own logo, self gets the avatar.
If you build this, add group headers — the flat list stops scaling past a few teams.

---

## Step 4 — click the calendar icon (beside `Latest`) [V]

**Result:** the feed switches from **Latest** (reverse-chronological infinite list,
date-grouped) to a **single-day view** with a date stepper:

```
Latest   ‹   Wednesday, August 19, 2026   ›
```

The `Latest` pill remains visible as the way back. This is a mode toggle, not navigation —
URL is unchanged.

**Empty state observed** (today had no sessions):

- yellow line-art illustration of two figures
- heading: **"No logged sessions found"**
- body: *"Try a different combination of filters to see athlete data"*

Good pattern: the empty state names the *filters* as the likely cause rather than implying
the athlete did nothing.

---

## Step 5 — nav → Athletes [V]

**Full page navigation** to a different host: `coach.trainheroic.com/admin/coach#/athletes`
(the legacy AngularJS app). The shell nav rail and top bar persist; everything inside is
the old app.

**Toolbar:** `GROUP` select (`All Athletes (2)`) · `STATUS` select (`ACTIVE`) · search icon ·
`Remove From Teams` (disabled) · `Archive` (disabled) · `Invite Athletes` (primary) · kebab.

Bulk actions are **disabled until a row is checked** — greyed, not hidden.

**Columns:** checkbox · Athlete Name (sortable, blue) · Actions · Athlete Type · Teams ·
Tags · Days Since Last Login.

**Row actions** are icon-only: calendar · message · chart. The message icon is **absent on
some rows** — present for the Coach Plan athlete, absent for the other. **[I]** messaging is
only available to athletes on a coach-paid plan.

`Athlete Type` reads `Coach Plan` for one athlete and is **empty** for the other —
**[I]** blank means marketplace-acquired or self-serve, which matches the billing note in
step 8 that marketplace athletes don't consume a seat.

---

## Step 6 — click an athlete row → drawer [V]

**Result:** row highlights **light blue**; a right-side drawer slides in (~400px) over the
table. The table stays visible and interactive to its left. Content loads async — a blue
spinner shows first.

**Drawer header:** avatar + athlete name in **uppercase**, close `✕` top-left of the drawer.

**Four tabs**, active state = bottom underline:

### `EXERCISES`
Search field (`Search Back Squat, Pull Ups, Etc.`), then columns:

```
EXERCISE            WORKING MAX        PERSONAL RECORD
1 1/4 Cyclist        100 kg             8@80 kg
  Front Squat        2026-04-15         2026-04-15
                     ESTIMATED
```

Working max = value + date + `ESTIMATED` flag. PR = `{reps}@{weight}` + date.
Unloaded movements show a PR only (`15 reps`, `20:00 mm:ss`) and no working max.

### `CIRCUITS`
Search field (`Search Fran, etc.` — a CrossFit benchmark reference). **Different columns:**

```
CIRCUIT              MOST RECENT        PERSONAL RECORD
Warm Up 08/01/24     0                  0
  Cleans             2024-01-08         2024-01-08
```

> **Structural finding:** circuits get **Most Recent + PR**; exercises get
> **Working Max + PR**. Two parallel record systems with different column pairs that never
> join. This is the same split visible in the API (`/2.0/coach/athlete/numbers/{id}` vs
> `/2.0/coach/athlete/numbers/circuits/{id}`).

### `NOTES`
A single free-text field. Label `Athlete Notes`, placeholder:
*"Injuries, modifications, training start date, FMS results, etc."*
No structured injury/availability model at all.

### `ACCOUNT`
| Field | Type |
|---|---|
| Email | read-only display |
| Reset Password | full-width primary button, `RESET ATHLETE'S PASSWORD` |
| **Pounds/Kilograms** | **toggle, per athlete** — showed `Kilograms` |
| Categories (Sports / Positions / Groups) | `+ Add Categories to User`, with `?` tooltip |
| Teams/Programs | `+ Add Team or Program Access`, with `?` tooltip |

> **Contradiction worth noting.** Units are a **per-athlete display preference** here — yet
> the prescription metric enum still contains `Weight (lb)` and `Weight (kg)` as separate
> members. TrainHeroic already has the right model at the user level and the wrong one at
> the data level. Your schema should have exactly one: store canonical, render per user.

---

## Steps 7–8 — Settings / billing: a **sixth host** [V]

Reached from `Manage Assistant Coaches` in the top bar. Navigates to
**`account.trainheroic.com`** — a sixth front-end host, not previously documented.

Own tab bar, no nav rail:
`Coach Plans · Manage Assistant Coaches · Payment History · Payment Info · Marketplace Subscriptions`

### `Coach Plans` — the seat model [V]

Three-step wizard header: **Choose Plan → Payment → Review** (icons + connectors).

| Element | Observed |
|---|---|
| Current Plan | select: **"1 athlete at $9.99 per month (current plan)"** |
| Actions | `Upgrade Plan` (secondary) · `Cancel Plan` (text) |
| Attached Athletes tile | `1` · "Invited Athletes: 0" · `Manage Athletes` |
| Assistant Coaches tile | `0` · "$9.99 per month" · `Manage Coaches` |
| Footnote | ***"Does not include athletes who purchased from the marketplace"** |
| Ceiling | *"Need more than 1000 athletes? Contact Support"* |

**Business model, confirmed:** per-athlete seat pricing from **$9.99/mo for 1 athlete**,
self-serve up to **1000 athletes**, assistant coaches **$9.99/seat/mo**, 14-day free trial.

> **The important line is the footnote.** Athletes acquired through the Marketplace
> **do not consume a paid seat**. That is a deliberate acquisition subsidy: the Marketplace
> feeds coaches free roster growth, and TrainHeroic takes its cut on the program sale
> instead. If you build a marketplace, this is the lever.

### `Marketplace Subscriptions` — the buyer side [V]

Lists subscriptions the account holds **as a buyer** of other coaches' programs.
Row = logo · name · status badge · price · tax note.

| Product | Badge(s) | Price |
|---|---|---|
| Stay Beefy | `CANCEL PENDING` | $29.00 / month |
| Hybrid Fit (×4) | `CANCEL PENDING` | $29.00 / month |
| Functional Conjugate All Access | `BUNDLE` `ACTIVE` | $49.00 / month · "Renews September 17, 2026" |
| Rx Athlete | `ACTIVE` | $99.00 · **"Lifetime Access"** |

All prices carry *"+ applicable taxes"*. Active rows expose a red `Cancel Subscription`
link. Header link: `Find More Teams On Our Marketplace`.

**Three commercial models coexist:**
1. **Monthly subscription** to a single team/program — ~$29/mo
2. **Bundle** — multiple programs under one subscription, ~$49/mo, own `BUNDLE` badge
3. **One-time lifetime purchase** — $99, no renewal date

Status badge set observed: `ACTIVE` (green) · `CANCEL PENDING` (red/pink) · `BUNDLE` (blue,
a *type* marker shown alongside a status, not instead of one).

> `CANCEL PENDING` rather than immediate cancellation means access persists to period end.
> Model subscription state as `(status, access_until)`, not a boolean.

---

## Architecture — final host list [V]

| # | Host | Role |
|---|---|---|
| 1 | `coachapp.trainheroic.com` | shell · Coach Home · builder · fullscreen preview |
| 2 | `library.trainheroic.com` | Library |
| 3 | `teams.trainheroic.com` | Teams + calendar |
| 4 | `coach.trainheroic.com/admin/coach#/…` | legacy AngularJS — Athletes, Classic Reports |
| 5 | `adapter.trainheroic.com` | **cross-origin iframes** embedded in Coach Home (`/home`, `/alerts`) |
| 6 | `account.trainheroic.com` | **Settings · billing · plans · marketplace subscriptions** |

Plus `marketplace.trainheroic.com` as the public storefront (not walked — requires its own
login).

**Six front-end hosts, two API generations.** For a product with one nav rail, that is a lot
of seams — and it is the clearest signal of where they cannot move quickly.

---

## Steps 9–15 — not re-walked

Already documented in `01-deep-dive.md` / `02-spec-addendum.md` from the earlier session:
team calendar + publish flow, Add From Library, Auto-Publish Options, session builder,
the 20-member metric dropdown, Analytics, Gym Tools.

---

# Unverified claims — read before trusting the decision matrix

Added after a review pass. Several statements elsewhere in this package rest on **menu
labels, hub tiles or official docs rather than direct observation**. They are not marked
`[U]` because they aren't unknown — they're *unchecked*, which is a different and more
dangerous category, because they read like findings.

| Claim | Where | What it actually rests on |
|---|---|---|
| **Parent Calendars — "Steal, 7/10"** | `index.html` E1, `02-spec-addendum` §7 | A menu item under Library → More, and an "Add From Library" tab. **Never opened.** The rating is reasoning about what a master/child calendar *should* be worth, not evidence. |
| Six Analytics report families | `01-deep-dive` §2, `index.html` A2 | The hub tiles only. **No report was ever rendered with data.** I do not know what dimensions, filters, date ranges or chart types they use. |
| Team Subscriptions | `index.html` A2 | Menu label only. Never opened. |
| Library → Sessions, Circuits tabs | `index.html` A2 | Tab labels only. Never opened. |
| Individual athlete calendar | — | Never opened. **Likely a different assignment model from the team calendar** — this is a real gap in the schema work, since it affects whether `assigned_session` hangs off athlete or team. |
| Gym Tools → Spreadsheets | `01-deep-dive` | Card description only. Never launched. |
| Messaging | `index.html` A2 | Icon only. Never opened. |
| Create Program / Create Team forms | — | Never opened. Their fields *are* the entity schema, so this is a genuine omission. |
| Exercise picker tag taxonomy | `index.html` A3 | Saw ~11 tags of an unknown total; the list is virtualised. **Not exhaustive.** |
| Marketplace storefront | `02-spec-addendum` §8b | Buyer-side subscriptions page + public pricing. The storefront itself needs its own login — never walked. |
| Entire athlete app | `01-deep-dive` Part 1 | **Official support documentation only.** iOS/Android, unreachable from this environment. Marked `[V]` throughout because the docs are a legitimate primary source — but no screen was ever seen. |

## What this means for the ratings

The **Steal** column is a mix of two things: behaviours I watched work (`reference_max`,
`track_as`, `LWP+`, block categories, PRs per rep-count, draft→publish, the `Optional`
flag, the A/A1/B1 labelling) and behaviours I inferred from labels (**Parent Calendars**).

Treat the first group as evidence and the second as a hypothesis worth ten minutes of
checking before you build on it.

## Highest-value things left to look at, ranked

1. **An Analytics report rendered with real data** — directly relevant, since this package
   proposes replacement formulas for metrics never watched compute
2. **Parent Calendars** — remove or confirm a 7/10 recommendation
3. **Individual athlete calendar** — affects where `assigned_session` attaches
4. **Create Program / Create Team forms** — field lists are schema
5. **Exercise picker filter taxonomy in full** — feeds the exercise entity
6. **`analytics.trainheroic.com`** — the URL resolves; whether it is a distinct front-end
   host is **unconfirmed** (could not render it)
