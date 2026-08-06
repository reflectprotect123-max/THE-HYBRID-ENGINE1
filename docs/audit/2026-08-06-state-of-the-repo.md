# State of the repo — 6 Aug 2026

A read-only audit of **THE-HYBRID-ENGINE1** at commit `8f55e6b`, written to be
portable: it assumes no prior context and cites every claim to a path you can
open. Nothing in this document was changed by the audit; the worktree was clean
before and after.

**Scope of verification.** Dependencies installed, `pnpm run typecheck`,
`pnpm run test`, `pnpm run check:ecosystem`, `checks/docs.mjs`, and a full
`pnpm run build` were all executed. Deploy state was read from Netlify. Code
claims below come from reading the files named, not from inference.

---

## 1. The headline: `handoff.md` no longer describes this repository

`main` is at `8f55e6b`, which is **29 commits past** `4eeeca8`, the commit the
handoff's authoritative checkpoint describes. Every one of those commits is
merged, and the tree they produce is **live in production** — the current
Netlify deploy is state `ready`, built from exactly `8f55e6b`, published
6 Aug 2026 18:09 UTC, with a clean secret scan (0 matches across 527 files).

Work that exists on `main` and is absent from the handoff:

| Shipped | Where |
|---|---|
| **Coach bench** — program grid, session drawer, resolution preview, policy inspector, exception history, simulate mode, athlete-zero onboarding (~2,700 lines / 19 files) | `apps/web/src/coach/` |
| Its design spec (228 lines) | `docs/superpowers/specs/2026-08-06-coach-bench-design.md` |
| **Auto-Coached mode v1 + v2** — pure resolver (279 lines) | `packages/auto-coach/src/` |
| Auto-Coached UI — pre-session check-in, session receipt, Apply/Undo, consent gate, post-session feedback, weekly summary | `apps/web/src/autocoach/` |
| Home/Progress reorganisation, design-consistency pass, 11 root-caused smoke-test fixes | across `apps/web` |

### The specific statements that are now false

- **Handoff item 4** says the coach dashboard is *"PAUSED… No design, no spec,
  nothing implemented"* and instructs the next session to restart the
  brainstorm. It was designed, specced, built, reviewed, merged and deployed.
  Following that instruction would mean rebuilding shipped software.
- **The 4 Aug checkpoint's next-step 1** — "decide whether to merge
  `ecosystem-rebuild`". Already merged.
- **The Android build boundary** as recorded — EAS device builds have since
  happened.

### One thing worth recording rather than discovering later

This work touched `apps/web`, which the handoff's constraint said to leave
alone. It did so additively — lazy-loaded route chunk, its own paths, no
changes to shared contracts — and the spec argues that case explicitly. The
constraint is written down; the decision to work within it this way is not.
Whatever the verdict, it belongs in the checkpoint.

---

## 2. Health: green, and green for real

| Check | Result |
|---|---|
| `pnpm run typecheck` | clean — 14 projects |
| `pnpm run test` | exit 0 — engine **585**, mobile **122**, web **79**, auto-coach **32**, plus remaining suites |
| `pnpm run check:ecosystem` | all static contract assertions pass |
| `checks/docs.mjs` | 21 paths + 21 symbols resolve |
| `pnpm run build` | clean; coach correctly code-split to its own 61 kB chunk |
| Secrets | none — the only key present is the Supabase **anon** key, public by design and documented as such |
| `TODO` / `FIXME` / `console.log` in app + package source | **zero** |

**`packages/auto-coach/src/resolve.ts` is the strongest new code in the tree.**
The hard safety gate runs *before* anything readiness-shaped, so wearable
signals are structurally incapable of outranking a pain or illness flag;
missing data lowers confidence and never widens autonomy; the workout object is
never mutated; the resolver abstains with a stated reason rather than inventing
semantics. That is the operating contract enforced by control flow, not by
comment.

---

## 3. Findings, in the order I would fix them

### 3.1 The coach bench has no rendering test — its own spec asked for three

The spec's Testing section promises grid rendering against a fixture
`EngineDB`, an adapter round-trip, and a property-tested projection. What
exists is five pure-logic unit files:

```
apps/web/test/coach-guard.test.ts
apps/web/test/coach-diff.test.ts
apps/web/test/coach-ops.test.ts
apps/web/test/coach-projection.test.ts
apps/web/test/coach-trends.test.ts
```

No `.tsx` render test exists, and neither `react-smoke.mjs` nor
`deploy-smoke.mjs` navigates to `/coach`. Roughly 2,700 lines of shipped,
production-live UI have zero browser-level coverage. `simulateFixtures.ts` is a
source fixture module, not a test.

### 3.2 The service worker excludes `/coach`, for a reason that stopped being true

`apps/web/vite.config.ts:55-59` denylists `/^\/coach(\/|$)/` from
`navigateFallback`, commented *"the coach site is a different app at the same
origin."* It is no longer a different app; it is a lazy chunk of this SPA.

Effect: a hard navigation to `/coach` bypasses the service worker and goes to
the network. Online this is invisible — `/* /index.html 200` catches it.
Offline it fails, making the coach route the single non-offline-capable surface
of an application whose premise is offline-first.

The same fossil belief is repeated in `netlify.toml`'s header comment, the
coach paragraph of `_redirects`, the `rm dist/coach` step in
`scripts/build-site.mjs`, and CI's "both web apps" phrasing. Fix the denylist
and the four comments together, or the next reader re-derives the wrong model.

### 3.3 Auto-Coached ships where nobody trains

`apps/mobile/package.json` lists eight `@hybrid/*` workspace dependencies;
`@hybrid/auto-coach` is not among them, and there is no
`apps/mobile/src/autocoach/`. Per the handoff, the actual athlete devices are
the EAS Android builds. The adaptive-coaching feature is therefore available
only on the surface the athletes do not use.

### 3.4 Four localStorage-only stores, and two of them are an audit trail

`hybrid-coach-bench-v1`, plus the auto-coach policy, consent, and ledger. This
is deliberate and documented in both specs. The concern is narrower than the
design choice: **consent and the ledger are the record of why an automated
system changed someone's training.** Today a cleared browser or a second device
loses that record silently, with no sync path and no export.

### 3.5 `VITE_COACH_USER_IDS` should be confirmed present in Netlify

The coach guard fails closed in production, which is the correct default. The
consequence is that if the variable is unset, `/coach` silently redirects every
visitor to `/` and the shipped bench is unreachable. This needs one look at the
environment settings to rule in or out — it is not visible from the tree.

### 3.6 Still open from the 4 Aug checkpoint

`apps/web/index.html:22` is a literal `<title>THE Hybrid System</title>` for
both product builds, while the manifests correctly diverge. This was listed as
item 4 on 4 Aug and has not moved.

### 3.7 Documentation drift

- `README.md`'s symptom map and layout section mention neither the coach bench
  nor auto-coach. (`checks/docs.mjs` reads only `README.md` and validates only
  the paths it *does* name, so an omission is invisible to it — the check
  proves the map is correct, never that it is complete.)
- `CLAUDE.md`'s product-ownership list names neither `@hybrid/auto-coach` nor
  `@hybrid/product-scope`. The operating contract does not currently say who
  owns the newest decision-making package, and `auto-coach` applies
  whole-athlete-state constraints to a session — adjacent to Coordinator
  authority. The code respects the boundary; the contract does not describe it.

### 3.8 Minor

- 13 stale remote branches. `recovered/pct-1rm-rep-ranges` is the one that is
  genuinely unmerged by design.
- Main athlete bundle: 681 kB raw / 201 kB gzip, over Vite's warning threshold.
- The vendored `ui-ux-pro-max` skill is 1.9 MB; its `google-fonts.csv` alone is
  the largest tracked file in the repo after the lockfile.

---

## 4. Suggested order of work

1. **Rewrite the handoff checkpoint** to match `8f55e6b`. Every hour spent
   against the current text risks rebuilding something that already exists.
2. **§3.2 + §3.1 together** — the service-worker denylist and the missing
   `/coach` smoke coverage are one story: a route that was carved out as
   external and never re-integrated once it stopped being external.
3. **§3.5** — one environment-variable check that determines whether the
   shipped bench is reachable at all.
4. **§3.4 export path**, then **§3.3 mobile parity** — both are scope calls
   rather than defects, and both are worth deciding deliberately rather than
   by default.
5. **§3.6, §3.7** — small, and they keep the next audit cheap.
