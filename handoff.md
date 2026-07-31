# Handoff

## 1) Goal

Execute the 14-task conditioning-upgrade plan (`docs/superpowers/plans/2026-07-31-conditioning-evidence-based-upgrade.md`) end to end via subagent-driven development: modality-aware conditioning progression, felt-RPE capture on both athlete apps, conAdapt reweighting, Rogue Echo Bike V3 FTMS connectivity (web Web Bluetooth + mobile react-native-ble-plx), and a full Concept2 Logbook OAuth integration (server functions, client providers, Settings UI, engine-side result matching, contract check) — then final whole-branch review, full verification, and push.

## 2) Current State

**COMPLETE AND PUSHED.** All 14 tasks done, final whole-branch review passed after one fix wave, `origin/main` is at `494540a` (pushed range `7d1fcd8..494540a`).

- Working directory: `/workspace/the-hybrid-engine1`, branch `main`, clean tree, in sync with origin.
- Plan base commit: `cd73ef5`. Branch total: 25 commits, 38 files, +3579/−36.
- Verification at HEAD: engine 283/283 (golden.test.ts 33/33 byte-untouched, fixtures byte-identical), mobile 71/71, web+mobile typecheck clean, web build + CSP check clean, `checks/concept2-contract.mjs` all PASS (97 assertions), react-smoke 27/27 on final run.
- SDD ledger (full audit trail incl. every fix round and deferred minor): `.superpowers/sdd/2026-07-31-conditioning-evidence-based-upgrade/progress.md` (gitignored, on disk only). Final review: `final-review.md` in the same directory.
- claude-mem 13.12.4 was installed in this container mid-session (user request); note the container is ephemeral, so it does not persist.

## 3) Active Files

Key files touched by this plan (see `git diff cd73ef5..494540a --stat` for the full 38):

- `packages/engine/src/types.ts` — `Modality`, `DeviceInfo` fields, `Concept2Result`, `CondResult.deviceDistanceM`
- `packages/engine/src/conditioning.ts` — `progressionKey(fmtKey, modality?)`, conAdapt reweighting, completion split
- `packages/engine/src/concept2.ts` — `matchConcept2Result`, `concept2ToCondResult` (pure, tested, **not yet wired into any sync flow**)
- `netlify/functions/_lib/concept2.mjs` + `concept2-connect.mjs` / `concept2-callback.mjs` / `concept2-sync.mjs` — OAuth + pull-based sync against `https://log.concept2.com`
- `netlify/functions/integrations-status.mjs`, `integrations-disconnect.mjs` — concept2 branches
- `apps/web/src/cloud/concept2.tsx`, `apps/mobile/src/cloud/concept2.tsx` — client providers (mirror the WHOOP pattern); mobile deep-link filter requires `integration=concept2`, and `apps/mobile/src/cloud/whoop.tsx` carries the mirror-image negative-lookahead filter
- `apps/web/src/native/echoV3.ts`, `apps/mobile/src/native/capabilities.ts` (`createFtmsMonitor`) — FTMS parsers, byte-identical logic
- `apps/web/src/screens/Conditioning.tsx`, `apps/mobile/src/screens/Conditioning.tsx` — live bike stats, felt-RPE, completion capture (mobile `bank()` derives `cardioCompletion` on every write path)
- `apps/web/src/screens/Settings.tsx`, `apps/mobile/src/screens/Settings.tsx` — Concept2Card both apps
- `checks/concept2-contract.mjs` — static contract check, wired into `.github/workflows/ci.yml`'s contract loop
- `README.md` — `CONCEPT2_CLIENT_ID`/`CONCEPT2_CLIENT_SECRET` documented (contract check enforces this)

## 4) Changes Made

Chronological through this session's visible span (Tasks 9→14 + finale; Tasks 1–8 were earlier):

- `e5e3143`/`5c9ddce` — Task 9: mobile BLE FTMS reader + Conditioning wiring
- `4643601`, `5844cae`, `821939f` — Tasks 10–11: Concept2 provider module + connect/callback/sync; token-rotation race fixed (re-load freshest token before one-time providerUserId backfill save)
- `ddea8ca` — Task 12: client providers, App mounts, Settings cards, `integration=` deep-link disambiguation
- `a5c57be` + `4fce7e1` — Task 13: engine matcher + result mapping; fix round: **durationRaw is tenths of a second → `dur = durationRaw / 10`**, modality filter inside matcher, unit-discriminating tests
- `a6a52c3` + `7bd68fe` — Task 14: concept2-contract check (97 PASS); fix round removed a `|| true` fake-passing assertion
- `224f57c` — final-review fix wave: erg metres moved off GPS-only `distanceM` onto new `deviceDistanceM`; mobile Bank & leave sets `cardioCompletion`; honest Settings copy; README env docs + contract assertion
- `494540a` — provider header comments corrected (matching not wired yet)

## 5) Failed Attempts

- **Task 13 first pass** stored Concept2 `durationRaw` into `dur` unconverted (10× too large — Concept2 reports tenths of a second). Caught by task review, fixed in `4fce7e1`. Lesson recorded: the server normalizer (`_lib/concept2.mjs`) keeps raw API units by design; engine-side consumers must convert.
- **Task 14 first pass** shipped one assertion with `|| true`, making it unable to fail. Caught by review, fixed in `7bd68fe`.
- **First `pnpm run verify` after the fix wave failed** on a react-smoke guided-builder scenario (30s timeout). Investigated systematically: reproduced the same failure class at plan base `cd73ef5` (1 of 3 runs) where none of this branch exists → **pre-existing environment/timing flake, not a regression**. Fails ~25–40% of runs under load on two different guided-builder tests (`warm-up note carries into Planner` at `checks/react-smoke.mjs:472`, and `browser Back` timeouts). Untouched by this branch; worth a stabilization pass someday.
- **Ollama install blocked**: this environment's network gateway denies CONNECT to `ollama.com` (403 policy denial). Needs an environment network-policy change on claude.ai to allow, and is of limited use in an ephemeral CPU-only container anyway.

## 6) Next Steps

1. **Wire the engine matcher into the sync flow** — `matchConcept2Result`/`concept2ToCondResult` are built and tested but have zero callers; synced Concept2 results are viewable in Settings but never land in History/Progress. This was deliberately NOT done in the fix wave (unplanned DB-write behavior); it needs its own small plan (where matching runs, dedupe by `externalId`, user confirmation UX).
2. **Production prerequisites** (cannot be done from code): register the app with Concept2, set `CONCEPT2_CLIENT_ID`/`CONCEPT2_CLIENT_SECRET` in Netlify, then run the real-account checklist `docs/research/concept2-logbook-bundle/KNOWN_GAPS.md` and the Echo V3 physical-device test plan `docs/research/echo-v3-connectivity-bundle/evidence/known_gaps.md`.
3. **Deferred minors** — 26 recorded in the ledger; final review ruled all OK-to-defer except the README docs gap (already fixed). Highest-value ones: `useSyncExternalStore` migration for the RUN pending-state pattern, DeviceInfo named type, react-smoke flake stabilization.
4. **Unrelated pending backlog** (predates this plan, still open in the session task list): emit/cloud shape-safety gaps, `sessionRpe` excluding conditioning, `epley` MAX_KG bound, autoreg missed-set rounding, web/mobile Training.tsx divergence.
