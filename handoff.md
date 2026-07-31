# Handoff

## 1) Goal

Ship the conditioning-evidence-based upgrade end to end and clear the remaining bug backlog. The upgrade (14-task plan, `docs/superpowers/plans/2026-07-31-conditioning-evidence-based-upgrade.md`): modality-aware conditioning progression, felt-RPE capture on both athlete apps, conAdapt reweighting, Rogue Echo Bike V3 FTMS connectivity, full Concept2 Logbook OAuth integration (server functions, client providers, Settings UI, engine matcher + import flow, contract check). The backlog: five verified correctness bugs predating the plan.

## 2) Current State

**ALL CODE WORK COMPLETE AND PUSHED.** `origin/main` is at `0ff6367`. What remains needs a human: two hardware/account tests and one policy ruling (see Next Steps).

- Working directory: `/workspace/the-hybrid-engine1`, branch `main`, clean tree, in sync with origin.
- Conditioning plan: complete (base `cd73ef5`, final commit `494540a`), final whole-branch review passed after one fix wave. A follow-up session then wired the Concept2 import flow (`planConcept2Import`/`applyConcept2Import`, "Add N new results" in both Settings cards, dedupe by `externalId` → record id `c2-<externalId>`).
- Backlog batch: complete (4 commits, `9439acb..0ff6367`), review-approved, full `pnpm run verify` green (exit 0, 40 smoke PASS).
- **Concept2 is deployed live**: `CONCEPT2_CLIENT_ID`/`CONCEPT2_CLIENT_SECRET` are set on Netlify site `thehybridengine1` (secret-marked, functions scope), deploy `6a6d080b…` ready. Authorize-URL construction verified against the deployed code path: `https://log.concept2.com/oauth/authorize`, redirect `https://thehybridengine1.netlify.app/.netlify/functions/concept2-callback`, scope `user:read,results:read`.
- Verification at HEAD: engine 308/308 (golden 33/33, fixtures byte-untouched throughout), mobile 71/71, web vitest 3/3, both typechecks clean, web build + CSP clean, concept2-contract all PASS, react-smoke 28/28 (2 new Training scenarios).
- Audit trails (gitignored, on disk only): `.superpowers/sdd/2026-07-31-conditioning-evidence-based-upgrade/progress.md` + `final-review.md`; backlog: `.superpowers/sdd/backlog-investigation.md`, `backlog-fixes-report.md`, `backlog/batch-review.md`.
- This container is ephemeral: claude-mem (13.12.4) and everything not pushed dies with it.

## 3) Active Files

Conditioning plan (see `git diff cd73ef5..494540a --stat` for all 38):
- `packages/engine/src/types.ts` — `Modality`, `Concept2Result`, `CondResult.deviceDistanceM`
- `packages/engine/src/conditioning.ts` — `progressionKey(fmtKey, modality?)`, conAdapt reweighting, completion split
- `packages/engine/src/concept2.ts` — matcher + `concept2ToCondResult` + (follow-up session) `planConcept2Import`/`applyConcept2Import`
- `netlify/functions/_lib/concept2.mjs`, `concept2-{connect,callback,sync}.mjs`, concept2 branches in `integrations-{status,disconnect}.mjs`
- `apps/{web,mobile}/src/cloud/concept2.tsx` — providers; `integration=` deep-link disambiguation incl. mobile whoop.tsx negative-lookahead filter
- `apps/web/src/native/echoV3.ts`, `apps/mobile/src/native/capabilities.ts` — FTMS parsers (byte-identical logic)
- `apps/{web,mobile}/src/screens/Conditioning.tsx`, `Settings.tsx` — live bike stats, felt-RPE, completion, Concept2Card
- `checks/concept2-contract.mjs` — 110 assertions, wired into ci.yml's contract loop; `README.md` documents the Concept2 env vars (check-enforced)

Backlog batch:
- `packages/engine/src/session.ts` — `sessionRpe` folds conditioning felt into the average
- `packages/engine/src/db.ts` — `sanitizeDB` scrubs non-object `settings.conditioning` entries
- `packages/engine/src/autoreg.ts` — missed-set suggestion clamped ≤ failed weight (steps down one `AUTOREG.plateIncrement`)
- `apps/web/src/screens/Training.tsx` — finish-early confirmation + clickable completed conditioning card (mobile parity)
- `checks/react-smoke.mjs` — 2 new Training scenarios

## 4) Changes Made

Conditioning plan (25 commits, highlights): Tasks 9–12 (`e5e3143`→`ddea8ca`) mobile FTMS + Concept2 server/client layers; Task 13 (`a5c57be`+`4fce7e1`) engine matcher — **fix round caught `durationRaw` being tenths of a second → `dur = durationRaw / 10`**; Task 14 (`a6a52c3`+`7bd68fe`) contract check — fix round removed a `|| true` fake-pass; final fix wave (`224f57c`) erg metres → `deviceDistanceM` (GPS-only invariant), mobile Bank & leave sets `cardioCompletion`, honest Settings copy, README env docs; `494540a` comment corrections. Then env vars set on Netlify + trigger deploy (`2402303`).

Backlog batch (all review-approved):
- `9439acb` — sessionRpe includes conditioning felt RPE (strength-only sessions byte-identical)
- `a1f951a` — sanitizeDB filters `settings.conditioning` to real objects (fixes Progress-screen crash from poisoned backup/sync data)
- `eb6272a` — autoreg no longer suggests a heavier weight after a missed set when logged weight isn't a plate multiple (e.g. 24.9 kg → was 25 kg "good")
- `0ff6367` — web Training: confirmation before early finish with unlogged sets; completed conditioning card reopens recap

## 5) Failed Attempts

- **epley MAX_KG clamp — deliberately NOT fixed (open ruling, see Next Steps).** The clamp was implemented, empirically turned golden red (`test/golden/epley.json` pins unbounded output for kg=1999/2000/2001 as vanilla-ported behavior), and was reverted per the "golden is sacrosanct" rule. Inputs are already clamped to 2000 kg at entry, so risk is theoretical.
- **Task 13 first pass** stored `durationRaw` unconverted (10× too large). Caught by review. Lesson: the server normalizer keeps raw API units by design; engine consumers must convert.
- **Task 14 first pass** shipped a `|| true` assertion that could never fail. Caught by review.
- **react-smoke guided-builder flake**: fails ~25–40% of runs under load (30s timeouts; `warm-up note carries into Planner` at checks/react-smoke.mjs:472 and `browser Back`). Reproduced at plan base `cd73ef5` → pre-existing, not a regression. Worth a stabilization pass.
- **Live-site testing from this container is impossible**: the environment's egress proxy denies `netlify.app` (and `ollama.com`) with CONNECT 403 — network-policy change on claude.ai required to allow. Netlify MCP tools still work (different relay); its write endpoint 502'd twice before succeeding (transient).

## 6) Next Steps

1. **Concept2 live round-trip (user, ~30s):** on `https://thehybridengine1.netlify.app/settings`, sign in → Connect on the Concept2 card → approve on log.concept2.com → back in Settings, Pull → results + "Add N new results". If Concept2 shows "invalid redirect_uri", the portal's registered URI must exactly match `https://thehybridengine1.netlify.app/.netlify/functions/concept2-callback`. Then work through `docs/research/concept2-logbook-bundle/KNOWN_GAPS.md`.
2. **Echo Bike physical test (user, planned "tomorrow"):** Chrome/Edge or the Android app → Conditioning → "Connect Echo Bike" (console awake, nothing else connected, no OS pairing). First real connection doubles as the validation in `docs/research/echo-v3-connectivity-bundle/evidence/known_gaps.md`. The FTMS parser has never met a real V3 — capture any wrong numbers/disconnects for parser fixes.
3. **epley ruling — CLOSED as won't-fix (user decision, 2026-07-31):** the unbounded Epley projection is vanilla-ported behavior pinned by golden fixtures (`test/golden/epley.json`, kg=1999/2000/2001 rows), and weight inputs are already clamped to MAX_KG at entry. Do not re-open without a decision to edit golden fixtures.
4. **Deferred minors** (all ruled OK-to-defer): react-smoke flake stabilization, `useSyncExternalStore` migration for the RUN pending-state pattern, named `DeviceInfo` type, `felt: 0` explicit test for sessionRpe, order-dependence note in the new smoke scenario.
5. **Also pending from the earlier secret paste:** the Concept2 client secret passed through chat — cheap insurance to rotate it in the Concept2 portal and update the Netlify var once things are verified working.
