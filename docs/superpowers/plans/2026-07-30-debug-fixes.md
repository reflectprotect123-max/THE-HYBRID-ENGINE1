# Source-verified functional fixes — audit round 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 27 source-verified defects from `scratchpad/debug/verified.md` (3 Critical + 24 Important) — the proto-pollution wipe, the legacy-cond white-screen, two-block weight banking, and the data-integrity / engine-math / coach-authoring / web-perf batch — with no golden fixture regenerated.

**Architecture:** Engine fixes are guards and dedupes at the existing seams (`isWarmupBlock`, `reps > 0`, `hasOwnProperty`), scoped so each changes behaviour only for inputs the golden vectors do not sample — a green golden run is the proof of correctness. App fixes mirror a guard the sibling platform already ships (Home's inside-write guard, mobile's `updateSession` / `MIN_LOGGABLE_SEC` / sink-by-ref) onto the surface that never got it. Coach fixes extend the guided flow that already exists at HEAD (cond-detail, edit/delete/rename all landed in the prior round).

**Tech Stack:** TS + engine (vitest, `packages/engine`), React + TS (`apps/web`, `apps/coach`), React Native/Expo (`apps/mobile`, jest), Playwright smoke (`checks/react-smoke.mjs`).

## Global Constraints

- **Golden is sacrosanct.** `packages/engine/test/golden.test.ts` pins `computeSetAdjustment`, `sessionRpe`, `detectPRs`, `sessionVolume`, `condEffort`, `sanitizeDB` and more against harvested vanilla vectors. Every engine task ends by running the golden suite; it MUST stay green with **no `test/golden/*.json` edited**. If it goes red, STOP — the change altered ported maths, which is not the intent. New engine behaviour on an un-sampled input gets a NEW test in a non-golden file.
- `PlannedSet = {t, rpe}` (both strings) is frozen; a warm-up target is `'W' + reps`. Build sets as plain object literals. Never call the zero-arg `newSet`/`newEx`/`newBlock` (session.ts) *with arguments* — the parameterised versions exist only under `emit.*`.
- No new dependencies anywhere (mobile especially: `beforeRemove`/`BackHandler` are RN-native, not a package).
- The coach app is **desktop-only** by construction; drive it at 1400×950 when smoke-testing.
- Every task ends: `pnpm --filter <pkg> typecheck` + the touched package's tests green, then commit. Trailers on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01SqzL3nPXwtqJfm5kUkjJ9p`.
- Keep tasks gated independently. Tasks that share a file (T3/T10 engine, T14/T15 GuidedFlow, T16 two humanizers) are ordered so the shared file settles once per task.

## Findings coverage

Every `verified.md` CONFIRMED id → the task that closes it.

| id | finding | task |
|----|---------|------|
| P1 | `__proto__` settings wipe | **T1** |
| C1 | legacy cond-fmt white-screen (=engine I11=persistence L6) | **T2** |
| EC1 | two-block lighter-weight banking | **T3** |
| E6 | 0-rep AMRAP moves weight up | **T3** |
| A1 | Training double-session guard | **T4** |
| P2 | cloud pre-push read clobber (=H2) | **T5** |
| A2 | web conditioning sink loss | **T6** |
| A3 | web conditioning min-duration | **T6** |
| A4 | mobile back discards run | **T7** |
| A5 | standalone conditioning never reaches coach (=persistence M8) | **T8** |
| E8 | strapless run scored as failure (=athlete I3) | **T9** |
| E9 | prototype-named effort crashes Home | **T9** |
| E1 | `sessionRpe` counts warm-up block | **T10** |
| E2 | `bestE1rmByLift` counts warm-up block | **T10** |
| E3 | `detectPRs` dedupe-before-scan | **T10** |
| E4 | `rpeGapInfo` no warm-up guard | **T10** |
| E5 | on-target moves bar / labelled bad | **T11** |
| E7 | metcon 0 % progress (=athlete M3) | **T12** |
| C2 | chain-delete re-points | **T14** |
| C3 | warm-up-block forced RPE | **T13** |
| C4 | metcon cue leak | **T14** |
| C5 | edit flattens sets | **T15** |
| C6 | empty metcon publishable | **T14** |
| C7 | publish with no date | **T16** |
| C8 | assertPublishable message flattened (⊂persistence M5) | **T16** |
| P3 | web keystroke re-serialise (=H3) | **T17** |
| P4 | inline traces blow the quota (=H4) | **T18** |

---

### Task 1 (CRITICAL): `sanitizeDB` seals the `settings` prototype hole — closes P1

**Files:**
- Modify: `packages/engine/src/db.ts`
- Test: `packages/engine/test/restore.test.ts` (extend)

**Interfaces:** `sanitizeDB(d: unknown): EngineDB` — signature unchanged; `settings` is now rebuilt from own enumerable keys.

- [ ] **Step 1: Failing test (the P1 repro)** — add to `restore.test.ts`:
```ts
it('a __proto__ key in restored settings cannot wipe the library', () => {
  const cur = sanitizeDB({
    workouts: [{ id: 'w1', name: 'A', updatedAt: 1, blocks: [] }],
    sessions: [
      { id: 's1', date: '2026-01-01', status: 'completed', completedAt: 1, blocks: [] },
      { id: 's2', date: '2026-01-02', status: 'completed', completedAt: 1, blocks: [] },
    ],
    settings: {},
  });
  const hostile = JSON.parse(
    '{"workouts":[],"sessions":[],"settings":{"__proto__":{"deletedIds":' +
      '{"w1":9007199254740991,"s1":9007199254740991,"s2":9007199254740991}}}}',
  );
  const { db } = restoreDb(cur, hostile, 'merge');
  expect(db.workouts.length).toBe(1);
  expect(db.sessions.length).toBe(2);
  // the poison never became a prototype
  expect(Object.getPrototypeOf(db.settings)).toBe(Object.prototype);
});
```
(Import `restoreDb`/`sanitizeDB` if not already imported in the file.)
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hybrid/engine test restore` → FAIL (0 workouts / 0 sessions).
- [ ] **Step 3: Implement** — in `db.ts`, replace the `settings:` line at the end of `sanitizeDB`'s returned object (currently `settings: (src.settings && typeof src.settings === 'object' ? src.settings : {}) as Settings,`) with a cleaned rebuild, and add the helper just above the `return`:
```ts
  // settings is the one hole in this trust boundary: JSON.parse materialises a
  // hostile "__proto__" as an OWN enumerable property, and mergeSettings'
  // Object.assign would then invoke the prototype setter, poisoning
  // deletedIds and wiping every record. Rebuild from own keys, dropping the
  // three keys that can re-home a prototype. Also reject an array.
  const cleanSettings = (s: unknown): Settings => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(s as Record<string, unknown>)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = (s as Record<string, unknown>)[k];
    }
    return out as Settings;
  };
```
and change the returned field to `settings: cleanSettings(src.settings),`.
- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/engine test restore` PASS, then `pnpm --filter @hybrid/engine test golden` PASS (all `sanitizeDB` golden vectors resolve `settings` to `{}` with no `__proto__`, so the rebuild is a no-op for them — a green run confirms it). Then full `pnpm --filter @hybrid/engine test`.
- [ ] **Step 5: Commit** — `git commit -m "Engine: a __proto__ key in restored settings can no longer wipe the library"` (+trailers).

---

### Task 2 (CRITICAL): legacy `kind:'cond'` block can no longer white-screen the coach — closes C1

**Files:**
- Modify: `apps/coach/src/model.ts`, `apps/coach/src/App.tsx`, `apps/coach/src/builder/grid.ts`
- Test: `apps/coach/test/model.test.ts` (extend, or add if absent — verify the filename first)

**Interfaces:** `migrateBlock(b: OldBlock)` — return type widens to `Block<PlannedSet> | null` (migrateDay already filters null). Read-sites `CON_FORMATS[b.condFmt].name` become `?.name ?? b.condFmt`.

- [ ] **Step 1: Failing test (the C1 repro)** — assert `migrateLib` of a stored library whose only block is `{kind:'cond', h:'Finisher', eff:'hard'}` (no `fmt`) yields a day whose cond block has a *valid* `condFmt` (`'intervals'`), and that `cellSummary`/`preview` of it do not throw:
```ts
import { migrateLib } from '../src/model';
import { cellSummary } from '../src/builder/grid';
import { CON_FORMATS, isCond } from '@hybrid/engine';

it('a legacy cond block with no/unknown fmt migrates to a valid format, not a crash', () => {
  const lib = migrateLib({
    programs: [{ id: 'p1', name: 'P', weeks: [{ days: [
      { title: 'D', blocks: [{ kind: 'cond', h: 'Finisher', eff: 'hard' }] },
      null, null, null, null, null, null] }] }],
    sel: { p: 0, w: 0, d: 0 },
  });
  const day = lib.programs[0].weeks[0].days[0]!;
  const cb = day.blocks[0];
  expect(isCond(cb) && cb.condFmt in CON_FORMATS).toBe(true);
  expect(() => cellSummary(day)).not.toThrow();
});
it('a legacy cond block with a bogus fmt does not keep the bogus value', () => {
  const lib = migrateLib({ programs: [{ id: 'p1', name: 'P', weeks: [{ days: [
    { title: 'D', blocks: [{ kind: 'cond', h: 'F', fmt: 'emom', eff: 'hard' }] },
    null, null, null, null, null, null] }] }], sel: { p: 0, w: 0, d: 0 } });
  const cb = lib.programs[0].weeks[0].days[0]!.blocks[0];
  expect(isCond(cb) && cb.condFmt in CON_FORMATS).toBe(true);
});
```
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hybrid/coach test` → FAIL (`condFmt` is `'emom'`/`undefined`, and/or `cellSummary` throws).
- [ ] **Step 3: Fix the migration** — in `apps/coach/src/model.ts` `migrateBlock`, replace the `if (b.kind === 'cond') { … }` body's `cb.condFmt = fmt` assignment. The whole cond branch becomes:
```ts
  if (b.kind === 'cond') {
    const eff = (b.eff as EffortKey) in CON_EFFORTS ? (b.eff as EffortKey) : 'medium';
    const cb = newCondBlock();
    cb.heading = s0(b.h, 'Finisher');
    // Validate the legacy fmt the way passThroughEngineBlock does (:154-155).
    // An absent/unknown fmt used to be written straight through, and
    // App.preview / grid.cellSummary then read CON_FORMATS[condFmt].name
    // unguarded and white-screened the whole app on load. Keep newCondBlock's
    // 'intervals' default instead — the block survives with a valid format.
    if (typeof b.fmt === 'string' && Object.prototype.hasOwnProperty.call(CON_FORMATS, b.fmt)) {
      cb.condFmt = b.fmt as CondFmtKey;
    }
    cb.effort = eff;
    cb.targetZone = CON_EFFORTS[eff].zone;
    return cb;
  }
```
(Delete the now-unused `const fmt = b.fmt as CondFmtKey;`. `migrateBlock`'s return type may stay `Block<PlannedSet>` since this branch never returns null — no signature change needed.)
- [ ] **Step 4: Harden the two read-sites (defence in depth)** — in `apps/coach/src/App.tsx` `preview` (line ~361) and `apps/coach/src/builder/grid.ts` `cellSummary` (line ~19), change `cond.push(CON_FORMATS[b.condFmt].name)` to:
```ts
      cond.push(CON_FORMATS[b.condFmt]?.name ?? b.condFmt);
```
matching `ReviewScreen`'s existing guard (`GuidedFlow.tsx:394`).
- [ ] **Step 5: Verify** — `pnpm --filter @hybrid/coach typecheck && pnpm --filter @hybrid/coach test` PASS.
- [ ] **Step 6: Commit** — `git commit -m "Coach: a legacy conditioning block with a bad format defaults instead of white-screening"` (+trailers).

---

### Task 3 (CRITICAL): `liftMoves` dedupes and refuses zero-rep sets — closes EC1, E6

**Files:**
- Modify: `packages/engine/src/lift.ts`, `apps/web/src/screens/Logger.tsx`, `apps/mobile/src/screens/Logger.tsx`
- Test: `packages/engine/test/lift.test.ts` (extend)

**Interfaces:** `liftMoves(s)` still returns `LiftMove[]`, now at most one per lowercased name; a set with `reps <= 0` produces no move. Not golden-pinned.

- [ ] **Step 1: Failing tests (the EC1 + E6 repros)** — in `lift.test.ts`:
```ts
it('banks the working effort, not a later lighter block', () => {
  const s: Session = { id: 's', date: '2026-01-01', status: 'completed', completedAt: 1, blocks: [
    { id: 'b1', exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg',
      sets: [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true }] }] },
    { id: 'b2', exercises: [{ id: 'e2', name: 'Back Squat', mode: 'reps_kg',
      sets: [{ t: '3', rpe: '9', aVal: '60', aVal2: '3', felt: '6', done: true }] }] },
  ] };
  const mv = liftMoves(s);
  expect(mv.length).toBe(1);
  expect(mv[0].from).toBe(100);
  expect(liftAdapt(s, {}).liftProgress['back squat'].kg).toBe(100);
});
it('a set with zero reps earns no progression', () => {
  const s: Session = { id: 's', date: '2026-01-01', status: 'completed', completedAt: 1, blocks: [
    { id: 'b1', exercises: [{ id: 'e1', name: 'Snatch', mode: 'amrap',
      sets: [{ t: 'max', rpe: '5', aVal: '100', aVal2: '0', felt: '5', done: true }] }] },
  ] };
  expect(liftMoves(s)).toEqual([]);
});
```
(Import `liftMoves`, `liftAdapt`, and `Session` as the file already does; add if missing.)
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hybrid/engine test lift` → FAIL (banks 65 / returns a move for 0 reps).
- [ ] **Step 3: Implement in `lift.ts` `liftMoves`** — add a `seen` set (mirroring `sessionOpeners`) and a reps guard. The `forEach` body becomes:
```ts
  const seen = new Set<string>();
  s.blocks.forEach((b) => {
    if (isWarmupBlock(b)) return;
    blockExercises<LoggedSet>(b).forEach((ex) => {
      if (!isLiftMode(ex.mode)) return;
      const name = String(ex.name || '').trim();
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return; // one move per movement — the FIRST
      // (working) occurrence wins; a back-off/burnout block written after the
      // main lift must not overwrite the working weight it earned.

      const st = lastWorkingSet(ex);
      if (!st) return;

      const from = saneKg(st.aVal);
      const reps = parseInt(String(st.aVal2), 10) || 0;
      // Reps are what make it a set — exLogFor/sessionVolume/epley all require
      // reps > 0. Progression used not to, so a 0-rep AMRAP (aVal2 unwritten)
      // read reps 0 and moved the working weight UP.
      if (!(reps > 0)) return;
      seen.add(key);
      const felt = parseFloat(String(st.felt));
      if (!Number.isFinite(felt)) return;

      const adj = computeSetAdjustment(reps, felt, repFloorOf(st.t), from, rpeCenterOf(st));
      out.push({ name, key, from, to: adj.newWeight, delta: adj.delta, verdict: adj.verdict, reps });
    });
  });
```
Note ordering: `seen.add(key)` sits AFTER the `reps > 0` / `lastWorkingSet` guards, so an exercise with no usable working set does not "claim" the name and block a later valid block for the same movement. (`felt` non-finite still aborts after claiming — a rated-then-unrated set is the same-block E-I7 shape, out of scope, and claiming is correct there.)
- [ ] **Step 4: In-session zero-rep gate (both Loggers)** — in `apps/web/src/screens/Logger.tsx` `confirmSet`, the adjustment block currently guards `if (lift && !isWarmup(dst)) { const weight = saneKg(dst.aVal); if (weight > 0) { … } }`. Read `apps/web/src/screens/Logger.tsx:201-221` first, then add a reps gate so a 0-rep AMRAP produces no "+kg" hint or next-set prefill. Change the inner guard:
```tsx
        const weight = saneKg(dst.aVal);
        const reps = parseInt(String(dst.aVal2), 10) || 0;
        if (weight > 0 && reps > 0) {
          const adj = computeSetAdjustment(reps, rpe, repFloorOf(dst.t), weight, rpeCenterOf(dst));
```
(reuse `reps` in the `computeSetAdjustment` call instead of the inline `parseInt`). Apply the identical change to `apps/mobile/src/screens/Logger.tsx` (read its `confirmSet`/adjustment block first — same shape, verify local variable names).
- [ ] **Step 5: Verify** — `pnpm --filter @hybrid/engine test lift && pnpm --filter @hybrid/engine test golden` PASS (golden unaffected: `liftMoves`/`liftAdapt` are not pinned and `computeSetAdjustment` is not modified), then `pnpm --filter @hybrid/engine test`; then `pnpm --filter @hybrid/web typecheck` and `pnpm --filter @hybrid/mobile typecheck`.
- [ ] **Step 6: Commit** — `git commit -m "Engine: one working weight banked per movement, and a zero-rep set earns nothing"` (+trailers).

---

### Task 4 (data-integrity): Training's Start guards inside the write — closes A1

**Files:**
- Modify: `apps/web/src/screens/Training.tsx`, `apps/mobile/src/screens/Training.tsx`

**Interfaces:** `startWorkout(w)` / `start(w)` — signature unchanged.

- [ ] **Step 1: Web** — in `apps/web/src/screens/Training.tsx`, `startWorkout` becomes:
```tsx
  function startWorkout(w: Workout) {
    update((draft) => {
      // Guard INSIDE the write, mirroring Home.tsx:143 — the render-scope
      // activeSession is stale for a second Start in the same frame, and two
      // workouts scheduled today render two Start buttons side by side, so this
      // needs no double-tap. Two active sessions is a merge conflict, and the
      // second is invisible/unfinishable (activeSession = find first active).
      if (draft.sessions.some((x) => x.status === 'active')) return false;
      draft.sessions.push(sessionFrom(w, today));
    });
  }
```
- [ ] **Step 2: Mobile** — in `apps/mobile/src/screens/Training.tsx`, `start` becomes the same shape:
```tsx
  const start = (w: Workout) => {
    update((draft) => {
      if (draft.sessions.some((x) => x.status === 'active')) return false;
      draft.sessions.push(sessionFrom(w, today));
    });
  };
```
- [ ] **Step 3: Verify** — `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/mobile typecheck`. Mobile jest: `pnpm --filter @hybrid/mobile test`. Web: build + throwaway Playwright drive (dual-server pattern from `checks/react-smoke.mjs`, chromium at `/opt/pw-browsers/chromium`, deleted after) — seed two workouts both scheduled today, open `/training`, click both Start buttons in one task, assert exactly one active session.
- [ ] **Step 4: Commit** — `git commit -m "Athlete: Training's Start cannot open a second live session"` (+trailers).

---

### Task 5 (data-integrity): a failed pre-push read aborts instead of truncating the cloud — closes P2

**Files:**
- Modify: `apps/web/src/cloud/sync.tsx`, `apps/mobile/src/cloud/sync.tsx`

**Interfaces:** `pushNow` internal — no signature change.

- [ ] **Step 1: Web** — in `apps/web/src/cloud/sync.tsx` `pushNow`, the pre-push read (lines ~103-104) becomes:
```tsx
      if (!existing) {
        // A swallowed read error was indistinguishable from an empty row, so a
        // network blip / 500 / RLS refusal turned the next push into a
        // truncating overwrite of another device's records and unrelated state
        // keys. Treat a read failure as fatal for this push, like reconcile
        // (:186) already does.
        const { data, error: e } = await client
          .from('app_state').select('state').eq('user_id', user.id).maybeSingle();
        if (e) throw e;
        existing = (data?.state ?? {}) as Record<string, unknown>;
      }
```
- [ ] **Step 2: Mobile** — apply the identical change in `apps/mobile/src/cloud/sync.tsx` (lines ~130-132).
- [ ] **Step 3: Verify** — `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/mobile typecheck`. The throw is caught by the existing `pushNow(...).catch(humanizeError)` in the push effect (web) and the reconcile try/catch — confirm by reading each call site that a thrown push surfaces as an error string, not an unhandled rejection.
- [ ] **Step 4: Commit** — `git commit -m "Cloud: a failed pre-push read aborts the push instead of overwriting the remote"` (+trailers).

---

### Task 6 (data-integrity): web conditioning keeps its sink and refuses mis-taps — closes A2, A3

**Files:**
- Modify: `apps/web/src/screens/Conditioning.tsx`

**Interfaces:** module `RUN` gains `sinkBid: string; sinkBi: number;`. `finish()` resolves the sink from `RUN`, not the current URL.

- [ ] **Step 1: Carry the sink on `RUN`** — extend the `RUN` object literal (lines ~58-68) with two fields and their initial values:
```ts
} = { live: false, fmt: 'intervals', startedAt: 0, elapsed: 0, bpm: null, samples: [], timer: null, onBpm: null,
      sinkBid: '', sinkBi: -1 };
```
and add to the type: `sinkBid: string; sinkBi: number;`.
- [ ] **Step 2: Minimum-duration constant** — above `RUN`, add:
```ts
/** Below this, a run is a mis-tap rather than training, and is not recorded —
 *  parity with mobile's MIN_LOGGABLE_SEC (apps/mobile/.../Conditioning.tsx:50). */
const MIN_LOGGABLE_SEC = 20;
```
- [ ] **Step 3: Capture at start()** — in `start()`, after `RUN.live = true;`, add:
```ts
    // The URL that launched this run carries where the result belongs. The run
    // outlives the screen in RUN, but the URL does not survive a hop to Home
    // and back — so capture the sink onto RUN now, and read it at finish().
    RUN.sinkBid = sinkBid;
    RUN.sinkBi = sinkBi;
```
- [ ] **Step 4: Guard + resolve from RUN at finish()** — the top of `finish()` (after `setLive(false)`) gains the min-duration discard, and the sink resolution reads `RUN`:
```ts
  function finish() {
    if (RUN.timer) window.clearInterval(RUN.timer);
    RUN.timer = null;
    RUN.live = false;
    setLive(false);
    // A run too short to be training is discarded, not banked — a Start→Finish
    // mis-tap used to write a 1-second run, which conAdapt then treated as a
    // session and (with the no-data guard) still counts as time on the clock.
    if (RUN.elapsed < MIN_LOGGABLE_SEC) {
      RUN.samples = [];
      RUN.elapsed = 0;
      setElapsed(0);
      setResult(null);
      return;
    }
    const dur = Math.max(1, RUN.elapsed);
    /* …unchanged trace/zsec/rec construction… */
```
and inside the `update((draft) => { … })`, the sink lookup (lines ~192-194) becomes:
```ts
      const ds = activeSession ? draft.sessions.find((x) => x.id === activeSession.id) : undefined;
      let cb = ds && RUN.sinkBid ? ds.blocks.find((b) => b.id === RUN.sinkBid) : undefined;
      // Guard the index fallback on the -1 sentinel, matching mobile (:237) —
      // a standalone run (sinkBi -1) must not resolve blocks[-1].
      if (ds && !isCond(cb) && RUN.sinkBi >= 0) cb = ds.blocks[RUN.sinkBi];
      if (ds && isCond(cb)) {
        cb.condResult = rec;
        ds.updatedAt = Date.now();
        return;
      }
      draft.settings.conditioning = pushCondHistory(draft.settings, rec);
```
- [ ] **Step 5: Optional live-surface note** — under the Finish button, mirror mobile's hint: `{elapsed < MIN_LOGGABLE_SEC ? <p className="mt-1 text-center text-3 text-dim">Runs under {MIN_LOGGABLE_SEC}s are discarded, not logged.</p> : null}`.
- [ ] **Step 6: Verify** — `pnpm --filter @hybrid/web typecheck` + build + throwaway Playwright drive: (a) start a run from a session's conditioning block (`/conditioning?block=…&bi=0`), let the clock pass 20 s, tap Home then Home's "Start a run", tap Finish → assert the block got the result and standalone history is empty; (b) start → Finish immediately → assert nothing banked. Delete the scratch script.
- [ ] **Step 7: Commit** — `git commit -m "Athlete: web conditioning keeps its block sink across navigation and ignores mis-taps"` (+trailers).

---

### Task 7 (data-integrity): mobile guards a live run against back / swipe — closes A4

**Files:**
- Modify: `apps/mobile/src/screens/Conditioning.tsx`

**Interfaces:** adds a `beforeRemove` navigation listener effect; no prop/signature change.

- [ ] **Step 1: Import `Alert`** — extend the `react-native` import: `import { Alert, View } from 'react-native';`.
- [ ] **Step 2: beforeRemove guard** — after the existing unmount-cleanup effect (`useEffect(() => () => { monitor.current?.stop(); … }, [])`, ~line 143-147), add:
```tsx
  // Android hardware back and the enabled swipe-back both POP this screen, and
  // the cleanup effect above then tears down strap + GPS — losing the clock,
  // every HR sample and the whole route with no warning. beforeRemove fires for
  // both, so intercept it while live and confirm before discarding. (The web
  // app hoists the run to module scope instead; mobile keeps it in refs, so it
  // guards the exit rather than surviving it.)
  useEffect(() => {
    const unsub = nav.addListener('beforeRemove', (e) => {
      if (!live) return;
      e.preventDefault();
      Alert.alert(
        'Discard this run?',
        'Leaving now loses the clock and every heart-rate sample banked so far.',
        [
          { text: 'Keep running', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              monitor.current?.stop();
              geoTracker.current?.stop();
              void setKeepAwake(false);
              nav.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsub;
  }, [nav, live]);
```
- [ ] **Step 3: Verify** — `pnpm --filter @hybrid/mobile typecheck && pnpm --filter @hybrid/mobile test`. Device/emulator verification (source-level otherwise): start a run, press hardware back → confirm prompt appears; Keep running → still live; Discard → screen pops and strap/GPS are torn down. Note in the report that this path needs a device to exercise end-to-end.
- [ ] **Step 4: Commit** — `git commit -m "Mobile: a live conditioning run confirms before back or swipe discards it"` (+trailers).

---

### Task 8 (data-integrity): standalone conditioning reaches the coach — closes A5

**Files:**
- Modify: `packages/engine/src/cloud.ts`
- Test: `packages/engine/test/cloud.test.ts` (extend)

**Interfaces:** `coachDigest(db, now?, days?)` — output shape unchanged except `conditioning[].date` is now populated from `startedAt`.

- [ ] **Step 1: Failing test (the A5 repro)** — in `cloud.test.ts`'s `coachDigest` describe, add a standalone run one hour before `NOW`:
```ts
it('windows standalone conditioning on startedAt and dates it', () => {
  const db2: EngineDB = { workouts: [], sessions: [], settings: {
    conditioning: [{ id: 'c1', fmt: 'steady', effort: 'easy', dur: 1200,
      zsec: { low: 600, mod: 600, high: 0 }, hrr: 10, startedAt: NOW - 3_600_000 }],
  } };
  const d = coachDigest(db2, NOW);
  expect(d.conditioning.length).toBe(1);
  expect(d.conditioning[0].date).toBe(ymd(new Date(NOW - 3_600_000)));
});
```
(Import `ymd` from `../src/num` / `../src/index` as the file's imports allow.)
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hybrid/engine test cloud` → FAIL (0 standalone runs).
- [ ] **Step 3: Implement** — in `coachDigest`, add an epoch cutoff beside `cut` (line ~159): `const cutMs = now - days * 864e5;`. In `slim` (line ~197), replace `date: (r as { date?: string }).date,` with a derived date:
```ts
    date: (r as { date?: string }).date ?? (r.startedAt ? ymd(new Date(r.startedAt)) : undefined),
```
And the standalone filter (line ~213) changes from the phantom `date` field to `startedAt`:
```ts
    .filter((r) => r && (r.startedAt || 0) >= cutMs)
```
- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/engine test cloud` PASS, and the existing inline-conditioning assertions (`d.conditioning.length === 1`, `.hrr === 22`, `.zsec`) stay green — a `date` key is additive and those assertions do not touch it. Then `pnpm --filter @hybrid/engine test golden` PASS (`coachDigest` is not golden-pinned) and full engine test.
- [ ] **Step 5: Commit** — `git commit -m "Engine: standalone conditioning runs reach the coach digest, dated by startedAt"` (+trailers).

---

### Task 9 (data-integrity/engine): conditioning no longer deloads on no data, nor crashes on a proto effort — closes E8, E9

**Files:**
- Modify: `packages/engine/src/conditioning.ts`
- Test: `packages/engine/test/parity.test.ts` or a new `packages/engine/test/conditioning.test.ts` (verify no `conditioning.test.ts` exists first — it does not at HEAD)

**Interfaces:** `conAdapt(rec, settings)` and `condEffort(b)` — signatures unchanged.

- [ ] **Step 1: Failing tests (the E8 + E9 repros)** — add a new `packages/engine/test/conditioning.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { conAdapt, condEffort, CON_EFFORTS } from '../src/index';

describe('conAdapt no-data guard', () => {
  it('a run with no zone time earns nothing and costs nothing', () => {
    const settings = { conProgress: { intervals: { level: 5, miss: 0 } } };
    const r1 = conAdapt({ id: 'a', fmt: 'intervals', zsec: { low: 0, mod: 0, high: 0 }, dur: 1200 }, settings);
    expect(r1.conProgress.intervals).toEqual({ level: 5, miss: 0 });
    const r2 = conAdapt({ id: 'b', fmt: 'intervals', zsec: { low: 0, mod: 0, high: 0 }, dur: 1200 },
      { conProgress: r1.conProgress });
    expect(r2.conProgress.intervals).toEqual({ level: 5, miss: 0 }); // still not deloaded
  });
});

describe('condEffort prototype guard', () => {
  it('a prototype-named effort falls back to medium instead of the Object constructor', () => {
    expect(condEffort({ effort: 'constructor' } as never)).toEqual(CON_EFFORTS.medium);
  });
});
```
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hybrid/engine test conditioning` → FAIL (level drops to 4; `condEffort` returns `Object`).
- [ ] **Step 3: Implement E8** — in `conAdapt`, after `const zoned = (z.low || 0) + (z.mod || 0) + (z.high || 0);` (line ~281), add:
```ts
  // No zone time banked at all means no heart-rate data — a strapless run, not
  // a failed one. Neither earn nor deload from a session the app could not
  // measure. A run WITH data that stayed out of zone still counts as a miss.
  if (zoned <= 0) return none;
```
- [ ] **Step 4: Implement E9** — in `condEffort` (lines ~125-130), guard both lookups against the prototype chain:
```ts
export function condEffort(b: Partial<CondBlock> | CondResult | null | undefined) {
  const e = b && (b as CondBlock).effort;
  if (e && Object.prototype.hasOwnProperty.call(CON_EFFORTS, e)) return CON_EFFORTS[e];
  const zone = b && ((b as CondBlock).targetZone as ZoneKey | undefined);
  if (zone && Object.prototype.hasOwnProperty.call(ZONE_TO_EFFORT, zone)) return CON_EFFORTS[ZONE_TO_EFFORT[zone]];
  return CON_EFFORTS.medium;
}
```
- [ ] **Step 5: Verify** — `pnpm --filter @hybrid/engine test conditioning` PASS, then `pnpm --filter @hybrid/engine test golden` PASS (the golden `condEffort` fixtures include `{effort:'bogus'}` and legacy-zone cases but no prototype key, so the `hasOwnProperty` guard is a no-op for every sampled input — `'bogus'` still falls through to medium exactly as before), and `pnpm --filter @hybrid/engine test parity` PASS (parity only references `conAdapt` in a comment, no zero-zsec assertion). Full engine test.
- [ ] **Step 6: Commit** — `git commit -m "Engine: a data-less run neither deloads nor is scored, and a prototype effort can't crash Home"` (+trailers).

---

### Task 10 (engine math): warm-up-block guards + detectPRs later-block — closes E1, E2, E3, E4

**Files:**
- Modify: `packages/engine/src/session.ts`
- Test: `packages/engine/test/warmupblock.test.ts` (extend — it already exists) and `packages/engine/test/session.test.ts`

**Interfaces:** `sessionRpe`, `bestE1rmByLift`, `rpeGapInfo`, `detectPRs` — signatures unchanged.

- [ ] **Step 1: Failing tests (the E1–E4 repros)** — in `warmupblock.test.ts`, add cases with a warm-up BLOCK (`{ warmup: true, exercises: [...] }`) whose sets are rated, asserting `sessionRpe.felt` and `rpeGapInfo.gap`/`.n` exclude them and `bestE1rmByLift` excludes a 200×10 warm-up-block set. In `session.test.ts`, add the detectPRs later-block case: main block 100×5 + a "Heavy single" block 150×1 under the same name, prior history best 110×5 → expect a PR for the 150×1. (Use the exact probe shapes from `verified.md` E1/E2/E3/E4.)
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hybrid/engine test warmupblock session` → FAIL.
- [ ] **Step 3: E1 — `sessionRpe`** — add the block guard. The `s.blocks.forEach((b) =>` becomes:
```ts
  s.blocks.forEach((b) => {
    if (isWarmupBlock(b)) return; // whole-block prep is not rated effort — the
    // per-set isWarmup guard misses a warm-up block whose sets carry an
    // ordinary target ("10"), the same skip every sibling opens with.
    blockExercises(b).forEach((e) =>
      e.sets.forEach((st) => {
        if (isWarmup(st)) return;
        if (!st.done) return;
        const tt = parseFloat(String(st.rpe));
        const ff = parseFloat(String(st.felt));
        if (Number.isFinite(tt)) t.push(tt);
        if (Number.isFinite(ff)) f.push(ff);
      }),
    );
  });
```
- [ ] **Step 4: E2 — `bestE1rmByLift`** — inside its `s.blocks.forEach((b) =>`, add `if (isWarmupBlock(b)) return;` as the first statement (wrap the arrow body in braces like Step 3).
- [ ] **Step 5: E4 — `rpeGapInfo`** — the strength-set walk gains both guards:
```ts
    s.blocks.forEach((b) => {
      if (isWarmupBlock(b)) return;
      blockExercises(b).forEach((e) =>
        e.sets.forEach((st) => {
          if (isWarmup(st)) return;
          const t = parseFloat(String(st.rpe));
          const f = parseFloat(String(st.felt));
          if (st.done && Number.isFinite(t) && Number.isFinite(f)) gaps.push(f - t);
        }),
      );
    });
```
(the conditioning `s.blocks.forEach` below it is unchanged.)
- [ ] **Step 6: E3 — `detectPRs` scans all blocks** — replace the per-name dedupe-before-scan with a best-per-name accumulator across all non-warm-up blocks, then emit:
```ts
export function detectPRs(s: Session, sessions: Session[]): PrRecord[] {
  const prs: PrRecord[] = [];
  const bestByKey = new Map<string, { name: string; kg: number; reps: number; e1: number }>();

  s.blocks.forEach((b) => {
    if (isWarmupBlock(b)) return;
    blockExercises(b).forEach((e) => {
      if (!isLiftMode(e.mode)) return;
      const key = String(e.name || '').trim().toLowerCase();
      if (!key) return;
      e.sets.forEach((st) => {
        if (isWarmup(st)) return;
        const e1 = epley(st.aVal, st.aVal2);
        if (st.done && e1 != null) {
          const cur = bestByKey.get(key);
          // scan EVERY block for this movement's best — a heavy single in a
          // later block used to be skipped by the old dedupe-before-scan, so
          // the PR banner never fired while the chart jumped.
          if (!cur || e1 > cur.e1) bestByKey.set(key, { name: e.name, kg: Number(st.aVal), reps: Number(st.aVal2), e1 });
        }
      });
    });
  });

  bestByKey.forEach((best) => {
    const prev = exBest(best.name, sessions, s.id);
    if (!prev || best.e1 > prev.e1 + 0.01) {
      prs.push({ name: best.name, kg: best.kg, reps: best.reps, e1: best.e1, prevE1: prev ? prev.e1 : null });
    }
  });

  return prs;
}
```
- [ ] **Step 7: Verify** — `pnpm --filter @hybrid/engine test warmupblock session` PASS, then **`pnpm --filter @hybrid/engine test golden` PASS** — the golden `sessionRpe` fixtures contain a warm-up *set* only (already excluded), no warm-up *block*, and the golden `detectPRs` fixtures never repeat a name across blocks, so both outputs are byte-identical; a green run is the proof. Full engine test.
- [ ] **Step 8: Commit** — `git commit -m "Engine: warm-up blocks stay out of RPE/e1RM/readiness, and detectPRs scans every block"` (+trailers).

---

### Task 11 (engine math): on-target sets hold the bar — closes E5

**Files:**
- Modify: `packages/engine/src/autoreg.ts`
- Test: `packages/engine/test/autoreg.test.ts` (add if absent — verify; otherwise `session.test.ts`) — a NON-golden file.

**Interfaces:** `computeSetAdjustment(reps, rpe, low, weight, center)` — return shape unchanged.

- [ ] **Step 1: Failing test (the E5 repro)** — in a non-golden test file:
```ts
import { computeSetAdjustment } from '../src/autoreg';
it('a set exactly on target holds the weight, even off a non-plate load', () => {
  expect(computeSetAdjustment(5, 8.5, 5, 101, 8.5))
    .toEqual({ delta: 0, newWeight: 101, verdict: 'right on target', cls: 'good' });
  // an off-target set still moves (regression guard for the 142.5/center-7 case)
  expect(computeSetAdjustment(5, 7.5, 0, 142.5, 7).delta).toBe(-2.5);
});
```
- [ ] **Step 2: Run to verify failure** — FAIL (delta −1, cls 'bad').
- [ ] **Step 3: Implement** — in `computeSetAdjustment`, split the raw target from the rounded one and hold when they are equal:
```ts
  const missed = low > 0 && reps < low;
  const eff = missed ? AUTOREG.missedFloorRpe : rpe;
  const raw = weight * (1 + ((center - eff) * AUTOREG.pctPerRpePoint) / 100);
  // When the set hit its target exactly (eff === center, so the multiplier is
  // 1 and `raw` IS the weight), holding is the right answer — rounding a
  // manually-entered non-plate load (101 → 100) otherwise banked a "−1 kg"
  // change and painted a perfect set red. A missed set has eff = 10.5 > center,
  // so raw < weight and this never fires for it.
  const newWeight = raw === weight ? weight : roundToIncrement(raw, AUTOREG.plateIncrement);
  const delta = Math.round((newWeight - weight) * 100) / 100;
  return {
    delta,
    newWeight,
    verdict: missed ? 'missed the rep floor' : verdictForRpe(rpe, center),
    cls: delta < 0 ? 'bad' : 'good',
  };
```
- [ ] **Step 4: Verify** — the new test PASS, then **`pnpm --filter @hybrid/engine test golden` PASS**: every golden `computeSetAdjustment` weight is a 2.5-multiple (so `roundToIncrement(weight)===weight` already — the `raw===weight` branch returns the same value), and the "right on target / bad" golden vectors all sit at `|center−eff|=0.5` (so `raw≠weight` and they still round/move exactly as pinned). No fixture is regenerated. Full engine test.
- [ ] **Step 5: Commit** — `git commit -m "Engine: a set exactly on target holds the weight instead of rounding it down"` (+trailers).

---

### Task 12 (engine math): a metcon counts toward progress — closes E7

**Files:**
- Modify: `packages/engine/src/logger.ts`
- Test: `packages/engine/test/textblock.test.ts` (extend — it exists)

**Interfaces:** `sessionProgress(s)` — return shape unchanged.

- [ ] **Step 1: Failing test (the E7 repro)** — in `textblock.test.ts`:
```ts
it('a ticked metcon counts as done, and a metcon-only session can reach 100%', () => {
  const s: Session = { id: 's', date: '2026-01-01', status: 'active', blocks: [
    { id: 'b', kind: 'text', heading: 'Metcon', body: 'AMRAP 12', done: true } as TextBlock,
  ] };
  expect(sessionProgress(s)).toEqual({ done: 1, total: 1, pct: 100 });
});
```
- [ ] **Step 2: Run to verify failure** — FAIL (`{done:0,total:0,pct:0}`).
- [ ] **Step 3: Implement** — in `sessionProgress`, add a text-block branch mirroring the conditioning one (and `hasLoggedWork`'s treatment):
```ts
  s.blocks.forEach((b) => {
    if (isCond(b)) {
      total += 1;
      if (b.condResult) done += 1;
      return;
    }
    if (isText(b)) {
      // A ticked metcon is training that happened — hasLoggedWork already
      // counts it (session.ts:236-238); without this the meter sat at 0% with
      // the metcon done, and the finish button never turned brass.
      total += 1;
      if (b.done) done += 1;
      return;
    }
    blockExercises(b).forEach((e) => {
      total += e.sets.length;
      done += e.sets.filter((st) => st.done).length;
    });
  });
```
(`isText` is already imported in `logger.ts`.)
- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/engine test textblock` PASS, `pnpm --filter @hybrid/engine test golden` PASS (`sessionProgress` not pinned), full engine test.
- [ ] **Step 5: Commit** — `git commit -m "Engine: a ticked metcon counts toward session progress"` (+trailers).

---

### Task 13 (coach): a warm-up BLOCK skips the mandatory RPE — closes C3

**Files:**
- Modify: `apps/coach/src/builder/flowSteps.ts`, `apps/coach/src/builder/GuidedFlow.tsx`
- Test: `apps/coach/test/flowSteps.test.ts` (extend)

**Interfaces:** `stepsFor(state)` — unchanged signature; a `blockKind: 'warmup'` state now omits `'rpe'`.

- [ ] **Step 1: Failing test** — in `flowSteps.test.ts`'s `stepsFor` describe:
```ts
it('a warm-up BLOCK skips the RPE step, like a warm-up set', () => {
  expect(stepsFor({ blockKind: 'warmup', isWarmupSet: false })).toEqual([
    'block-type', 'movement', 'sets', 'reps', 'more', 'review',
  ]);
});
```
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hybrid/coach test` → FAIL (RPE still present).
- [ ] **Step 3: Implement `stepsFor`** — the fallback line (`:29`) becomes:
```ts
export function stepsFor(state: FlowState): FlowStep[] {
  if (state.blockKind === 'cond') return COND_SEQUENCE;
  if (state.blockKind === 'metcon') return METCON_SEQUENCE;
  // A warm-up BLOCK is a stronger claim than a warm-up set — isWarmupBlock makes
  // the engine ignore the whole block in sessionVolume/exLogFor/detectPRs/autoreg
  // — so its RPE is meaningless and forcing one contaminates sessionRpe/rpeGapInfo.
  const warm = state.isWarmupSet || state.blockKind === 'warmup';
  return warm ? LIFT_SEQUENCE.filter((s) => s !== 'rpe') : LIFT_SEQUENCE;
}
```
- [ ] **Step 4: Implement `commitBlock`** — in `GuidedFlow.tsx` `commitBlock`, the set builder (line ~119) writes an empty RPE for a warm-up block too:
```tsx
      const isWarm = draft.isWarmup || draft.blockKind === 'warmup';
      const target = isWarm ? 'W' + draft.reps : draft.reps;
      const sets = Array.from({ length: draft.sets }, () => ({ t: target, rpe: isWarm ? '' : draft.rpe }));
```
- [ ] **Step 5: Verify** — `pnpm --filter @hybrid/coach typecheck && pnpm --filter @hybrid/coach test` PASS.
- [ ] **Step 6: Commit** — `git commit -m "Coach: authoring a warm-up block no longer forces a meaningless RPE"` (+trailers).

---

### Task 14 (coach): chain-delete, cue-leak, and empty-metcon — closes C2, C4, C6

**Files:**
- Modify: `apps/coach/src/builder/GuidedFlow.tsx`, `apps/coach/src/builder/steps/MoreStep.tsx`

**Interfaces:** `onDeleteExercise` breaks the chain at the deleted row; `BlockTypeStep.onPick` starts a clean draft; `MoreStep` Done disabled for an empty metcon.

- [ ] **Step 1: C2 — chain-delete** — in `GuidedFlow.tsx` `onDeleteExercise`, the `else` branch (non-empty after delete) clears the predecessor's `ssNext` as well as the last row's:
```tsx
          } else {
            // Deleting a row breaks any chain THROUGH it: the row above was
            // linked to the row we just removed, not to whatever slid up into
            // its slot — leaving its ssNext set silently re-pointed the chain
            // onto an unrelated exercise (A→B→C, delete B, A adopts C).
            if (ei > 0 && exs[ei - 1]) exs[ei - 1] = { ...exs[ei - 1], ssNext: undefined };
            // And the new last row can't chain into anything below it.
            exs[exs.length - 1] = { ...exs[exs.length - 1], ssNext: undefined };
            blocks[bi] = { ...b, exercises: exs };
          }
```
(`exs` is the already-filtered array, so index `ei-1` is the predecessor.)
- [ ] **Step 2: C4 — cue leak** — in the `step === 'block-type'` render, `BlockTypeStep.onPick` starts a clean draft instead of spreading the stale one:
```tsx
            onPick={(kind) => {
              // Picking a block kind starts a FRESH block — spreading the old
              // draft carried an abandoned metcon note onto the next exercise's
              // cue (and pre-filled its reps/RPE/rest). EMPTY_DRAFT clears it.
              setDraft({ ...EMPTY_DRAFT, blockKind: kind });
              {
                const s = nextStep('block-type', { blockKind: kind, isWarmupSet: false });
                if (s) setStep(s);
                else onClose();
              }
            }}
```
- [ ] **Step 3: C6 — empty metcon** — in `MoreStep.tsx`, the Done button is disabled for a metcon with an empty body:
```tsx
      <button onClick={onDone} disabled={metcon && !note.trim()} className={BRASS + ' mt-2'}>
        Done
      </button>
```
(`note` and `metcon` are already props. This prevents authoring the empty `TextBlock` that `assertPublishable`/`emit` do not reject.)
- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/coach typecheck && pnpm --filter @hybrid/coach test` PASS. Build + throwaway Playwright drive (desktop viewport): (a) Back Squat / Barbell Row / Plank → Chain Back Squat → delete Barbell Row → assert Back Squat shows `A` (not `A1`) and Plank `B`; (b) Metcon → type a note → Back → pick Lift → Plank → assert Plank's cue is empty; (c) Metcon → leave body empty → Done is disabled. Delete the scratch script.
- [ ] **Step 5: Commit** — `git commit -m "Coach: deleting a chain member breaks the chain, block picks start clean, empty metcons can't be authored"` (+trailers).

---

### Task 15 (coach): editing an exercise preserves a heterogeneous prescription — closes C5

**Files:**
- Modify: `apps/coach/src/builder/GuidedFlow.tsx`

**Interfaces:** `commitBlock`'s edit branch keeps the original `sets` when the coach did not change the set-shaping fields.

- [ ] **Step 1: Implement** — in `commitBlock`, the editing branch (currently lines ~126-134) is rewritten to compare the draft against what the row started at and preserve the original sets on a no-op:
```tsx
      if (editing && !isCond(editing) && !isText(editing)) {
        const exsAll = [...blockExercises(editing)];
        const orig = exsAll[editTarget!.ei];
        const origFirst = orig.sets[0];
        const origReps = origFirst ? origFirst.t.replace(/^\s*w/i, '') : '';
        const origRpe = origFirst?.rpe ?? '';
        const origAllWarm = orig.sets.length > 0 && orig.sets.every((st) => /^\s*w/i.test(st.t));
        // A no-op walk-through of a ramp (W5/W3/5/3/1) must NOT be flattened to
        // N identical sets. If the coach did not touch the set-shaping fields,
        // keep the original sets and rewrite only name/rest/tempo/mode/cue;
        // rebuild uniformly only when they genuinely re-specified reps/RPE/count.
        // (This is the flow's authoring model kept honest — NOT a per-set
        // editor, which stays out of scope.)
        const shapeUnchanged =
          draft.sets === orig.sets.length &&
          draft.reps === origReps &&
          draft.rpe === origRpe &&
          draft.isWarmup === origAllWarm;
        exsAll[editTarget!.ei] = {
          ...ex,
          sets: shapeUnchanged ? orig.sets : ex.sets,
          id: orig.id,
          ssNext: orig.ssNext,
        };
        const blocks = [...session.blocks];
        blocks[editTarget!.bi] = { ...editing, exercises: exsAll };
        onChange({ ...session, blocks });
      } else if (existing && !isCond(existing) && !isText(existing)) {
```
(the `ex` literal built at line ~123 already carries the updated name/rest/tempo/mode/cue and a uniform `sets`; we only override which `sets` win.)
- [ ] **Step 2: Verify** — `pnpm --filter @hybrid/coach typecheck && pnpm --filter @hybrid/coach test` PASS. Build + throwaway Playwright drive: seed a legacy day with a ramp (`W5/W3/5/3/1 · RPE 7→9`), open it, tap the exercise name, walk through without changing anything, Done → assert the review row still shows `5 × W5/W3/5/3/1 · RPE 7→9`; then edit again and change the set count → assert it rebuilds uniformly. Delete the scratch script.
- [ ] **Step 3: Commit** — `git commit -m "Coach: a no-op edit no longer flattens a heterogeneous prescription"` (+trailers).

---

### Task 16 (coach): publish needs a date, and hand-written messages survive — closes C7, C8

**Files:**
- Modify: `apps/coach/src/builder/steps/PublishStep.tsx`, `apps/coach/src/errors.ts`, `apps/web/src/errors.ts`

**Interfaces:** Send disabled until a date is set; both humanizers pass through the engine's authored sentences.

- [ ] **Step 1: C7 — date gate** — in `PublishStep.tsx`, the Send button (line ~51) disables on an empty date:
```tsx
              <button onClick={() => void publish()} disabled={publishing || !athlete || !date} className={BRASS + ' mt-1 w-full'}>
                {publishing ? 'Sending…' : 'Send to athlete'}
              </button>
```
- [ ] **Step 2: C8 — coach humanizer** — in `apps/coach/src/errors.ts`, before the final `return`, add a pass-through for `assertPublishable`'s authored sentence (it carries no `emit:` prefix so no existing branch matches):
```ts
  if (m.includes('nothing in this session yet')) return String(raw);
```
- [ ] **Step 3: C8 — athlete humanizer** — in `apps/web/src/errors.ts`, before the final `return`, add pass-throughs for `restoreDb`'s two authored messages:
```ts
  if (m.includes('not a backup') || m.includes('no workouts, sessions or settings')) return String(raw);
```
- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/coach typecheck && pnpm --filter @hybrid/coach test` and `pnpm --filter @hybrid/web typecheck`. Coach Playwright drive: open a filled day, delete its only block, Continue → Validate → assert the message is "Nothing in this session yet — add at least one block before publishing." (not the connection default); and with a signed-in stub, leave the date empty → assert Send is disabled.
- [ ] **Step 5: Commit** — `git commit -m "Coach: publish requires a date, and local authoring errors say what's wrong"` (+trailers).

---

### Task 17 (web perf): the logger stops re-serialising the whole DB per keystroke — closes P3

**Files:**
- Modify: `apps/web/src/store/db.tsx`, `apps/web/src/screens/Logger.tsx`, `apps/web/src/cloud/sync.tsx`

**Interfaces:** `DbCtx` gains `updateSession(id, fn: (s: Session) => void | false): void` — same contract as mobile's. The logger's hot paths route through it.

- [ ] **Step 1: Add `updateSession` to the web store** — in `apps/web/src/store/db.tsx`, add to the `DbCtx` interface (below `update`):
```tsx
  /** Mutate ONE session, cloning only that session — the hot path for typing a
   *  weight. Same abort contract as `update`. Mirrors the mobile store. */
  updateSession: (id: string, fn: (s: Session) => void | false) => void;
```
and implement it in `DbProvider` (after `update`), keeping web's synchronous save (no debounce — web has no loss window, verified):
```tsx
  const updateSession = useCallback<DbCtx['updateSession']>((id, fn) => {
    const cur = ref.current;
    const i = cur.sessions.findIndex((x) => x.id === id);
    if (i < 0) return;
    const copy: Session = structuredClone(cur.sessions[i]);
    if (fn(copy) === false) return;
    const sessions = cur.sessions.slice();
    sessions[i] = copy;
    const next: EngineDB = { ...cur, sessions };
    ref.current = next;
    setDb(next);
    const ok = saveDB(webStorage, next, LS_KEY);
    setSaveFailed(!ok);
  }, []);
```
and add `updateSession` to the `value` object and its `useMemo` dep array.
- [ ] **Step 2: Route the logger's hot paths through it** — in `apps/web/src/screens/Logger.tsx`, pull `updateSession` from `useDb()` alongside `update`. In `writeVal`, `confirmSet`, the metcon toggle and the `ssNext` toggle, replace `update((draft) => { const ds = draft.sessions.find((x) => x.id === s.id); … })` with `updateSession(s.id, (ds) => { … })` — the callback receives the session directly, so drop the `.find` and its null-check (keep the inner block/set null-checks, returning `false` to abort). Example for `writeVal`:
```tsx
  function writeVal(slot: 1 | 2, val: string) {
    if (slot === 1) setV1(val);
    else setV2(val);
    if (!s || si < 0) return;
    updateSession(s.id, (ds) => {
      const dst = (ds.blocks[bi] as StrengthBlock<LoggedSet>)?.exercises?.[ei]?.sets?.[si];
      if (!dst) return false;
      if (slot === 1) dst.aVal = val;
      else dst.aVal2 = val;
      ds.updatedAt = Date.now();
    });
  }
```
(`confirmSet` mutates only `ds`; `finishSession`, which also writes `draft.settings.liftProgress`, STAYS on `update`.) Read each handler first and preserve its exact set/hint logic.
- [ ] **Step 3: Drop the per-render fingerprint from the push effect** — in `apps/web/src/cloud/sync.tsx`, delete the line `if (cloudFp(db) === lastFp.current) return;` (line ~245) inside the debounced-push effect. `pushNow` already recomputes `cloudFp(dbRef.current)` and bails if unchanged (line ~95-96), so the network call is still deduped — this only removes a full `JSON.stringify` per keystroke.
- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/web typecheck` + build + throwaway Playwright drive: type a weight into a set field on a seeded 200-session DB, confirm the value persists across reload and that another exercise's data is untouched (updateSession carries other sessions by reference). Delete the scratch script.
- [ ] **Step 5: Commit** — `git commit -m "Web: the logger clones one session per keystroke instead of the whole database"` (+trailers).

---

### Task 18 (web perf): prune inline traces so the store cannot fill forever — closes P4

**Files:**
- Modify: `packages/engine/src/db.ts` (or `storage.ts` — a new exported helper), `apps/web/src/store/db.tsx`, `apps/mobile/src/store/db.tsx`
- Test: `packages/engine/test/restore.test.ts` or a new engine test

**Interfaces:** new engine helper `pruneCondTraces(sessions: Session[], keep = CON_TRACE_KEEP): { sessions: Session[]; changed: boolean }` — strips `condResult.trace`/`route` from all but the most recent `keep` sessions that carry a conditioning result. New constant `CON_TRACE_KEEP` (e.g. 12).

- [ ] **Step 1: Failing test** — assert `pruneCondTraces` drops `trace`/`route` from older sessions' conditioning results while keeping them on the most recent `keep`, and returns `changed: true` only when something was stripped. Include a session-count large enough to cross `keep`.
- [ ] **Step 2: Run to verify failure** — FAIL (function does not exist).
- [ ] **Step 3: Implement the engine helper** — in `db.ts`, export:
```ts
/** Inline HR/GPS traces are ~78% of the serialised blob; unbounded, they cross
 *  the localStorage quota and then EVERY save fails forever. Keep the maps on
 *  recent runs (Recap/History still draw them) and strip them from older ones —
 *  the zone SECONDS that drive progression stay, only the point arrays go. */
export function pruneCondTraces(sessions: Session[], keep = CON_TRACE_KEEP): { sessions: Session[]; changed: boolean } {
  const withCond = sessions
    .map((s, i) => ({ i, at: s.completedAt || s.startedAt || 0, has: (s.blocks || []).some((b) => isCond(b) && !!(b as CondBlock).condResult) }))
    .filter((x) => x.has)
    .sort((a, b) => b.at - a.at);
  const spare = new Set(withCond.slice(0, keep).map((x) => x.i));
  let changed = false;
  const out = sessions.map((s, i) => {
    if (spare.has(i)) return s;
    let touched = false;
    const blocks = (s.blocks || []).map((b) => {
      if (isCond(b) && (b as CondBlock).condResult) {
        const r = (b as CondBlock).condResult!;
        if (r.trace || (r as { route?: unknown }).route) {
          touched = true;
          const { trace: _t, route: _r, ...rest } = r as CondResult & { route?: unknown };
          return { ...b, condResult: rest };
        }
      }
      return b;
    });
    if (!touched) return s;
    changed = true;
    return { ...s, blocks };
  });
  return { sessions: out, changed };
}
```
Add `CON_TRACE_KEEP = 12` to `constants.ts` and export both from `index.ts`. (Verify `CondBlock`/`CondResult`/`isCond` imports in `db.ts`.)
- [ ] **Step 4: Wire boot pruning (both stores)** — in `apps/web/src/store/db.tsx` and `apps/mobile/src/store/db.tsx`, inside the `useState` initialiser next to `expireStaleSessions`, run `pruneCondTraces(loaded.sessions)` and persist if changed:
```tsx
    const { sessions: pruned, changed: ch2 } = pruneCondTraces(exp.sessions);
    if (ch2) { loaded.sessions = pruned; saveDB(<storage>, loaded, LS_KEY); }
```
(read each initialiser first; thread it after the existing `expireStaleSessions` result).
- [ ] **Step 5: Recovery pass on a failed save** — in the web store's `update`/`updateSession` and mobile's `flush`, when `saveDB` returns false, prune traces and retry once before surfacing `saveFailed`:
```tsx
    let ok = saveDB(<storage>, next, LS_KEY);
    if (!ok) {
      const { sessions: pr, changed } = pruneCondTraces(next.sessions);
      if (changed) { next = { ...next, sessions: pr }; ref.current = next; setDb(next); ok = saveDB(<storage>, next, LS_KEY); }
    }
    setSaveFailed(!ok);
```
(adapt to each store's variable names; keep it to the save/flush path so it is not a hot cost.)
- [ ] **Step 6: Verify** — `pnpm --filter @hybrid/engine test` (new helper) + golden PASS (new function, not pinned); `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/mobile typecheck && pnpm --filter @hybrid/mobile test`.
- [ ] **Step 7: Commit** — `git commit -m "Engine+apps: prune old conditioning traces so the store cannot fill forever"` (+trailers).

---

### Final verification (after all tasks)

- [ ] `pnpm run test` (all packages) + `pnpm run verify` + any repo `checks/*.mjs` the CI runs → ALL PASS, with `packages/engine/test/golden/*.json` unchanged in `git status`.
- [ ] Confirm the coverage table above: all 27 CONFIRMED ids closed; nothing from the Refuted/downgraded section touched.

## Self-review (done at authoring time)

- Coverage table maps all 27 CONFIRMED ids to a task; the Refuted set is untouched.
- Golden care: T1/T9/T10/T11 each modify a golden-pinned function and each states WHY the pinned vectors are unaffected (settings→{} with no `__proto__`; no prototype-key `condEffort` fixture; no warm-up-*block* / no repeated-name `detectPRs` fixture; all `computeSetAdjustment` weights are plate multiples and the "on-target/bad" vectors sit at `|center−eff|=0.5`). No task edits a fixture; `computeSetAdjustment` is left untouched by E6 on purpose.
- Zero-arg trap avoided: coach set literals are built as `{ t, rpe }` (T13/T15); no `newSet`/`newEx`/`newBlock` called with arguments.
- Ordering: Critical (T1–T3) → data-integrity (T4–T9) → engine math (T10–T12) → coach authoring (T13–T16) → web perf (T17–T18). E6 is folded into T3 (shared `liftMoves` with the Critical EC1) and E9 into T9 (shared `conditioning.ts` with E8) — both noted.
- Judgement calls surfaced for the human: C3/C5 (edit no-op preservation vs a per-set editor; T15), EC1 first-seen vs heaviest dedup (T3), P4's `CON_TRACE_KEEP` window and the failed-save recovery pass (T18), and C1 defaulting-vs-dropping a bad legacy format (T2).
