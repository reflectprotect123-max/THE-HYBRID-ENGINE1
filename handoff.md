# Handoff

## 1) Goal

Ship the conditioning-evidence-based upgrade end to end, clear the pre-existing bug backlog, and get Concept2 Logbook + Echo Bike V3 verified against real accounts/hardware. The upgrade (14-task plan, `docs/superpowers/plans/2026-07-31-conditioning-evidence-based-upgrade.md`): modality-aware conditioning progression, felt-RPE capture on both athlete apps, conAdapt reweighting, Rogue Echo Bike V3 FTMS connectivity, full Concept2 Logbook OAuth integration.

## 2) Current State

**ALL CODE WORK COMPLETE AND PUSHED. Concept2 is verified live end-to-end.** `origin/main` is at `f0aa3a1`. Only the Echo Bike physical test remains.

- Working directory: `/workspace/the-hybrid-engine1`, branch `main`, clean tree, in sync with origin.
- Conditioning plan (complete) + backlog batch (complete, 4 commits) + epley ruling (closed as won't-fix, user decision) — all from the prior handoff, unchanged.
- **Concept2 OAuth round-trip confirmed working live** by the user: Settings → Connect → consent on log.concept2.com → back in the app → connected, pulled successfully. This was the last open verification gate on the whole plan besides Echo Bike.
- Along the way, found and fixed a real bug: the web Concept2 provider ignored the OAuth outcome the server stamps onto the return URL, so any failure (denial, exchange error) would have looked identical to "never connected," with zero diagnostic text. Fixed in `f0aa3a1` — now parses `status`/`message` from the return URL, sets a real error message, and strips the one-time params via `history.replaceState`.
- Also re-confirmed `CONCEPT2_CLIENT_SECRET` on Netlify (site `thehybridengine1`) during that investigation — it was the one env var that didn't show up in a full `getAllEnvVars` listing (every other secret in this project, including WHOOP's, is stored unmasked and does appear). Most likely just Netlify hiding secret-flagged values from listings, but re-upserted it to eliminate the possibility it had been lost. Live deploy `6a6d294c…` carries both that and the fix.
- Verification at HEAD: engine 308/308 (golden 33/33 untouched throughout), mobile 71/71, web vitest 3/3, both typechecks clean (re-confirmed after the concept2.tsx fix), web build clean, concept2-contract all PASS, react-smoke 28/28.
- Audit trails (gitignored, on disk only): `.superpowers/sdd/2026-07-31-conditioning-evidence-based-upgrade/progress.md` + `final-review.md`; backlog: `.superpowers/sdd/backlog-investigation.md`, `backlog-fixes-report.md`, `backlog/batch-review.md`.
- Two unrelated commits landed on `main` from outside this thread: `800ed79`/`6f39123`, fixing the mobile OTA workflow to publish to the correct EAS channel. Not reviewed as part of this work; flag if it needs attention.
- This container is ephemeral: everything not pushed (including claude-mem's memory) dies with it.

## 3) Active Files

Conditioning plan + backlog batch: unchanged from the prior handoff (see `git diff cd73ef5..0ff6367 --stat`).

New this round:
- `apps/web/src/cloud/concept2.tsx` — provider now parses the OAuth return URL (`integration=concept2&status=...&message=...`), sets `error` accordingly, strips the params via `history.replaceState`. Mirrors the wording mobile's `handleReturn` already used (`denied`/`error`/`connected`).

## 4) Changes Made

Everything through the prior handoff (conditioning plan 25 commits, backlog batch 4 commits, `925ec49` epley ruling) is unchanged — see that handoff's section 4 or `git log`.

New this round:
- `f0aa3a1` — web: Concept2 provider reads `status`/`message` off the post-redirect URL instead of discarding it; Settings' existing (previously always-empty) error line now actually renders a denial/failure message on the next bad attempt.
- Netlify: re-upserted `CONCEPT2_CLIENT_SECRET` (functions scope, secret-marked) as a precaution; a follow-up attempt to also drop its secret flag to match `WHOOP_CLIENT_SECRET`'s plaintext-listing convention was rejected by Netlify's API (422) — Netlify does not allow flipping `is_secret` on an existing var via upsert. Left as secret-marked; this did not block anything (the live connect subsequently succeeded).
- Result: **user-confirmed live OAuth success** — connect, consent, return, connected, pull all worked.

## 5) Failed Attempts

Unchanged from the prior handoff (epley clamp reverted against golden, Task 13/14 first-pass bugs caught by review, react-smoke guided-builder flake, this container's network policy blocking `netlify.app`/`ollama.com`).

New this round:
- **Netlify secret-flag change rejected (422):** tried to re-upsert `CONCEPT2_CLIENT_SECRET` with `envVarIsSecret: false` and full scope (`builds`/`functions`/`post_processing`/`runtime`) to match `WHOOP_CLIENT_SECRET`'s exact configuration, for elimination purposes while root-causing the "doesn't pull anything" report. Netlify's API returned 422 — flipping an existing var's secret flag via upsert isn't permitted. Non-blocking: the plain secret-scoped upsert (functions scope, `is_secret: true`) succeeded, and that turned out to be sufficient — the live connect worked without this change.
- **Root cause of the original "connects but Settings still shows disconnected" report turned out to be moot** in the end: the user clarified their Concept2 account had no logged results, and once retried post-fix, the connection worked. The silent-failure bug in concept2.tsx (described above) may or may not have been the actual cause of that first attempt — it's fixed regardless, since it was a real gap independent of what caused that specific report.

## 6) Next Steps

1. **Echo Bike V3 physical test (user, only remaining item):** Chrome/Edge or the Android app → Conditioning → "Connect Echo Bike" (console awake, nothing else connected, no OS pairing). First real connection doubles as the validation in `docs/research/echo-v3-connectivity-bundle/evidence/known_gaps.md`. The FTMS parser has never met a real V3 — report any wrong numbers, disconnects, or missing fields for parser fixes.
2. **Concept2 real-account checklist:** now that the connection works, work through `docs/research/concept2-logbook-bundle/KNOWN_GAPS.md` if deeper validation is wanted (e.g. testing with an account that has logged rower/SkiErg/BikeErg results, confirming the import flow lands them correctly in History/Progress).
3. **Housekeeping:** rotate the Concept2 client secret in the Concept2 developer portal + update the Netlify env var — it passed through chat earlier in plaintext. Not urgent, but cheap insurance.
4. **Deferred minors** (all ruled OK-to-defer, unchanged): react-smoke flake stabilization, `useSyncExternalStore` migration for the RUN pending-state pattern, named `DeviceInfo` type, `felt: 0` explicit test for sessionRpe.
5. **Optional:** look at the two unrelated OTA-workflow commits (`800ed79`/`6f39123`) if the mobile release pipeline needs review — they weren't produced or reviewed as part of this thread.
