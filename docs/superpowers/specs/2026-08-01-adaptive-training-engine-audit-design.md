# Adaptive Training Engine — Audit & Design

**Status:** Awaiting your review. No code has been changed. Everything below is either read directly from the current repository (with file:line citations) or an explicit design proposal clearly marked as such.

**Method:** Five independent read-only research agents audited the repo in parallel (repo/CI/docs map; progression-engine internals; readiness/fatigue/pain/safety signals; device integrations & modality separation; data architecture/sync/coach-separation/security), plus a direct baseline run of every build/test/check command available. Every factual claim below traces to a specific file, or is stated as "not found" with the search terms used. Nothing here is inferred from documentation or from older audits — this repo, at its current HEAD, is the only source of truth used.

---

## 1. Executive Verdict

THE Hybrid Engine is a genuinely mature, well-tested, honestly-engineered local-first training app — not a prototype. It has a real deterministic progression engine (`packages/engine`) with 308 passing tests including a 33-case golden suite pinned against the original vanilla implementation, two fully-shipped and production-verified device integrations (WHOOP, Concept2), a third pending only a physical hardware test (Echo Bike V3), a disciplined local-first + record-level-merge sync architecture, and a CI pipeline that actually gates on real browser-driven smoke tests, deployment simulation, and adversarial security tests — all green as of this audit.

The single biggest gap relative to what you're asking for: **the app currently has almost no first-party "how do you actually feel" signal that reaches any decision.** "Readiness" on the Home screen is a WHOOP-recovery-plus-RPE-history *display*, not an input. Sleep is WHOOP pass-through, never an input. Fatigue and soreness don't exist as fields anywhere. A pain flag (`mechanicalCompletion: 'pain_stop'`) *is* captured today — and then never read again by anything. The only signal that automatically eases anything is a single third-party number (WHOOP's `recoveryScore`), and an athlete without a WHOOP strap gets zero automatic protection from any source.

That means the JuggernautAI/MacroFactor-style system you want is buildable — the engine's shape (pure functions, deterministic, already golden-tested, already modality-bucketed) is a genuinely good foundation to layer onto — but it must not be built as if a rich safety-signal substrate already exists. The correct sequencing is: wrap and explain what the engine already decides first (near-zero risk), wire up the one safety signal that's already collected-but-discarded (`pain_stop`) as the very first real behavior change, and only then add assertive-feeling confidence-scored recommendations. Building the "sounds smart" layer before the "actually has evidence" layer is this project's single highest risk — detailed in §11 and §15.

---

## 2–6. Maturity Ratings

| Dimension | Rating (0–10) | Why |
|---|---|---|
| **Product maturity** | **7/10** | Full Plan→Schedule→Train→Log→Recover→Review→Progress loop shipped on both web and mobile, live in production, extensively tested (see §7). Held back by: the half-deleted coach system (§8, §12), a real duplicate-abandoned-workout gap (§8), zero linting, and Echo Bike still awaiting its first real-hardware run. |
| **Training-engine maturity** | **6.5/10** | Deterministic, pure, golden-tested, real per-modality progression bucketing, a genuinely working (if unnamed) recovery-gated deload mechanism. Missing entire categories your ask requires: no missed-session/gap handling, no exercise substitution, no data-sufficiency gating on progression decisions specifically (only `insights.ts`'s trend detectors have that), unbounded e1RM output pinned by golden fixtures. |
| **Safety-readiness** | **2.5/10** | The weakest dimension by far. No injury/illness handling, no emergency/medical language anywhere in the product, no soreness/fatigue input, and the one pain flag that exists is captured and then permanently ignored. This is not a regression — the app never claimed to have this — but it means safety architecture has to be built close to from scratch, not extended. |
| **Data-architecture rating** | **7.5/10** | Real record-level merge (not last-write-wins), prototype-pollution-guarded sanitization, encrypted server-side token storage, RLS-scoped Supabase, deterministic tombstones. Docked for: web/mobile backup-restore semantic divergence (§8, §12), the half-alive coach schema, one pre-existing secret-scan failure in gitignored scratch docs. |
| **AI-readiness** | **3/10** | No AI exists anywhere in the codebase today — zero LLM calls, no chat surface. The *foundation* to add AI safely is unusually good for a codebase this size (clean engine/app boundary, existing reason-string conventions, an established "secrets stay server-side" pattern already proven twice). But none of the actual AI-specific scaffolding (structured decision contracts, confidence scores, audit logging) exists yet, so the rating reflects "nothing built" more than "hard to build." |

---

## 7. Repository Map

**Workspaces** (`pnpm-workspace.yaml`: `packages/*`, `apps/*`):

| Workspace | Role |
|---|---|
| `apps/web` | React 19 / Vite / react-router PWA — the athlete-facing origin app served by Netlify (`netlify.toml`, publish dir `apps/web/dist`). |
| `apps/mobile` | Expo SDK 54 / React Native 0.81 Android app. Mirrors web's screen set; adds native BLE (heart-rate strap, Echo Bike FTMS), GPS route tracking, MMKV storage. |
| `apps/coach` | **Deleted** (`git log`: commit `f0acc5d`, "Remove the coach builder app"). Only untracked build artifacts remain on disk (`apps/coach/dist`, `apps/coach/node_modules`) — confirmed via `git ls-files apps/coach` (empty) and `git status` (clean). See §8/§12 for what this leaves behind. |
| `packages/engine` | Framework-free deterministic training-domain core. `lift.ts`, `session.ts`, `conditioning.ts`, `autoreg.ts`, `concept2.ts`, `insights.ts`, `hr.ts`, `db.ts`, `num.ts`, `balance.ts`, `emit.ts`, `geo.ts`, `plates.ts`, `cloud.ts`, `logger.ts`, `storage.ts`. This is the shared authority both apps consume — confirmed by both apps importing exclusively from `@hybrid/engine`'s published `index.ts`, never duplicating domain logic. |
| `packages/config` | Shared runtime constants (Supabase URL/anon key, function paths). |
| `packages/design` | Shared design tokens (colors, contrast, spacing) — consumed by both apps' UI and `checks/contrast.mjs`. |
| `packages/guided-flow` | Framework-free step-sequencing logic for the guided session-builder flow shared by both apps. |

**`netlify/functions/`** (10 files + `_lib/`): OAuth connect/callback/sync for WHOOP and Concept2 (mirrored architecture), plus `integrations-status.mjs`/`integrations-disconnect.mjs`. `_lib/` holds the shared provider-agnostic machinery: `oauth.mjs` (state/token storage), `crypto.mjs` (AES-256-GCM), `identity.mjs` (two-namespace owner resolution), `session.mjs` (signed cookie), `supabase.mjs` (JWT verification), `store.mjs` (Netlify Blobs), `whoop.mjs`/`concept2.mjs` (provider clients).

**`checks/`** (15 files): the repo's e2e/contract/security layer, distinct from unit tests — `react-smoke.mjs` (drives the real built app in a browser), `deploy-smoke.mjs` (serves the exact publish dir Netlify will), `pentest.mjs` (20 adversarial attacks: cookie forgery, webhook-signature bypass, AES-GCM tamper, SSRF, OAuth-state confusion, prototype pollution, XSS), `whoop-contract.mjs`/`concept2-contract.mjs` (static+runtime contract checks per provider), `supabase-contract.mjs`/`supabase-auth.mjs`, `mobile-touch.mjs`/`web-touch.mjs` (44/48dp target enforcement), `contrast.mjs` (WCAG floor computed straight from design tokens), `docs.mjs` (README claims vs reality), `pwa-update.mjs`, `screens.mjs`.

**Test inventory:** `packages/engine/test/` — 19 test files, ~308 cases, plus 20 golden-vector JSON fixtures. `apps/web/test/` — 1 file (`echoV3.test.ts`), ~3 cases. `apps/mobile/test/` — 10 files, ~71 cases. `packages/guided-flow/test/` — 15 cases.

**CI** (`.github/workflows/`): `ci.yml` runs on every push/PR — docs check → typecheck → mobile Metro/Hermes bundle → unit tests → web build → CSP assertion → Playwright react-smoke → deploy-smoke → touch-target checks → the full pentest/contract/auth loop. Nothing here is advisory; everything gates. `mobile-eas.yml` (manual, signed APK/AAB builds) and `mobile-ota.yml` (automatic on relevant paths, dual-publishes to `preview` and `production` EAS channels) both gate on `EXPO_TOKEN` presence, degrading to a green no-op notice rather than a red failure if absent.

**Database:** `supabase-schema.sql` (246 lines) — one JSONB blob per user (`app_state`, RLS `auth.uid() = user_id`) mirroring the local-first model, plus a still-fully-defined "coach website" block: `coach_library`, `coach_athletes` (token-gated link, `claim_invite()` RPC), `programs`, `assignments`, `athlete_feed`. See §8 for what's actually reachable today.

**Docs/research:** `docs/superpowers/plans/` and `specs/` hold 9 prior plan/spec pairs (guided builder, GPS pace/distance, debug-fix waves, the conditioning-evidence-based upgrade). `docs/research/` holds three evidence bundles already in-repo and directly relevant to this project: `conditioning-evidence-bundle/` (five-modality progression/regression evidence with an explicit evidence hierarchy — this is the raw material Phase 3 below should consume, not re-research), `echo-v3-connectivity-bundle/` (Echo Bike protocol research, explicitly self-flagged as architecture-only, not hardware-validated), `concept2-logbook-bundle/` (Concept2 API research, already fully implemented).

---

## 8. Implemented-versus-Missing Table

| Feature | Evidence | Status | Risk | Recommended action |
|---|---|---|---|---|
| Workout creation | `apps/{web,mobile}/src/screens/Library.tsx`, guided builder in `packages/guided-flow` | Confirmed and working | Low | Keep |
| Exercise library / movement search | `apps/web`'s `<datalist>` typeahead, mobile's `Suggest` chip (`screens/planner/ExerciseCard.tsx`) | Confirmed and working | Low | Keep |
| Set logging | `Logger.tsx` both apps, `packages/engine/src/lift.ts` | Confirmed and working | Low | Keep |
| RPE/RIR capture | `session.ts:201-226` (`sessionRpe`), chip UI both apps | Confirmed and working | Low | Keep |
| e1RM (Epley) | `num.ts:8-13` | Confirmed and working; unbounded above `MAX_KG` for extreme inputs, golden-pinned | Low (theoretical only — inputs already clamped at entry) | Keep; do not "fix" without a deliberate golden-fixture decision |
| Readiness input | `Home.tsx` "Readiness" section (both apps) | **Provisional — mislabeled.** It is a WHOOP+RPE-history *display*, not an athlete input | Medium (this is the exact gap the adaptive project needs to fill) | Build — see Phase 1 |
| Sleep | `hr.ts:80-84` (`todaySleepPerformance`), display-only | Partially implemented (display-only, WHOOP pass-through) | Low | Defer — not a blocker |
| Fatigue | `mechanicalCompletion: 'local_fatigue'` tag, `Conditioning.tsx` | Partially implemented — captured, never read | Medium | Wire up in Phase 1 alongside pain |
| Pain flag | `mechanicalCompletion: 'pain_stop'` (`types.ts:215`), written `Conditioning.tsx:350-357`/`:445-448`, **never read anywhere** | Partially implemented — inert | **High** (silently discarded safety signal) | Wire up first — see §11, Phase 1 |
| Session completion | `db.ts:357-374` (`expireStaleSessions`), Training screens' finish flow | Confirmed and working | Low | Keep |
| Training history | `History.tsx` both apps, `session.ts` | Confirmed and working | Low | Keep |
| Strength progression | `autoreg.ts` (`computeSetAdjustment`), `lift.ts` (`nextWorkingWeight`) | Confirmed and working, deterministic, golden-tested | Low | Keep; extend via Phase 2, don't replace |
| Conditioning progression | `conditioning.ts` (`conAdapt`, `progressionKey`) | Confirmed and working, modality-bucketed | Low–Medium (thresholds are uniform across modalities today — see §9) | Extend via Phase 3 |
| Deload logic | No function/field literally named "deload" (0 identifier hits); functionally present via `conAdapt`'s 2-strike level-down and `nextWorkingWeight`'s recovery-gated ease | Partially implemented (real, but unnamed and only recovery-triggered) | Medium | Name it explicitly and add first-party triggers — Phase 1/2 |
| Missed-session logic | Grepped `missed/gap/streak/lapse` — genuine hits are all about a missed *rep*, not a missed *day* | **Not found** | Medium | Build — Phase 1/2 |
| Cross-modality handling | `Modality` union (`types.ts:19`), `progressionKey(fmtKey, modality)` (`conditioning.ts:107-115`), distinct typed fields per source (`avgPowerW` vs `avgPaceSecPerKm` vs `deviceDistanceM`) | Confirmed and working — structurally separated, not just labeled | Low | Keep; Phase 3 gives each modality its own thresholds |
| Air Bike/Echo Bike support | `apps/web/src/native/echoV3.ts`, `apps/mobile/src/native/capabilities.ts` (FTMS 0x1826/0x2AD2) | Confirmed built; **unvalidated against real hardware** (`docs/research/echo-v3-connectivity-bundle/evidence/known_gaps.md`) | Medium until your physical test | Test (in progress per your own plan), no code change needed unless it surfaces a bug |
| Conventional cycling (live device) | Repo-wide search for GPS-cycling/power-meter/ANT+ code | **Not found** — `'bike'` exists only as a manually-logged `Modality` value | Low | Defer — no user ask for this |
| Concept2 integration | `netlify/functions/concept2-*.mjs`, `packages/engine/src/concept2.ts` (matcher + import flow) | Confirmed and working, **verified live in production this session** | Low | Keep |
| SkiErg support | Only via Concept2 Logbook sync; no direct BLE/ANT+ reader | Confirmed (as Concept2-only) | Low | Keep as-is |
| WHOOP integration | `_lib/whoop.mjs`, push (webhook) + pull (sync), tokens server-side only | Confirmed and working | Low | Keep |
| Accounts and authentication | Supabase auth, signed `hybrid_sid` cookie, two-namespace identity (`identity.mjs`) | Confirmed and working | Low | Keep |
| Offline mode / local-first | `sanitizeDB`, synchronous web persistence, debounced mobile persistence | Confirmed and working | Low | Keep |
| Supabase synchronization | Record-level merge (`mergeEngines`/`mergeById`), not last-write-wins | Confirmed and working | Low | Keep |
| Backup export/import | Web: merge-default with optional wipe. Mobile: **always full-replace**, no merge option | Confirmed and working, but **platform-divergent** | Medium (real UX inconsistency, not a crash) | Unify — Phase 6 |
| Coach tools | `Workout.origin`/`assignmentId` still read everywhere; Settings' "Link to coach" still fully functional; but **no UI anywhere in the repo can mint the invite it consumes** (coach-side insert requires `apps/coach`, which is gone) | **Half-implemented — a live dead end** | Medium | **DECIDED (2026-08-01): remove entirely.** No invite-flow rebuild. See §12/§13/§14 Phase 6. |
| AI readiness | No AI/LLM code anywhere in the repo | Not found | — | See §13 |
| Validation | `sanitizeDB`'s prototype-pollution guard, `Number.isFinite` guards throughout `session.ts`/`autoreg.ts` | Confirmed and working, but inconsistent on extreme values (§9) | Low–Medium | Improve incrementally, not a rewrite |
| Error handling | Per-app `humanizeError`, save-failure recovery via trace-pruning retry | Confirmed and working | Low | Keep |
| Privacy | `privacy.html`, RLS as the actual data boundary, public anon key documented as such | Confirmed and working | Low | Keep |
| Security | Server-side token encryption, HMAC session cookies, adversarial pentest suite green | Confirmed and working | Low (one pre-existing non-blocking contract-check failure, see below) | Rotate/scrub flagged secrets |
| Deployment | `netlify.toml`, CSP-verified build, deploy-smoke against the real publish dir | Confirmed and working | Low | Keep |
| Test coverage | 308+71+15+3 unit tests, full CI-gated smoke/deploy/pentest/contract suite, all green at this audit | Confirmed and working | Low | Keep; add adaptive-layer tests as built |

**Baseline command results (run live during this audit, not assumed):**
- `pnpm run verify` (typecheck + all unit tests + build + CSP + react-smoke + deploy-smoke): **exit 0**, all green — engine 308/308 (golden 33/33), mobile 71/71, web 3/3, guided-flow 15/15, react-smoke 29/29, deploy-smoke 11/11.
- Mobile Metro/Hermes bundle (`pnpm --filter @hybrid/mobile bundle`): **exit 0**.
- Full CI-mirrored contract/pentest/touch loop (`pentest`, `supabase-contract`, `whoop-contract`, `concept2-contract`, `whoop-deployment-smoke`, `supabase-auth`, `mobile-touch`, `contrast`, `web-touch`): **7 of 8 exit 0.** `whoop-contract.mjs` fails its browser-facing secret scan on two files under `.superpowers/sdd/2026-07-31-conditioning-evidence-based-upgrade/` (`task-10-brief.md`, `task-10-report.md`) — real access/refresh token literals left in gitignored scratch documentation from earlier debugging work. **Honestly reporting this as a genuine, currently-failing check** rather than omitting it: it is non-blocking (the files are gitignored, never shipped, and this exact failure was already known/accepted in a prior session), but the tokens should be rotated and the files scrubbed as tech debt (§12).
- **Lint: no lint script or ESLint config exists anywhere in the repository** (confirmed by direct search — no `.eslintrc*`/`eslint.config*` file, no `"lint"` script in any `package.json`). This is an honest gap, not an oversight on my part: the Stage 1 instruction to "run lint" has nothing to run.

---

## 9. Progression-Engine Audit

Full internals read directly (`autoreg.ts`, `num.ts`, `session.ts`, `conditioning.ts`, `hr.ts`, `lift.ts`, `insights.ts`, `db.ts`, `balance.ts`, `types.ts`, `constants.ts`, `plates.ts`).

### Load/weight selection & autoregulation — `computeSetAdjustment` (`autoreg.ts:57-86`)

**What it does:** `missed = low>0 && reps<low` (a rep-floor miss, RPE-independent). On a miss, RPE is force-set to `10.5` and the suggestion always moves down, with an explicit rounding-overshoot guard (`autoreg.ts:78`) preventing a miss from ever rounding *up* past the failed weight — this is the historical bug that was fixed and is now regression-tested (`autoreg.test.ts:12-21`, plus the entire golden fixture). On a hit, the adjustment is linear around the set's own target-RPE center. An exact on-target hit is held at the *unrounded* weight (deliberately bypasses plate-rounding so a manual 101kg entry isn't nudged to 100).

**Deterministic:** Yes, fully pure. **Tested:** Golden-pinned (260+ vectors) plus 3 dedicated regression tests. **Missing/null input:** No runtime guards inside the function itself — `NaN` weight silently produces `newWeight: 0` (not a throw, not a rejection); callers (`lift.ts:99-100`) do guard before calling, but the function is reachable un-guarded from tests/other callers. **Extreme input:** The on-target hold branch skips `MAX_KG` clamping entirely (relies on caller pre-sanitization); RPE > 10 is not clamped, it extrapolates linearly rather than being rejected. **Product-sense verdict:** The core decision logic is sound and matches real coaching intuition (miss = down, on-target = hold, easy = up); the gap is purely defensive — a hostile or corrupted input produces a *plausible-looking* wrong answer rather than an explicit rejection, which is a real risk once an adaptive layer starts trusting these outputs programmatically rather than a human reading them off a screen.

### e1RM — `epley` (`num.ts:8-13`)

Standard Epley formula, `null`-guarded for non-positive inputs, **unbounded above** — golden fixtures pin `kg:2001, reps:30 → 4002`, i.e. output can exceed `MAX_KG=2000` by design of the vanilla-parity contract. This only feeds PR detection and insights; it does not itself gate a load prescription. Deterministic, tested, and — per this repo's own standing rule that golden fixtures are sacrosanct — not something to silently "fix."

### RPE/RIR interpretation — `sessionRpe` (`session.ts:201-226`), `rpeGapInfo` (`session.ts:370-411`)

Warm-up sets and warm-up blocks are correctly excluded. Conditioning felt-RPE is deliberately folded into the *felt* average only (not target — a documented, reasoned choice, `session.ts:190-199`, since a conditioning target is a band-center, not a per-set number). `rpeGapInfo` uses a genuinely different mechanism for conditioning (`condEffortGap`, distance outside an effort's RPE band) versus lifting (raw felt-minus-target) — a deliberate, not accidental, difference. No clamp on absurd RPE values feeding the average (an RPE of 50 typed into a set skews the mean with no guard) — same defensive gap as above.

### Volume — `sessionVolume` (`session.ts:167-185`)

Tonnage = Σ(kg×reps) over completed, non-warmup, load-bearing-mode sets. Correctly excludes conditioning (which tracks its own zone-seconds separately in `balance.ts`, never mixed into the kg figure). No upper-bound sanity check on an absurd logged value.

### PR detection — `detectPRs` (`session.ts:330-362`)

Scans **every** block in the finishing session (a real, tested fix for a historical bug where only the first block was checked — `session.test.ts:129-181` directly proves a heavier single in a later block is now caught), compared against the athlete's entire prior history. Whole-history PR detection, 0.01 epsilon against float noise. Inherits epley's unbounded-upper-end behavior — an absurd input *would* register as a PR with no magnitude sanity check.

### Deload logic

**No function, constant, or field is literally named "deload" anywhere in the engine** (4 grep hits, all in comments describing historical bugs). What functions as one is split and unlabeled: `conAdapt`'s two-consecutive-miss level-down (`conditioning.ts:353-358`), and `nextWorkingWeight`'s recovery-gated one-step ease (`lift.ts:162-189`). **Product-sense verdict:** the mechanism itself is reasonable (two strikes before stepping down avoids overreacting to one bad session — genuinely MacroFactor-shaped already), but its complete invisibility as a named concept means there's no single place to reason about, test, or extend deload behavior as a first-class feature. This is exactly what Phase 1 should name and consolidate.

### Missed-session / training-gap handling

**Not found.** Every "missed" hit in the engine means a missed *rep floor within a set*. `expireStaleSessions` (`db.ts:357-374`) detects an abandoned session (promotes to `incomplete` or drops it) but tracks no gap length and triggers no adjustment. There is no streak counter, no "days since last trained," and nothing reads calendar gaps to inform a decision. **Product-sense verdict:** this is a real, meaningful gap for an adaptive system — returning from a 3-week layoff with the same working weight the engine last suggested is a textbook overreach the current engine has no defense against.

### Conditioning progression — `conAdapt`/`progressionKey` (`conditioning.ts`)

Modality-bucketing is real, not cosmetic: `progressionKey(fmtKey, modality)` composes `'format:modality'` keys, verified by a test proving `interval:row` and `interval` remain genuinely separate map entries. The gate sequence per session (simulated-session exclusion → format eligibility → zone-time-present check → on-target test → miss-streak deload) is sound and, notably, **already RPE-primary for intervals/tempo when a felt rating exists**, falling back to HR-zone time only when it doesn't — a real, working instance of exactly the "smoothed, RPE-aware, not purely mechanical" philosophy you're asking to extend further. **The one real limitation:** every modality under the same format currently shares identical thresholds (0.45/0.6 zone-time fractions, 0.6 overcooked ratio) — bucketed separately for *tracking* but not yet *weighted* differently, even though `docs/research/conditioning-evidence-bundle/` (already in this repo) documents modality-specific evidence for exactly this. WHOOP's `recoveryScore` — critically — is read at the *earning* step too (`notRed` gate, `conditioning.ts:339-340`), using the value captured with the session, not re-queried later, specifically to avoid retroactive-verdict drift from a late sync. This is careful, deliberate engineering.

### Exercise substitution

**Not found** anywhere in the engine or apps.

### Readiness/fatigue consumption by the engine

**Confirmed, and this is the audit's most important technical finding:** WHOOP's `recoveryScore` is not merely displayed — it is read by four real decision functions: `conZones` (shifts HR-zone boundaries for the day), `conPrescription` (eases rounds/rest/minutes on a low-recovery day), `conAdapt` (blocks progression-earning on a low-recovery day even given a good effort), and `nextWorkingWeight` (eases today's working weight one step). HRV and sleep performance, by contrast, are read *nowhere* outside `hr.ts`'s own normalization — display-only, confirmed by direct grep across the whole engine. So: the recovery-gating machinery you'd want for an adaptive layer already exists and already works — it is just single-signal (one third-party number) and completely unreachable by anything the athlete could tell the app directly.

### Data-quality / confidence handling

No field or function uses the literal words "confidence"/"insufficient"/"minData." But a real sufficiency gate exists in `insights.ts`: every trend detector routes through `change()`, which requires a minimum sample size (`minPerWindow: 3`) and a minimum relative-change floor (`minRelChange: 0.02`) before returning anything — explicitly reasoned in the module's own header ("a fabricated finding costs the athlete their trust"). **This exact discipline does not extend to the progression-decision functions** (`conAdapt`, `nextWorkingWeight`, `computeSetAdjustment`) — none of them ask "how many prior sessions do I actually have" before acting on a single data point. `insights.ts` is the template to generalize from, not a green-field design problem.

---

## 10. Adaptive-Model Architecture

**Design principle, stated up front: wrap, don't replace.** Every function audited above already returns a reasoned verdict (a string like `'missed the rep floor'`, `'eased for N% recovery'`). The adaptive layer's job is to (a) formalize those verdicts into a typed, reason-coded, confidence-scored contract, (b) add the handful of genuinely missing decision types (hold-insufficient-data, missed-session recovery, substitution), and (c) consume the one real safety signal already collected and currently thrown away (`pain_stop`). None of this requires touching a golden-pinned function's actual math.

### A. Juggernaut-style adaptive strength programming

Proposed decision enum (additive, new types only):
```ts
type ProgressionAction =
  | 'progress_load' | 'progress_reps' | 'hold'
  | 'reduce_load' | 'reduce_volume' | 'repeat_session'
  | 'substitute_exercise' | 'deload'
  | 'pause_insufficient_data';
```
This layers atop `nextWorkingWeight`/`computeSetAdjustment` as a new, per-exercise, cross-session function (not a rewrite of the per-set autoreg logic, which stays exactly as-is). It consumes: exposure history (already in `session.ts`'s history-scanning helpers), e1RM trend (already computable via `epley` + `insights.ts`'s trend machinery), rep-range/volume-landmark config (new, additive settings fields), and the readiness/pain signal from §11. Every decision carries a reason code (a stable string enum, not free text) plus a human-readable note in the same style the engine already uses (`"eased for N% recovery"`). Same input → same output, always — no wall-clock or randomness inside the decision function itself (any time-sensitive input, like "days since last session," is passed in explicitly by the caller, matching `rpeGapInfo`'s existing `now` parameter pattern).

### B. MacroFactor-style feedback loops

Generalize `insights.ts`'s `change()` gate (min sample size, min relative-change floor) into the new decision layer directly: a `pause_insufficient_data` action is the explicit, first-class output when an exercise has fewer than N logged sessions — not a silent guess. Smoothing: base new load/volume changes on a trailing window (e.g. last 2–3 exposures), never a single session, mirroring `conAdapt`'s existing two-strike-before-deload discipline rather than reacting to set #1's one bad day. Data-quality metadata (WHOOP connected? recent pain flag? enough history?) becomes an explicit field on every decision, not an implicit assumption.

### C. Modality separation

Already structurally real (§9) — `Modality` is a closed 5-value union, `progressionKey` buckets every progression map by format+modality, and the CondResult type stores genuinely distinct typed fields per source (`avgPowerW` for air-bike, `avgPaceSecPerKm`+`distanceM` for GPS, `deviceDistanceM` for erg — explicitly documented as never comparable to GPS distance). The one real change needed: Phase 3 makes `conAdapt`'s thresholds modality-aware instead of uniform, using the evidence already sitting in `docs/research/conditioning-evidence-bundle/modality_progression_regression_trees.json`. Concept2 data is already treated purely as historical import (§9's citation of `concept2ToCondResult`/`planConcept2Import`) — never as live telemetry — matching your explicit requirement exactly, with zero further work needed.

### D. Data contract

```ts
interface TrainingDecisionInput {
  athleteId: string;
  exercise?: { name: string; history: ExposureRecord[] };
  session?: { blocks: Block[]; completion: CompletionSignal };
  readiness?: { painFlag?: 'none'|'reported'|'stop'; reportedAt?: string };
  device?: { whoopRecovery?: number|null; concept2Recent?: Concept2Result[] };
  dataQuality: { sessionCount: number; daysSinceLast: number|null; deviceConnected: boolean };
}

interface TrainingDecisionOutput {
  action: ProgressionAction;
  prescription?: { sets?: number; reps?: number; load?: number; rpeTarget?: number };
  confidence: 'low' | 'medium' | 'high';
  reasonCodes: string[];        // stable enum values, not free text
  warnings: string[];
  safetyState: 'approved' | 'held' | 'reduced' | 'blocked';
  dataLimitations: string[];
}
```
Same input, same output, unless the decision *version* changes deliberately (a version tag on the output, so a later engine change never silently reinterprets old history).

---

## 11. Safety Review

**Confirmed and stated plainly, because the audit found it and it matters: this app currently has zero medical-emergency handling anywhere** — no chest-pain/dizziness/illness/injury language exists in any app code path (only in research-planning prose that was never implemented). This is not a defect to patch; it is the honest starting line.

| Athlete reports | Required behavior |
|---|---|
| Pain | Immediate `safetyState: 'blocked'` or `'held'` on the affected exercise/pattern until explicitly acknowledged by the athlete on a later day; **this is a same-day-shippable win** since `pain_stop` is already captured — it just needs a consumer. |
| Injury / illness | No diagnosis, ever. A structured "sit this one out" acknowledgement that pauses progression (not a form asking about symptoms) — this app should never attempt to interpret medical language. |
| Chest pain / dizziness / severe symptoms | The system's only correct response is: stop, do not train, seek medical attention — worded as a static, non-AI-generated safety notice, never something an LLM composes at generation time. This must be a hard-coded string, not a prompt-dependent one. |
| Poor sleep / severe fatigue | Feeds the confidence/readiness signal, eases prescription proportionally — same mechanism already proven for WHOOP recovery, just extended to a first-party input. |
| Repeated failed sessions | Already partially handled (`conAdapt`'s 2-strike deload) — extend the same discipline into the new strength-decision layer. |
| Abnormally high HR / missing HR data / conflicting device data | Treated as a data-quality flag, never silently substituted — `dataQuality.deviceConnected`/`warnings` in the contract above; a missing signal must never be treated as "good," only as "unknown, lower confidence." |
| Long training gap | New `missed_session_recovery` handling (currently absent, §9) — ease back in rather than resuming at the last-computed number. |
| Desire to make up missed training | The engine offers a reduced re-entry prescription; it must never let an athlete "double up" to compensate — this is a place an AI layer could be tempted to be agreeable and must be explicitly forbidden from overriding. |

**Hard boundary, non-negotiable for any future AI layer:** AI may explain a decision that the deterministic engine already approved. It may never independently select a load, override a pain/blocked state, escalate intensity, make a medical judgment, change a progression rule, or write to the database directly. This mirrors the isolation the codebase already enforces for OAuth tokens (never client-visible) and for coach-authored-vs-athlete-logged data (never mixed) — the same "one clear owner per kind of data" discipline extended to decisions.

---

## 12. Technical-Debt Review

| Item | Evidence | Severity |
|---|---|---|
| **Coach system half-deleted** | `Workout.origin`/`assignmentId` (`types.ts:163-164`) still read throughout both apps; Settings' "Link to coach" still calls a real, still-provisioned `claim_invite()` RPC (`supabase-schema.sql:121-133`); but the only RLS path that can create the invite row it consumes (`ca_coach_insert`, requires `coach_id = auth.uid()`) has no client left anywhere in the repo since `apps/coach` was deleted. This is a live dead end, not dead code. | **Decided (2026-08-01): remove entirely, no rebuild.** See exact scope below and in §13. |
| **Backup restore platform divergence** | Web defaults to merge (`restoreDb(..., 'merge')` unless "wipe" is checked); mobile's restore path always fully replaces, with no merge option. | Medium — real, currently-shipped inconsistency an athlete could be surprised by |
| **Duplicate-abandoned-workout gap** | Only guard is against two *simultaneously active* sessions; nothing prevents starting a second independent session for a workout already completed/abandoned earlier the same day, corrupting History/Progress double-counts. | Medium-High — a real, reproducible correctness bug on both platforms, independent of this project |
| **`whoop-contract.mjs` pre-existing failure** | Real token literals in two gitignored `.superpowers/sdd/` scratch docs from earlier debugging. Non-blocking (never shipped) but should be scrubbed and the tokens rotated. | Medium (hygiene, not a live exposure) |
| **No lint tooling at all** | Confirmed absence, no ESLint config or script anywhere. | Low-Medium — doesn't block anything today but means style/dead-code drift has no automated check |
| **`pain_stop`/`local_fatigue` captured and discarded** | Written once, read nowhere (§9, §11). | High for this project specifically — the cheapest, highest-leverage fix available |
| **Uniform conditioning thresholds across modalities** | `conAdapt`'s 0.45/0.6 fractions apply identically to every modality under a format, despite in-repo evidence research suggesting they shouldn't. | Medium |
| **Un-clamped extreme-value paths** | `computeSetAdjustment`'s on-target branch skips `MAX_KG`; RPE isn't domain-clamped anywhere it's consumed. | Low today (relies on caller pre-sanitization, which currently holds); Medium once an adaptive layer trusts these outputs programmatically |
| **Node engines floor untested** | Root `package.json` declares `>=20.19`; every CI workflow only ever runs Node 22. The stated floor is unverified. | Low |

No race conditions, no missing idempotency, no offline-sync conflicts were found beyond what's already correctly handled — the token-rotation race guard is applied everywhere it's structurally needed (§ data-audit), and the record-level merge design is sound. Runtime versions (Node, TypeScript) are consistent across every workspace.

---

## 13. Keep / Improve / Refactor / Rewrite / Postpone

**Keep unchanged:** `packages/engine/src/autoreg.ts`, `epley`/`num.ts`, `sessionRpe`/`sessionVolume`/`detectPRs` (`session.ts`), `conAdapt`'s gate sequence and modality-keying (`conditioning.ts`), the entire WHOOP and Concept2 integration layers (`netlify/functions/*`, `apps/*/src/cloud/{whoop,concept2}.tsx`), `sanitizeDB`'s prototype-pollution guard, the Supabase merge design (`mergeEngines`/`mergeById`/`mergeSettings`), the security/identity model (`_lib/identity.mjs`, `_lib/session.mjs`, `_lib/crypto.mjs`). All of this is correct, tested, and should not be touched by the adaptive project except by additive wrapping.

**Improve (small, targeted, in place):** consume `mechanicalCompletion`/`pain_stop` somewhere (`conditioning.ts`); add a domain clamp to RPE consumers; unify backup-restore semantics (`apps/mobile/src/screens/Settings.tsx`); add a duplicate-workout guard (`apps/{web,mobile}/src/screens/Home.tsx`, `Training.tsx`); rotate/scrub the flagged secrets in `.superpowers/sdd/2026-07-31-conditioning-evidence-based-upgrade/`.

**Refactor:** name and consolidate the currently-scattered "deload" behavior (`conAdapt` + `nextWorkingWeight`) into one explicit, documented concept the new decision layer can reason about directly, without changing either function's actual math or golden-pinned outputs.

**Rewrite:** nothing. No file audited in this pass needs a rewrite; every gap found is additive-shaped.

**Defer:** conventional-cycling/SkiErg live-device integration (no evidence of user demand, real cost); a custom AI model (see §18); React chunk-size optimization (cosmetic build warning, unrelated to this project).

**Remove — decided 2026-08-01, no invite-flow rebuild.** Exact scope, traced to the citations gathered in this audit:

*App code (both apps), ordinary git-reversible changes:*
- `packages/engine/src/types.ts:163-164` — drop `Workout.origin`/`assignmentId` and every reader of them.
- `Library.tsx` (web `:63-64`, mobile `:53-54`) — remove the `fromCoach`/`w.origin==='coach'` filter and its tab/section.
- `Planner.tsx` (web `:89`, mobile `:81`) — remove the coach-origin read-only gate.
- `Home.tsx`/`Training.tsx` (web `Home.tsx:373`, `Training.tsx:103`) — remove the "from your coach" label.
- `CoachLinkCard()` in `apps/web/src/screens/Settings.tsx:296` and `apps/mobile/src/screens/Settings.tsx:269` — delete the whole card (the "Your Coach" invite-code UI).
- `claimInvite` (web `cloud/sync.tsx:304-313`, mobile `sync.tsx:333`), `pullAssignments`/`reconcileAssignments` (`sync.tsx:123-145`; engine `cloud.ts:45-93`), `publishDigest`/`coachDigest` (`sync.tsx:147-180`; engine `cloud.ts:158-231`) — delete.
- Test fallout: `checks/react-smoke.mjs`'s "a coach-assigned session is read-only in the plan editor" scenario, and any `engine/test/*` fixtures referencing `origin`/`assignmentId` — remove or update as the code they cover disappears.
- `README.md` — drop any coach-linking documentation.

*Database — a genuinely separate, irreversible action, not bundled with the above:* `coach_library`, `coach_athletes`, `claim_invite()`, `programs`, `assignments`, `athlete_feed`, and their RLS policies in `supabase-schema.sql`, plus the matching live tables in the production Supabase project this app already runs against. This repo's own convention (confirmed in the repo-map audit) is that schema changes are hand-run SQL in the Supabase SQL Editor, not an automated migration — so this will be a reviewed `DROP TABLE`/policy-removal script for you to run yourself against production, on your own timing, separate from the app-code PR. I will not execute or schedule this without a distinct, explicit go-ahead at the time it's ready, given it is real production data with no undo.

---

## 14. Phased Implementation Roadmap

| Phase | Goal | Files affected | Do NOT touch | Acceptance criteria | Risk | Difficulty |
|---|---|---|---|---|---|---|
| **0 — Baseline & contracts** | Define `TrainingDecision`/reason-code/confidence types; wrap existing engine outputs (autoreg verdict, `conAdapt` note, `conPrescription` note) into the new shape, read-only, zero behavior change | New: `packages/engine/src/adaptive/types.ts`, `explain.ts` | `golden.test.ts`, `test/golden/*`, any existing function's signature or output | New pure functions unit-tested; golden suite unchanged 308/308; zero UI change | Very low | **2/10** |
| **1 — Training-state model & pain wiring** | Persisted, versioned, confidence-scored training-state; surface reason codes read-only in UI; **consume `pain_stop` for the first time** — a recent pain-stop holds today's prescription until acknowledged | `packages/engine/src/adaptive/*`; small "why" UI in both apps' Home/Training; a narrow, additive check in `conditioning.ts`/`lift.ts` | Existing golden-pinned function signatures/outputs (additive only) | A session with `pain_stop` yesterday blocks/holds today's prescription with an explicit reason, requiring acknowledgement to proceed; "why" text renders for at least one existing decision per app | Low–Medium (first real behavior change) | **4/10** |
| **2 — Adaptive strength progression** | Juggernaut-style decision set as a new per-exercise function layered atop `nextWorkingWeight`; Logger shows an opt-in suggestion, never forces it | New `packages/engine/src/adaptive/strength.ts`; optional Logger/Planner surfacing | `autoreg.ts`/`lift.ts` internals; manual entry stays authoritative | Deterministic decision-table test suite (50+ scenarios, à la `computeSetAdjustment.json`); explicit `pause_insufficient_data` for under-logged exercises | Medium (first recommendation surface) | **6/10** |
| **3 — Adaptive conditioning progression** | Modality-aware thresholds in `conAdapt`, sourced from the already-in-repo evidence bundle | `packages/engine/src/conditioning.ts` threshold table | `condEffort*` golden outputs; `steady`'s HR-only gate (binding prior constraint) | New per-modality test cases; golden suite untouched; thresholds traceable to `modality_progression_regression_trees.json` | Medium (touches live, just-shipped conditioning logic) | **6/10** |
| **4 — Device/historical-data integration** | Complete Echo Bike hardware validation; wire WHOOP/Concept2 connectivity into the new `dataQuality` confidence field | `packages/engine/src/adaptive/*` consuming existing providers | `netlify/functions/whoop-*/concept2-*` (already correct); Echo Bike parser (validation, not rewrite) | Known-gaps checklist fully checked; decisions correctly report low confidence when a device is disconnected | Low | **3/10** |
| **5 — Constrained AI coaching layer** | Structured data → deterministic engine → approved decision → **AI explains only** | New isolated package/function (server-side only, mirroring `_lib/whoop.mjs`'s provider-module pattern) | Any decision function directly — AI only ever reads an already-computed decision | Adversarial prompt-injection test suite (pentest.mjs-style) proving AI cannot alter a decision, bypass a hold, or claim diagnosis | Medium–High (new external dependency, new surface) | **7/10** |
| **6 — Production hardening** | Close remaining tech debt: backup-restore unification, duplicate-workout guard, secret rotation, **full coach-system removal (decided)**, lint baseline | `apps/mobile/src/screens/Settings.tsx`, `Home.tsx`/`Training.tsx`/`Library.tsx`/`Planner.tsx` both apps, `apps/*/src/cloud/sync.tsx`, `packages/engine/src/{types,cloud}.ts`, `.superpowers/sdd/*` scrub, `supabase-schema.sql` (app-code and schema as two separate reviewed changes — see §13) | — | Existing CI green throughout; each item its own reviewed commit per this repo's established SDD discipline; coach removal specifically verified by full `pnpm run verify` + a targeted re-run of `checks/react-smoke.mjs` with the now-removed coach scenario deleted, not just skipped | Low per-item; coach removal's app-code half is git-reversible, its schema half is not | **4/10** |

Every phase keeps `pnpm run verify` green throughout, per this repo's own standing rule. Coach removal's app-code half can ship inside Phase 6 like any other tech-debt item; its Supabase schema half is executed by you, separately, on your own timing (§13).

---

## 15. The Single Highest-Risk Issue

**Building a confidence-scored, reason-coded adaptive layer that *sounds* authoritative on top of a safety-signal substrate that currently has almost no first-party input reaching any decision.** The engine's existing recovery-gating is real and works — but it is driven entirely by one third-party number (WHOOP `recoveryScore`), and the one first-party signal that does exist (`pain_stop`) is silently discarded today. If Phase 2/3's more assertive-feeling recommendations ship before Phase 1's pain-wiring and confidence-scoring, the system would present decisions with a polish that outstrips their actual evidentiary basis — precisely the failure mode MacroFactor's design philosophy (and your own stated requirements) exist to prevent. This is why the roadmap above puts the pain-wiring fix in Phase 1, before any new strength/conditioning logic.

(For completeness, the highest-risk *pre-existing* correctness bug independent of this project is the duplicate-abandoned-workout gap, §12 — worth fixing in Phase 6 regardless of whether the adaptive project proceeds.)

---

## 16. The Smallest Valuable First Version

**Phase 0 in full, plus one narrow slice of Phase 1: wire up `pain_stop`.** Concretely: a pure, new, additively-tested function that checks whether the most recent conditioning result for a given exercise/pattern carries `mechanicalCompletion: 'pain_stop'`, and if so, returns `safetyState: 'held'` with a plain-language reason for the next prescription touching that pattern, requiring an explicit athlete acknowledgement to clear. This ships real safety value in the smallest possible diff — the field already exists, is already captured by the UI, and today does nothing. No new UI is strictly required for v0 (a held state can render as a simple banner using components that already exist), no golden fixture is touched, and it directly demonstrates the "wrap, don't replace" principle the rest of the roadmap depends on.

---

## 17. Whether AI Should Be Added Now

**Not yet — build Phases 0–3 first.** There is nothing safe for an AI layer to explain until the deterministic decisions it would narrate actually exist in reason-coded form, and there is no safety substrate yet for an AI layer to respect boundaries around (§11, §15). Adding AI now would mean either it has nothing structured to work from (so it improvises, which is the exact failure mode to avoid) or it gets built in parallel with the safety substrate and inherits its gaps. The architecture in §10/§14 is deliberately AI-ready for *later* — clean input/output contracts, a strict one-way data flow, server-side-only secret handling matching the WHOOP/Concept2 precedent — so adding it in Phase 5 is a small, well-bounded step once there's something real to explain.

---

## 18. Whether a Custom AI Model Should Be Trained From Scratch

**No.** This is a deterministic rules-and-heuristics problem, not a pattern-learning-from-data problem — there is no training dataset of the necessary shape or scale in this app (nor should there be; per-athlete training decisions need to be auditable and explainable, which a custom-trained model actively works against). Neither JuggernautAI nor MacroFactor trains a custom model for their core adaptive logic either — both are rules engines with the same deterministic, reason-coded shape this design proposes. If natural-language interpretation is needed later (Phase 5), an existing general-purpose LLM used strictly as an explainer/parser is the right tool; training one from scratch would be pure downside — cost, opacity, and drift risk — with no corresponding benefit for this problem.

---

## 19. Exactly What You Should Approve Before Code Changes Begin

1. **The overall sequencing** — Phase 0/1 (contracts + pain-wiring) before any new strength/conditioning recommendation logic, and AI strictly deferred to Phase 5.
2. ~~**The coach-system decision**~~ — **Settled 2026-08-01: remove entirely, no invite-flow rebuild.** Exact scope in §13. The app-code half is ordinary reversible work; the Supabase schema half is a separate, irreversible production action you'll run yourself when ready — I will not touch it without a distinct confirmation at that time.
3. **The `pain_stop`/`local_fatigue` wiring approach** (§16) — confirm that a hold-until-acknowledged UX is the right first behavior change, since it's the first thing in this whole project that changes what an athlete actually experiences.
4. **The tech-debt items to fold into Phase 6 now versus later** (§12) — particularly the backup-restore unification and the duplicate-workout guard, both of which are real, already-shipped issues independent of the adaptive project.
5. **Whether Phase 3's modality-specific conditioning thresholds should ship from the existing in-repo evidence bundle as-is, or whether you want a fresh evidence review first.**

Once these are settled, the next step is a `writing-plans`-style, task-by-task implementation plan for Phase 0 (and only Phase 0, reviewed again before Phase 1 starts) — per your instruction, no code changes happen before that.
