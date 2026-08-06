# Critical Functional Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the five approved audit fixes: athlete-visible coach instructions, an editable (not append-only) coach builder, real conditioning authoring, a non-destructive custom-reps input, and mobile backup restore.

**Architecture:** Extends the guided flow rather than adding new editors — editing re-enters the same steps pre-filled; conditioning gets one new step; the note display and restore are additive panels on existing screens.

**Tech Stack:** React + TS (apps/coach, apps/web), React Native/Expo (apps/mobile), vitest, jest, Playwright smoke (checks/react-smoke.mjs).

## Global Constraints

- `PlannedSet = {t, rpe}` (both strings) is frozen; a warm-up target is `'W' + reps`. Build sets as plain object literals, never the bare zero-arg `newSet`/`newEx`/`newBlock` with arguments (the parameterized versions exist only as `emit.*`).
- The movement picker (`apps/coach/src/editor/MovementPicker.tsx`) stays unchanged.
- No new dependencies anywhere (mobile especially: no expo-file-system / document picker — restore is paste-based).
- Editing an exercise through the guided steps rebuilds its sets uniformly (count × same target/RPE). That is the flow's authoring model and an ACCEPTED limitation of edit round 1 — do not build a per-set editor.
- Engine (`packages/engine`) is untouched except: none. No engine changes in this plan.
- Every task ends: typecheck + tests green for the touched package, then commit. Trailers: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01SqzL3nPXwtqJfm5kUkjJ9p`.

---

### Task 1: RepsStep input stops eating keystrokes

**Files:**
- Modify: `apps/coach/src/builder/steps/RepsStep.tsx`
- Test: none new (component; behavior covered by Task 8's smoke step) — but hand-verify in the browser per Step 2.

**Interfaces:**
- Consumes/Produces: `RepsStep({ value, isWarmup, onChange, onWarmupToggle, onNext })` — signature unchanged.

- [ ] **Step 1: Replace the input's self-clearing echo with local text state**

The bug: `value={CHIPS.includes(value) ? '' : value}` wipes the field the moment the draft matches a chip, so "50" → "0" and "8-12" → "-12". The input must own its in-progress text; chips and typing both write the draft without erasing each other.

```tsx
import { useState } from 'react';
import { BRASS, GHOST } from '../../ui';

const CHIPS = ['5', '8', '10', '12', 'max'];

export function RepsStep({
  value,
  isWarmup,
  onChange,
  onWarmupToggle,
  onNext,
}: {
  value: string;
  isWarmup: boolean;
  onChange: (v: string) => void;
  onWarmupToggle: (v: boolean) => void;
  onNext: () => void;
}) {
  // The custom field owns its text. Chips clear it (they replace a custom
  // target); typing writes the draft directly. `value` still renders the
  // chips' pressed state, so the two inputs never fight over one string.
  const [custom, setCustom] = useState(CHIPS.includes(value) ? '' : value);
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many reps?</h1>
      <label className="flex items-center gap-1 text-4 text-muted">
        <input type="checkbox" checked={isWarmup} onChange={(e) => onWarmupToggle(e.target.checked)} />
        This is a warm-up
      </label>
      <div className="flex flex-wrap justify-center gap-1">
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => { setCustom(''); onChange(c); }}
            aria-pressed={value === c}
            className={value === c ? BRASS : GHOST}
          >
            {c}
          </button>
        ))}
      </div>
      <input
        value={custom}
        onChange={(e) => { setCustom(e.target.value); onChange(e.target.value); }}
        placeholder="or type a custom target, e.g. 8-12"
        aria-label="custom rep target"
        className="mt-1 w-full max-w-[280px] rounded-md border border-line2 bg-panel2 px-1.5 py-1 text-center text-4"
      />
      <button onClick={onNext} className={BRASS + ' mt-2'} disabled={!value.trim()}>
        Next
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify live**

Run `pnpm --filter @hybrid/coach typecheck` (PASS), then `pnpm --filter @hybrid/coach build` and drive the built app with a throwaway Playwright script (dual-server pattern from `checks/react-smoke.mjs`, chromium at `/opt/pw-browsers/chromium`, scratch script deleted after): type "50" → field shows "50" and Next enables; type "8-12" → field shows "8-12"; click chip "8" → field clears, chip pressed. Delete the scratch script.

- [ ] **Step 3: Commit** — `git commit -m "Coach: custom reps input keeps what the coach types"` (+trailers).

---

### Task 2: `cond-detail` step in the pure flow logic (TDD)

**Files:**
- Modify: `apps/coach/src/builder/flowSteps.ts`
- Test: `apps/coach/test/flowSteps.test.ts`

**Interfaces:**
- Produces: `FlowStep` union gains `'cond-detail'`; `COND_SEQUENCE = ['block-type', 'cond-detail', 'review']`; `canAdvance` gains a `condFmt` gate: `canAdvance('cond-detail', d)` requires `d.condFmt` non-empty. `canAdvance`'s draft param widens to `{ movementName: string; reps: string; rpe: string; condFmt: string }`.

- [ ] **Step 1: Write the failing tests** — in the existing `stepsFor` describe, change the cond expectation; extend `canAdvance` tests:

```ts
// stepsFor: replace the cond line in the existing test with
expect(stepsFor({ blockKind: 'cond', isWarmupSet: false })).toEqual(['block-type', 'cond-detail', 'review']);

// canAdvance describe: widen the draft() helper to include condFmt: '' and add
it('cond-detail requires a picked format', () => {
  expect(canAdvance('cond-detail', draft())).toBe(false);
  expect(canAdvance('cond-detail', draft({ condFmt: 'steady' }))).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hybrid/coach test` → FAIL (type error on `'cond-detail'` / sequence mismatch).

- [ ] **Step 3: Implement**

```ts
export type FlowStep = 'block-type' | 'cond-detail' | 'movement' | 'sets' | 'reps' | 'rpe' | 'more' | 'review';
// COND_SEQUENCE — replace, and retitle its comment: conditioning DOES have
// authorable fields (format/effort/minutes); what it lacks is a note field,
// so 'more' still never shows for it.
const COND_SEQUENCE: FlowStep[] = ['block-type', 'cond-detail', 'review'];
// canAdvance: widen the param type and add before the final `return true`:
if (step === 'cond-detail') return draft.condFmt.trim().length > 0;
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @hybrid/coach test` → PASS (all suites). Note `GuidedFlow.tsx` also calls `canAdvance` — its draft must gain `condFmt` in Task 3; if typecheck breaks here on GuidedFlow, that is EXPECTED and fixed by Task 3; commit only the flowSteps+test files.

- [ ] **Step 5: Commit** — `git commit -m "Coach: cond-detail step and gate in the pure flow logic"` (+trailers). If typecheck is red on GuidedFlow at this point, say so in the report and rely on Task 3 (same session, sequential) to restore green — do NOT partially wire GuidedFlow here.

---

### Task 3: CondDetailStep component + GuidedFlow conditioning wiring

**Files:**
- Create: `apps/coach/src/builder/steps/CondDetailStep.tsx`
- Modify: `apps/coach/src/builder/GuidedFlow.tsx`

**Interfaces:**
- Consumes: `CON_FORMATS` (`Record<CondFmtKey, {key, name, ...}>`), `CON_EFFORT_KEYS: EffortKey[]`, `CON_EFFORTS[eff] = {name, zone, ...}` — all top-level `@hybrid/engine` exports. Task 2's `'cond-detail'` step.
- Produces: `CondDetailStep({ condFmt, effort, minutes, onChange, onDone })`; GuidedFlow's `Draft` gains `condFmt: CondFmtKey | ''`, `effort: EffortKey`, `minutes: number` (0 = unset); cond commits through `commitBlock` again (the direct-commit branch in `BlockTypeStep.onPick` is REMOVED — cond now behaves like metcon: pick routes into its sequence via the same fresh-`kind` `nextStep` call the non-cond path already uses).

- [ ] **Step 1: Write CondDetailStep**

```tsx
import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, COND_FORMATS, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { BRASS, GHOST, MICRO } from '../../ui';

export function CondDetailStep({
  condFmt,
  effort,
  minutes,
  onChange,
  onDone,
}: {
  condFmt: CondFmtKey | '';
  effort: EffortKey;
  minutes: number;
  onChange: (patch: { condFmt?: CondFmtKey; effort?: EffortKey; minutes?: number }) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What kind of conditioning?</h1>
      <div className="flex flex-wrap justify-center gap-1">
        {(COND_FORMATS as CondFmtKey[]).map((k) => (
          <button key={k} onClick={() => onChange({ condFmt: k })} aria-pressed={condFmt === k} className={condFmt === k ? BRASS : GHOST}>
            {CON_FORMATS[k].name}
          </button>
        ))}
      </div>
      <span className={MICRO}>Effort</span>
      <div className="flex flex-wrap justify-center gap-1">
        {CON_EFFORT_KEYS.map((k) => (
          <button key={k} onClick={() => onChange({ effort: k })} aria-pressed={effort === k} className={effort === k ? BRASS : GHOST}>
            {CON_EFFORTS[k].name}
          </button>
        ))}
      </div>
      <span className={MICRO}>Minutes (optional)</span>
      <div className="flex items-center gap-3">
        <button onClick={() => onChange({ minutes: Math.max(0, minutes - 5) })} aria-label="fewer minutes" className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8">−</button>
        <span className="num w-12 text-center text-9 font-[900]">{minutes || '—'}</span>
        <button onClick={() => onChange({ minutes: Math.min(120, (minutes || 0) + 5) })} aria-label="more minutes" className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8">+</button>
      </div>
      <button onClick={onDone} className={BRASS + ' mt-2'} disabled={!condFmt}>
        Done
      </button>
    </div>
  );
}
```

(`COND_FORMATS` is the engine's key-list export used by `emit.ts:110`; verify its exact name/type by reading `packages/engine/src/constants.ts` before use — if it is not exported top-level, use `Object.keys(CON_FORMATS) as CondFmtKey[]` instead.)

- [ ] **Step 2: Wire GuidedFlow**

In `apps/coach/src/builder/GuidedFlow.tsx`:
1. `Draft` gains `condFmt: CondFmtKey | ''; effort: EffortKey; minutes: number;` — `EMPTY_DRAFT` adds `condFmt: '', effort: 'medium', minutes: 0`. Import the two types plus `CON_EFFORTS`.
2. DELETE the `if (kind === 'cond') { ... }` direct-commit branch in `BlockTypeStep.onPick` (and its comment) — cond now flows through the same `setDraft` + fresh-`kind` `nextStep('block-type', { blockKind: kind, isWarmupSet: false })` path as every other kind, which routes it to `'cond-detail'` via Task 2's sequence.
3. `commitBlock` gains a cond branch BEFORE the metcon one:
```tsx
if (draft.blockKind === 'cond') {
  const cb = newCondBlock();
  if (draft.condFmt) cb.condFmt = draft.condFmt;
  cb.effort = draft.effort;
  cb.targetZone = CON_EFFORTS[draft.effort].zone;
  if (draft.minutes) cb.minutes = draft.minutes;
  onChange({ ...session, blocks: [...session.blocks, cb] });
}
```
   (keep `else if (draft.blockKind === 'metcon')` etc; the shared tail already resets draft/targetBlock and returns to review).
4. Render the step: alongside the other step branches, `step === 'cond-detail'` renders `<CondDetailStep condFmt={draft.condFmt} effort={draft.effort} minutes={draft.minutes} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} onDone={commitBlock} />`.
5. Every `canAdvance(...)` call site now passes a draft containing `condFmt` (it already passes the whole `draft`, so this is automatic — verify).

- [ ] **Step 3: Verify** — `pnpm --filter @hybrid/coach typecheck && pnpm --filter @hybrid/coach test` → PASS. Build + throwaway Playwright drive (delete after): pick Conditioning → cond-detail screen shows; Done disabled until a format is picked; pick Steady + Hard + 20 → review shows the block; the review screen's cond section still renders no exercise list.

- [ ] **Step 4: Commit** — `git commit -m "Coach: conditioning is authored — format, effort, minutes"` (+trailers).

---

### Task 4: Edit and delete on the review screen

**Files:**
- Modify: `apps/coach/src/builder/GuidedFlow.tsx`

**Interfaces:**
- Consumes: existing steps (unchanged), `blockExercises`, `isWarmupBlock`, `isCond`, `isText`.
- Produces: `ReviewScreen` gains `onEditExercise(bi, ei)`, `onDeleteExercise(bi, ei)`, `onDeleteBlock(bi)`; GuidedFlow gains `editTarget: {bi: number, ei: number} | null` state. Task 8's smoke relies on: each exercise row's NAME is a button (aria-label `edit <name>`), each row has an ✕ button (aria-label `delete <name>`), cond/metcon block headers have an ✕ (aria-label `delete block`).

- [ ] **Step 1: Edit — re-enter the steps pre-filled**

1. Add state `const [editTarget, setEditTarget] = useState<{ bi: number; ei: number } | null>(null);`
2. `onEditExercise(bi, ei)`: read the exercise; prefill the draft and enter the flow at `'movement'`:
```tsx
const b = session.blocks[bi];
if (isCond(b) || isText(b)) return;
const ex = blockExercises(b)[ei];
const allWarm = ex.sets.length > 0 && ex.sets.every((st) => /^\s*w/i.test(st.t));
const first = ex.sets[0];
setDraft({
  blockKind: isWarmupBlock(b) ? 'warmup' : 'lift',
  movementName: ex.name,
  sets: Math.max(1, ex.sets.length),
  reps: first ? first.t.replace(/^\s*w/i, '') : '',
  isWarmup: allWarm,
  rpe: first?.rpe ?? '',
  rest: ex.rest ?? 90,
  tempo: ex.tempo ?? '',
  mode: ex.mode,
  note: ex.cue ?? '',
  condFmt: '', effort: 'medium', minutes: 0,
});
setEditTarget({ bi, ei });
setStep('movement');
```
3. In `commitBlock`'s lift/warmup branch, BEFORE the `targetBlock` append check: if `editTarget != null`, REPLACE in place instead —
```tsx
const t = editTarget;
if (t) {
  const b0 = session.blocks[t.bi];
  if (!isCond(b0) && !isText(b0)) {
    const exs = [...blockExercises(b0)];
    // Keep the row's id and chain flag — editing a movement must not break
    // an existing A1/A2 pairing or remount the row.
    exs[t.ei] = { ...ex, id: exs[t.ei].id, ssNext: exs[t.ei].ssNext };
    const blocks = [...session.blocks];
    blocks[t.bi] = { ...b0, exercises: exs };
    onChange({ ...session, blocks });
  }
}
```
   (structure the branch so exactly one of replace / append-to-target / new-block runs; the shared tail additionally does `setEditTarget(null)`).
4. Back-navigation parity with the add-exercise path: in `go('prev')`, the existing `step === 'movement' && targetBlock != null` early-return gains `|| editTarget != null` (clearing BOTH targets and the draft, returning to review).

- [ ] **Step 2: Delete**

`onDeleteExercise(bi, ei)`: copy blocks; remove the exercise; if the block's exercise list is now empty, remove the block itself; `onChange`. Clear a dangling `ssNext` on the new last exercise (`if (exs.length) exs[exs.length-1] = { ...exs[exs.length-1], ssNext: undefined }` — only needed when the removed row was last). `onDeleteBlock(bi)` (cond/metcon): copy blocks, splice, `onChange`.

- [ ] **Step 3: ReviewScreen render changes**

Exercise row: the name `<span>` becomes `<button onClick={() => onEditExercise(bi, ei)} aria-label={'edit ' + (ex.name || 'exercise')} className="min-w-0 flex-1 truncate text-left text-4 hover:text-gold2">`; after the Chain/Split control add `<button onClick={() => onDeleteExercise(bi, ei)} aria-label={'delete ' + (ex.name || 'exercise')} className={GHOST}>✕</button>`. Cond/text block sections: heading line becomes a flex row with `<button onClick={() => onDeleteBlock(bi)} aria-label="delete block" className={GHOST + ' ml-auto'}>✕</button>`.

- [ ] **Step 4: Rename the session**

Review header: replace the `<h1>` with `<input value={session.name} onChange={(e) => onChange({ ...session, name: e.target.value })} aria-label="session name" placeholder="Session" className="ml-1 min-w-0 flex-1 bg-transparent text-7 font-[800] outline-none focus:text-gold2" />` — thread `onChange` into `ReviewScreen`'s props (it already receives the session).

- [ ] **Step 5: Verify** — typecheck + tests PASS; build + throwaway Playwright drive (delete after): author Bench 3×8@8 → tap the name → picker shows → pick Incline DB Press → Next through pre-filled steps → Done → review shows Incline DB Press, still one row, chain state preserved; ✕ the row → block gone; rename the session → WeekGrid ("Done for now") shows the new name.

- [ ] **Step 6: Commit** — `git commit -m "Coach: review screen edits — tap to re-enter steps, delete, rename"` (+trailers).

---

### Task 5: Clear day on the WeekGrid

**Files:**
- Modify: `apps/coach/src/builder/WeekGrid.tsx`, `apps/coach/src/App.tsx`

**Interfaces:**
- Produces: `WeekGrid` gains `onClear(dayIndex: number)`; App wires it to `select({ d: i }); setDay(null);`. Filled cell renders "Clear day" as a two-tap confirm (first tap arms: button text becomes "Really clear?", disarms on blur/5s), NOT a modal.

- [ ] **Step 1: Implement** — filled-cell action cluster becomes Edit + Clear-day (armed state local to the row: `const [arm, setArm] = useState<number | null>(null)` at grid level, keyed by day index; arming one row disarms others; `onClick` when armed calls `onClear(i)` and disarms; `setTimeout` 5s auto-disarm stored in a ref and cleared on re-arm/unmount). App.tsx: `<WeekGrid onEdit={...} onCreate={...} onClear={(i) => { select({ d: i }); setDay(null); }} />`.
- [ ] **Step 2: Verify** — typecheck PASS; Playwright drive (delete after): Clear day → "Really clear?" → click again → cell returns to Rest day + Create a session; clicking elsewhere first disarms.
- [ ] **Step 3: Commit** — `git commit -m "Coach: a day can go back to rest — armed two-tap clear"` (+trailers).

---

### Task 6: Coach instructions reach both athlete apps

**Files:**
- Modify: `apps/web/src/screens/Logger.tsx` (header region, ~line 259-275)
- Modify: `apps/mobile/src/screens/Logger.tsx` (equivalent header/stage region)

**Interfaces:**
- Consumes: the logged session object each Logger already holds (web: `s`; mobile: `activeSession` — verify local names when editing). `Workout.note` is already on the type.

- [ ] **Step 1: Web** — after the `<header>` block (below the Meter div is fine, above the first exercise card), render:
```tsx
{s.note?.trim() ? (
  <aside className="mt-2 rounded-md border border-gold-line bg-gold-wash p-1.5">
    <div className="text-2 font-[750] tracking-[.12em] uppercase text-gold2">From your coach</div>
    <p className="mt-0.5 text-4 leading-relaxed [overflow-wrap:anywhere]">{s.note}</p>
  </aside>
) : null}
```
(match the file's actual token classes for the gold panel — read neighboring components and reuse their exact classes if these don't exist there.)
- [ ] **Step 2: Mobile** — same panel, RN-flavored (`View`/`T` from the app's ui module, matching mobile's own gold/panel styles), positioned above the first block's content in the Logger screen. Same `note?.trim()` guard.
- [ ] **Step 3: Verify** — web: `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/web test` (if a web test suite exists; otherwise typecheck) + a Playwright drive of a session WITH a note (seed via localStorage) and one without (no panel). Mobile: `pnpm --filter @hybrid/mobile typecheck && pnpm --filter @hybrid/mobile test` — extend an existing Logger jest test to assert the panel renders when `note` is set and not when absent.
- [ ] **Step 4: Commit** — `git commit -m "Athlete: coach instructions render in both loggers"` (+trailers).

---

### Task 7: Mobile restore from a pasted backup

**Files:**
- Modify: `apps/mobile/src/screens/Settings.tsx` (`BackupCard`)
- Test: extend the mobile jest suite (screens or a new `test/restore.test.ts*`) around the pure validate/import helper.

**Interfaces:**
- Consumes: `loadDB(storage, key)` / `saveDB(storage, db, key)` / `LS_KEY` from `@hybrid/engine` (already imported by `apps/mobile/src/store/db.tsx`), the `useDb()` context's update path — read `store/db.tsx` first; if the context exposes no whole-DB replace, add a `replaceDb(next: EngineDB)` to the provider that mirrors `update`'s flush path (setDb + immediate `saveDB`).
- Produces: pure helper `parseBackup(text: string): { db: EngineDB; sessions: number; lastDate: string | null } | { error: string }` — exported for the test; validation = `JSON.parse` inside try, then feed through the same load-shape path the boot uses (`loadDB` against an in-memory Storage shim seeded with the text — this reuses the engine's own migration/validation instead of inventing a second validator).

- [ ] **Step 1: Write the failing jest tests** — valid backup round-trips (session count + a known name survives); garbage text → plain-language `error` (no "Unexpected token" substring — assert the raw message is NOT passed through); empty object → `error`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — `parseBackup` as above; `BackupCard` gains a collapsed "Restore from a backup" section: multiline `TextInput` (paste target), a Restore button that runs `parseBackup`, then shows `Found N sessions (last: <date>). Replace everything on this phone?` with a Replace/Cancel pair; Replace calls the provider's replace path and reports `Restored.`; any error path sets a plain message (`That doesn't look like a Hybrid backup.` for parse failures). No new deps.
- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/mobile typecheck && pnpm --filter @hybrid/mobile test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Mobile: restore from a pasted backup — the export finally has a way back"` (+trailers).

---

### Task 8: Smoke coverage + full verification + push

**Files:**
- Modify: `checks/react-smoke.mjs` (coach section + one web addition)

- [ ] **Step 1: Extend the coach smoke flow** (inside the existing authoring scenario or a new `await t(...)` after it): edit path — click the authored exercise's name button (aria-label `edit Back Squat`), re-pick a different movement, Next through to Done, assert the review row renamed; delete path — ✕ a row, assert it's gone; rename — fill the session-name input, assert WeekGrid reflects it after "Done for now"; conditioning — author one via cond-detail (Steady + Hard), assert the block appears; clear-day — two-tap clear on a filled cell, assert "Create a session" returns. Keep the reload/boundary check LAST and make it re-author what it needs first (it currently assumes specific prior state — re-read it and adjust its setup).
- [ ] **Step 2: Web note panel smoke** — in the web section: seed a session with `note: 'Cap at RPE 8.'` via localStorage, open the logger, assert "From your coach" + the text renders.
- [ ] **Step 3: Full verification** — `pnpm run test && pnpm run verify && node checks/contrast.mjs && node checks/web-touch.mjs && node checks/docs.mjs` → ALL PASS.
- [ ] **Step 4: Commit + push** — `git commit -m "checks: smoke covers editing, conditioning authoring, clear day, and the coach note"` (+trailers); `git push -u origin main` (retry 2s/4s/8s/16s on network failure). Confirm CI success for the pushed head via the GitHub MCP actions list.

---

## Self-review (done at authoring time)

- Spec §1→Task 6, §2→Tasks 4+5, §3→Tasks 2+3, §4→Task 1, §5→Task 7, testing→each task + Task 8. No gaps.
- No placeholders; every code block is complete or names the exact verification to run against real source before use (`COND_FORMATS` export check, web token classes, mobile provider replace path).
- Type consistency: `Draft` gains `condFmt/effort/minutes` in Task 3 and Task 4's prefill writes all three; `canAdvance`'s widened param (Task 2) matches the whole-`draft` call sites (Task 3 §5).
