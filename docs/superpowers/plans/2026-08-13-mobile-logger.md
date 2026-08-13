# Mobile Logger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/mobile`'s session logger with the round-major one, rendered on `@hybrid/session-authoring`, and prove it a mirror of the prototype using the parity gates already built — so the Android APK ships something checked rather than eyeballed.

**Architecture:** The same hook the web screens used, rendered with React Native primitives. The hook owns every decision. To let browser-based parity gates judge a React Native app, the app gains a **parity harness entry**: a separate Expo Web entry point that mounts only the logger over a seeded session. It exists to be driven by a check, and it is the app's real screens, not a copy of them.

**Tech Stack:** React Native under Expo 54, React 19, `react-native-web` for the harness only, Vitest/Jest, Playwright for the gates.

This is slice 6 of `docs/superpowers/specs/2026-08-12-round-major-logger-design.md`. Slices 4 and 5 are parked: the athlete web surface no longer authors or logs, and the builder moved into the coach bench.

## Why a harness, and what it does and does not prove

Both parity gates drive a browser. React Native is not a browser, so they cannot drive the Android app directly. Three options were weighed and the owner chose Expo Web.

The naive version — export the whole app to web — will not work here. `apps/mobile` depends on `react-native-ble-plx`, `expo-mlkit-ocr`, `react-native-maps`, `expo-notifications` and others with no web implementation. A full web export drags all of them in.

So the harness mounts ONLY the logger screens, over a session seeded from `checks/fixtures/session.json`, with no navigation stack, no BLE, no camera, no maps. Storage is not a problem: `apps/mobile/src/store/storage.ts` already falls back to an in-memory shim when MMKV cannot load, and it is documented there as answering a read-after-write exactly like MMKV does.

**What this proves:** that the screens, rendered from the shared hook, produce the same behaviour and the same layout as the prototype — the same coaching strings, the same rotation outcomes, the same 412px composition.

**What it does not prove:** that Android renders identically to `react-native-web`. Fonts, shadows and text metrics differ. The visual gate against the harness is a strong signal, not a device guarantee, and this plan does not pretend otherwise. The APK still wants one human look before release.

## Global Constraints

- No decision logic in `apps/mobile`. If a diff computes a weight, picks the next set, or decides a superset's order, it is wrong — that belongs to `@hybrid/session-authoring` or `@hybrid/engine`. Four separate gaps were found this way during the web build; every one belonged in the package.
- Every element the parity vocabulary names carries its hook. On React Native that is `testID`, with the SAME values — `react-native-web` renders `testID` as `data-testid`. The vocabulary table lives in `docs/superpowers/plans/2026-08-13-parity-harness.md`. Note in particular that an RPE chip's value has its decimal point removed and nothing else: 7 is `rpe-7`, 7.5 is `rpe-75`, 10 is `rpe-10`.
- **A task gate is `typecheck` AND tests, never tests alone.** Vitest and Jest do not typecheck.
- Ends green: `pnpm run typecheck` and `pnpm run test`. There is no known-red list; any failure is yours or a real regression.
- No placeholders — no `TODO`, no stub, no mock data.
- Tests colocated, per the repo rule.
- `react-native-web` and `react-dom` are DEV dependencies of `apps/mobile`, used by the harness and the gates. They must not reach the Android bundle. Prove that in Task 1.

---

### Task 1: The parity harness, proved empty first

Build the harness before there is anything to put in it, so that when a screen fails the gate you know it is the screen.

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/app.json`
- Create: `apps/mobile/parity/index.html`, `apps/mobile/parity/entry.tsx`, `apps/mobile/parity/README.md`
- Modify: `package.json` (a script to serve it)

- [ ] **Step 1: Add web support, dev-only**

Add `react-native-web` and `react-dom` to `apps/mobile`'s **devDependencies**, and whatever Expo needs to export for web. Do not add them to `dependencies`.

- [ ] **Step 2: Write the harness entry**

`apps/mobile/parity/entry.tsx` mounts ONLY the logger screen over a session read from `checks/fixtures/session.json`, with the storage shim and no navigation. At this task the logger does not exist yet, so it mounts a single `<View testID="parity-harness-ready" />` instead. That is not a placeholder in shipped code — it is the harness's own liveness marker, it lives outside `src/`, and Task 7 replaces it with the real screen.

- [ ] **Step 3: Prove it serves and renders**

Build or serve the harness, load it in Chromium, and assert `[data-testid="parity-harness-ready"]` exists. This is the step that proves `testID` really does become `data-testid` through `react-native-web` — the assumption the whole gate strategy rests on. If it does not, stop and report BLOCKED; everything downstream depends on it.

- [ ] **Step 4: Prove the Android bundle is unaffected**

Run the mobile bundle/export for Android and confirm `react-native-web` and `react-dom` are absent from the output. The repo has done this kind of canary check before — look at how earlier work verified that test files never reach a shipped artefact, and follow it. Record the exact command and its evidence in your report. A dev dependency that silently ships is a real regression in APK size and risk.

- [ ] **Step 5: Commit**

---

### Task 2: The screen shell and its bridges

Mirror of `apps/web`'s `SessionLogger`, which is the reference for what the shell owes: read the session, persist it, hold the wake lock, and bridge rest to the app's own rest mechanism so notifications still fire. That file is deleted from the repo — read it at commit `c4036c7` (`git show c4036c7:apps/web/src/screens/logger/SessionLogger.tsx`) rather than reinventing it, and note the two things it got right after review:

- the hook returns `session`; use it. Do not run a second reducer loop beside the hook to manufacture one.
- the rest bridge latches on ARMING, not on the rest object's identity. Every tick makes a new `RestState`; an identity-keyed effect restarts the notification timer once a second. `+15` relays to the store's own add rather than restarting it.

Mobile's equivalents: wake lock is `expo-keep-awake`, notifications are `expo-notifications`. Find how the existing `apps/mobile/src/screens/Logger.tsx` uses them and carry that over rather than inventing new plumbing.

---

### Task 3: Block strip and round list
### Task 4: The hot card
### Task 5: The rest takeover
### Task 6: Pieces and the finish card

These four mirror the web screens one for one. For each, read the web version at commit `c4036c7` under `apps/web/src/screens/logger/`, and re-express it with React Native primitives — `View`, `Text`, `Pressable`, `TextInput` — and the mobile app's existing styling approach. Do not port class names; port structure and behaviour.

Every `data-parity` attribute becomes a `testID` with the identical value. Every test the web version had has a mobile equivalent, including these, which each pin a bug found the hard way:

- receipts number WITHIN a block, not across the session — all block screens are mounted at once, so global numbering matches every block's first receipt
- the rotate grip is reachable without a pointer, and appears only on a round that has not started
- the coaching message renders VERBATIM from the hook; a parity gate asserts the exact string
- a `'block'` page turn shows no dial; only a timed rest does
- the rest store is armed exactly once across many ticks
- a prep block never becomes the live set and never reaches the coaching rule

The last one is now enforced in the package, but the test belongs here too: it is the rule `CLAUDE.md` cares most about, and a screen that reintroduces it locally would pass every package test.

---

### Task 7: Switch, delete, and pass the gates

- [ ] **Step 1: Point the harness at the real screen**

Replace the liveness marker in `apps/mobile/parity/entry.tsx` with the real logger.

- [ ] **Step 2: Switch the app's own route and delete the old logger**

`apps/mobile/src/screens/Logger.tsx` and its tests go, in the SAME commit that points mobile's navigation at the new screen. No commit where both exist, none where neither does.

- [ ] **Step 3: Run both gates against the harness**

```
node checks/parity-behaviour.mjs --phase=run --target=<harness url>
node checks/parity-visual.mjs --phase=run --target=<harness url>
```

- [ ] **Step 4: Fix what they find, and do not re-record**

Expect failures first time. A missing hook means the screen is incomplete. A differing coaching message means the screen is rewording what the engine said. A visual difference means the markup differs from the prototype — the gate names a diff image; look at it.

Do NOT re-record the baselines to make failures go away. They describe the prototype, which is the specification. Re-recording is how a parity gate becomes decorative. If you believe a baseline is genuinely wrong, stop and report rather than overwriting it.

Expect SOME visual difference to be `react-native-web` rather than the screen — text metrics and shadows differ from hand-written HTML. Judge each one and say which bucket it is in. If a difference is genuinely a renderer artefact and not a mistake, say so with evidence rather than adjusting the threshold to hide it; a threshold raised to absorb one real difference blinds the gate to every other difference of that size.

- [ ] **Step 5: Full gate, then the APK**

`pnpm run typecheck && pnpm run test && pnpm run check:ecosystem`

The EAS build is a real release action and is NOT part of this plan. It needs the owner's explicit go-ahead.

---

## Self-Review

Against slice 6 of the spec: React Native screens on the same hook (Tasks 2-6), old logger deleted in the same commit as the switch (Task 7), gates passing for the mobile athlete surface (Task 7).

Where this plan knowingly departs from the spec, and why: the spec assumed all three gates run against every surface. They cannot run against Android directly, so they run against an Expo Web harness of the real screens. That is stated in full above, including what it does not prove. The alternative — no gate on mobile at all — would have shipped the APK on unit tests alone.

Tasks 3-6 are specified by reference to the deleted web screens at `c4036c7` rather than by pasted code. That is deliberate: those files were reviewed, and re-typing them into this plan would introduce transcription errors of exactly the kind that produced the `rpe-100` contract bug. The reference is a commit, so it cannot drift.
