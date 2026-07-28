# Handoff

What one session worked out, written down before the container holding it was
reclaimed. A chat cannot be merged into another chat; a file in the repo can be
read by any session, on any machine, forever. That asymmetry is the only reason
this document exists.

Sections 2–5 and 7 were verified against the tree at `8275360`; sections 1 and 6
were re-verified against `b5bc201`. Nothing here is a commitment to build —
section 4 is a proposal, and it is marked as one.

---

## 1. Where the code is

The real monorepo is **`reflectprotect123-max/THE-HYBRID-ENGINE1`**. It was
renamed from `the-hybrid-engine1`; pushes to the old name still redirect, so a
stale remote works but reports the move.

**It is the only live repository.** The owner has confirmed that every other
repo on the account is dead — not a component, not a deploy target, not a
staging copy. Nothing in any of them is a dependency of this one, and nothing
in any of them should be read, copied, revived, or cited as prior art. If a
task seems to need one of them, the task is wrong about where the code is.

The other twelve, so no session has to wonder which is which:

| Repo | Why it is not this one |
|---|---|
| `THEhybridsystem` | Empty — no commits, no files. The dangerous one; see below |
| `the-hybrid-engine-render` | Superseded deploy target. This repo deploys via Netlify |
| `THE-HYBRID-ENGINE-newest` | Archived. Named "newest"; it is not |
| `hybrid-engine` | Superseded |
| `TheHYBRIDENGINE` | Archived |
| `THE-Hybrid-engine---netlify` | Superseded Netlify attempt |
| `THE-Hybrid-engine` | Superseded |
| `Hybrid-app` | Superseded |
| `the-coach-brain`, `thebrain` | Earlier unrelated experiments |
| `claude-code-skills`, `desktop-tutorial` | Not this project at all |

`THEhybridsystem` deserves the specific warning, because its name is the one
this project calls itself and it contains **nothing** — no commits, no files,
no branches. A session pointed at it sees a bare directory and concludes the
project does not exist. If you are reading this and your working directory
looks empty, that is what happened; you are in the wrong repo. This has now
cost two sessions: one lost most of its length to it, and a later one opened
by reporting the project had never been started.

## 2. The coach dashboard already exists

`apps/coach/src/Dashboard.tsx` (334 lines, added in `c938c2c` and `8275360`) is
a working self-coached dashboard: five tiles (last trained, this week's tonnage
with a percentage delta, sessions per twelve weeks, WHOOP readiness, movement
count), a twelve-week volume bar chart, the best six lifts by e1RM over six
months, and a derived-notes panel.

Every number in it goes through `@hybrid/engine`. None are recomputed locally —
a coach screen disagreeing with the phone about a number is worse than a coach
screen that does not exist.

**An empty dashboard is almost always a data problem, not a missing feature.**
It reads the signed-in user's own row from Supabase `app_state`
(`apps/coach/src/cloud.tsx:99`), with the engine database nested under
`state.hybridEngine`. Five distinct empty states each name a different cause:
signed out, still loading, read refused, no row for this account, and a row with
nothing under it. In practice the answer is nearly always one of:

- the coach app is signed in with a **different email** than the phone syncs to;
- the phone has never **completed a sync**, so the data is still only on the
  device that logged it.

The dashboard shows the signed-in user's *own* training. Reading another
athlete's would need a new RLS policy, and that was left as a deliberate privacy
decision rather than inherited from a convenient query.

## 3. What the data model can and cannot support

From `packages/engine/src/types.ts`. This section is the important one — it
decides which analyses are possible at all.

**Present:**

| Signal | Where |
|---|---|
| `LoggedSet.felt` — the athlete's actual RPE, 1–10 | per set |
| `LoggedSet.aVal` / `aVal2` — kg and reps | per set |
| `Session.startedAt` / `completedAt` | per session |
| `CondResult.hrr` — heart-rate recovery | `settings.conditioning[]` |
| `CondResult.zsec` — seconds banked per HR zone, and `dur` | same |
| `whoopDaily[]` — `restingHr`, `hrvMs`, `sleepPerformance`, `recoveryScore` | settings |
| `liftProgress` — the working weight each movement has earned | settings |

**Absent — and this rules things out:** there is **no distance, no pace, no GPS,
no splits** anywhere in the model. Running is a `CondBlock` plus a `CondResult`:
heart-rate zones, duration, and recovery. Any analysis of the form "you ran the
same route faster at the same effort" is therefore **not computable** without a
model change — new fields, a migration, logger UI, and some way to get the data
in. Do not design around pace without doing that work first.

The compensating signal is that **effort is recorded on both sides of the
hybrid**: `felt` on every strength set, `felt` and `hrr` and zone-seconds on
every conditioning session. Output-per-unit-of-effort is the one metric that
spans lifting and running in this dataset, which makes it the natural spine for
anything comparative.

## 4. Proposal, not commitment: an insights engine

The motivating goal was stated as: *see that you are getting fitter without
having noticed*. Descriptive stats cannot do that — tonnage and session counts
report what you already lived through. The mechanism that can is **comparing you
against your own past self at matched effort**, because effort always feels like
effort and so the improvement is invisible from the inside.

Sketch — **this file does not exist**: a pure `packages/engine/src/insights.ts` exporting
`insights(db: EngineDB, now?: Date): Insight[]`, where each `Insight` carries its
own evidence — sample size, window, and a from/to metric — and detectors are:

1. **Strength at matched felt-RPE** — e1RM for sets at the same `felt`, recent
   window against a baseline window. The headline: same effort, more weight.
2. **Heart-rate recovery** — trend `CondResult.hrr`. The cleanest cardiac signal
   here, and completely imperceptible day to day.
3. **Resting HR / HRV drift** — 28-day means from `whoopDaily`.
4. **Work rate** — `sessionVolume(s)` ÷ elapsed minutes, compared only between
   sessions sharing a `workoutId`, so it is the same session done faster rather
   than two different ones.
5. **Volume tolerance** — weekly tonnage rising while mean session `felt` is flat
   or falling.
6. **Zone efficiency** — `zsec.high` at matched `felt`.

Reuses, rather than reimplements: `epley`, `sessionVolume`, `sessionRpe`,
`exLogFor`, `bestE1rmByLift`, `conHrr`, `hasLoggedWork`, `isWarmupBlock`,
`barScale`, `agoLabel`, `ymd`.

**The rule that keeps it honest:** a detector must return nothing below a
minimum sample size and window span. An engine that invents a trend from four
data points is worse than no engine, because it costs you trust in the true
findings. This is the same discipline as `barScale` refusing to zoom a
misleading axis, and as the notes panel preferring silence to a shrug.

Note that the three hand-written note rules in `Dashboard.tsx` — stale lift,
zero-tonnage weeks, no felt RPE — are the seed of exactly this, and are
currently the only derivations on that screen with **no test coverage**. Moving
them into the engine would fix that as a side effect.

## 5. Codex MCP does not work here — do not re-diagnose it

Attempted, and blocked at the environment level:

- `@openai/codex` resolves and installs fine (v0.145.0). Installation is not the
  problem.
- The egress proxy returns **403 on CONNECT** to `api.openai.com` and
  `chatgpt.com` — the organization's network policy declining those hosts.
  `github.com` and `api.anthropic.com` tunnel fine, so it is host-specific, not
  a broken proxy. Per `/root/.ccr/README.md`, a 403 is a policy denial and must
  be reported rather than retried or routed around.
- No `OPENAI_API_KEY` / `CODEX_API_KEY` in the environment.
- `codex login` via ChatGPT is not viable either: `chatgpt.com` is blocked, and
  a headless container has no browser handoff.

Both blockers are environment settings at claude.ai/code — network policy and
environment variables — read at container creation. They cannot be fixed from
inside a running session, and anything installed by hand dies with the
container. See https://code.claude.com/docs/en/claude-code-on-the-web.

Worth deciding deliberately: allowing egress to `api.openai.com` means an agent
in this container can send repository source to OpenAI.

## 6. Branch state

As of this revision, `claude/app-troubleshooting-c69lw9` carries only this
document and is rebased onto `origin/main` at `b5bc201`. It had drifted three
commits behind while holding two of its own, which is the state to expect if
nobody merges it.

The rule that produced that state still applies. A merged pull request is
finished and cannot track new work, so if you find this branch fully merged,
recreate it from the default branch rather than stacking on merged history:

```
git fetch origin main
git checkout -B claude/app-troubleshooting-c69lw9 origin/main
```

## 7. Repo facts worth knowing before you start

- `packages/engine` is the single source of the training model and is consumed
  as **TypeScript source**, no build step.
- **`apps/coach/src/model.ts` is the one real duplication**: a parallel
  `CoachSession`/`CoachBlock`/`CoachEx` shape with short keys, converted to the
  engine's types at publish time. It can author neither warm-up blocks nor text
  blocks, so the athlete-side Planner can express two block kinds the coach
  builder cannot.
- Coach programmes live in `localStorage` under `hybrid-coach-v1` and **never
  sync**. Only published sessions cross to the athlete, as snapshot rows in the
  Supabase `assignments` table. Clearing that browser's storage loses the
  programmes.
- **No charting library is installed anywhere.** Every chart is hand-built from
  `div`/`View` bars or an inline `<svg>` path, sharing `barScale` for the axis.
  That is a deliberate choice, not an omission.
- A planned set is exactly `{ t, rpe }`. Two test suites enforce that a planned
  set can never carry logged fields, because the moment it can, publishing a
  plan can overwrite an athlete's logged work.
- `pnpm verify` is typecheck → test → build:site → check:csp → smoke →
  smoke:deploy. It does **not** include the Metro/Hermes bundle, despite that
  bundle being the only thing that catches what `tsc` cannot about the phone.
  CI runs it as a separate step, so a green local `verify` can still be a
  mobile app that will not bundle. Run `pnpm --filter @hybrid/mobile bundle`
  yourself before pushing mobile or engine changes.

---

## 8. Deployment, verified rather than assumed

Both pipelines fire from a push to `main`, and both were confirmed live at
`63036ef` rather than inferred from config.

**Web — Netlify project `thehybridengine1`.** The push produced deploy
`6a690b5c…`, state `ready`, published in 23s: 6 functions, 19 redirect rules,
10 header rules, secret scan clean over 204 files.

The trap: `deploy_source` is **`api`**, not the GitHub App. So Netlify posts
**no commit status and no GitHub deployment** back to the repo. A session that
checks GitHub for a deploy status finds nothing and will wrongly conclude the
site is not wired up. It is. Check the Netlify project, not GitHub.

**Phone — EAS Update.** `mobile-ota.yml` publishes automatically on a push to
`main` touching `apps/mobile/**`, `packages/{engine,design,config}/**` or
`pnpm-lock.yaml`. A docs-only commit correctly triggers nothing.

Both mobile workflows exit GREEN when `EXPO_TOKEN` is missing, so **a green
tick does not mean a build happened**. Verify by the steps that ran: a real
update runs `Publish EAS Update`, a real build runs `EAS build (Android)`;
on the skip path checkout never runs at all. Both secrets are present and both
have done real work.

**What still cannot ship automatically:** any native change. `runtimeVersion`
is pinned to `"1"`, and an update only reaches a phone whose installed build
declares the same string — so a native change needs `runtimeVersion` bumped in
the same commit plus a fresh APK from `mobile-eas.yml`, dispatched by hand.
