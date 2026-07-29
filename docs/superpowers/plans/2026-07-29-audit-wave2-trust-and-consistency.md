# Wave 2 — Flow & Trust, Error Humanizing, Consistency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the wave-2 audit fixes: warm-up sets stop recording phantom RPEs, Start buttons start sessions, conditioning blocks prescribe the run, deletes confirm, the coach review/publish surfaces say what they mean, every raw error string is humanized behind one helper per app, and the consistency/parity/hygiene batch from the four audit reports.

**Architecture:** No new packages, no engine changes. Each athlete app gains a tiny `sessionFrom` helper and an `errors.ts` humanizer; the coach gains an `errors.ts` humanizer. Everything else is edits to existing screens. Wording conventions are shared across the three humanizers by the table in the spec — never by imported code.

**Tech Stack:** React + TS (apps/coach, apps/web), React Native/Expo (apps/mobile), vitest (coach, engine), jest (mobile), Playwright checks (`checks/react-smoke.mjs`, `checks/web-touch.mjs`).

## Global Constraints

- **Precondition:** the critical-functional plan (`docs/superpowers/plans/2026-07-29-critical-functional-fixes.md`) must be fully landed first. At drafting time only its Task 1 is committed (`ea61e7a`); Tasks 2-8 of that plan rewrite `GuidedFlow.tsx`/`ReviewScreen`, add `cond-detail`, and extend the smoke. Task 5 below edits the POST-wave-1 ReviewScreen — always re-read the file at implementation time; line numbers cited from the audit are pre-wave-1.
- `PlannedSet = {t, rpe}` (both strings) is frozen; a warm-up target is `'W' + reps` and `isWarmup(st)` (engine) is the only way to test for it. Build sets as plain object literals, never the bare zero-arg `newSet`/`newEx`/`newBlock` with arguments (the parameterized versions exist only as `emit.*`).
- **No engine changes.** `rxLine`'s `7→9` and `condEffortRpe`'s `5-7` glyphs are pinned by golden vectors (`packages/engine/test/golden.test.ts:293,166`) — accepted divergence, do not "unify" them.
- No new dependencies in any package.
- The coach app is desktop-only: never pad its controls to touch size. The existing `@media (pointer: coarse)` rule in `packages/design/src/tokens.css:158-165` already scopes touch sizing to coarse pointers — extend that rule if needed, never a global size bump.
- One `humanizeError` module PER app (`apps/coach/src/errors.ts`, `apps/web/src/errors.ts`, `apps/mobile/src/errors.ts`). Same wording (spec table), separate files. The raw error always goes to `console.warn`; the return value is the only thing rendered.
- Verify real signatures by reading source before writing call sites — especially `apps/coach/src/cloud.tsx`'s `publish`/`signIn`/`signUp` (they return `string | null`, null = success), `useDb()`'s `update(draft => …)` shape in each athlete app, and mobile `ui.tsx`'s `Tap`/`Btn`/`Ring` props.
- Every task ends: typecheck + tests green for the touched package(s), then commit. Trailers on every commit:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01SqzL3nPXwtqJfm5kUkjJ9p`.

---

### Task 1: Warm-up sets stop recording an RPE nobody gave

**Files:**
- Modify: `apps/web/src/screens/Logger.tsx`
- Modify: `apps/mobile/src/screens/Logger.tsx`
- Test: extend `apps/mobile/test/logger.test.tsx`; web asserted by Task 12's smoke.

**Interfaces:**
- Consumes: `isWarmup(st)` from `@hybrid/engine` (already imported by both Loggers).
- Behavior contract: a warm-up set's "Finish Set" confirms directly (no `'rpe'` phase), and its logged set carries NO `felt`. Working sets are byte-identical to today.

- [ ] **Step 1: Mobile failing test first (TDD on the observable behavior)**

Read `apps/mobile/test/logger.test.tsx` and `apps/mobile/test/harness.tsx` to see how a session is seeded and the Logger driven. Add a test: seed an exercise whose first set is `{ t: 'W10', rpe: '' }`, type a weight/reps, press "Finish Set", and assert (a) no "How hard was that?" / RPE stage appears, and (b) the stored set has `done: true` and `felt` undefined/absent. Run `pnpm --filter @hybrid/mobile test` → FAIL.

- [ ] **Step 2: Web — skip the phase, don't write the value**

In `apps/web/src/screens/Logger.tsx`:

1. The Finish Set button (currently line 388, `onClick={() => setPhase('rpe')}`) becomes:

```tsx
<Button
  variant="brass"
  size="lg"
  className="mt-2 w-full"
  // A warm-up is never rated: the engine ignores warm-up RPE everywhere
  // (sessionRpe, autoregulation), so asking was one wasted tap and the
  // untouched 7.5 default then displayed as data the athlete never gave.
  onClick={() => (isWarmup(st) ? confirmSet() : setPhase('rpe'))}
>
  Finish Set
</Button>
```

2. In `confirmSet` (line 192), guard the write:

```tsx
if (!isWarmup(dst)) dst.felt = fmtRpe(rpe);
```

(`dst` is the draft set; `st` above is the same set on the rendered session — both spell a warm-up as `t` starting with `W`.) Nothing else changes: the `lift && !isWarmup(dst)` autoregulation guard at 197 already existed.

- [ ] **Step 3: Mobile — the same two edits**

`apps/mobile/src/screens/Logger.tsx`: the Finish Set `Btn` at ~479 gets `onPress={() => (isWarmup(st) ? confirmSet() : setPhase('rpe'))}`; `confirmSet` at ~194 gets `if (!isWarmup(dst)) dst.felt = fmtRpe(rpe);`. Comments as in web.

- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/mobile test` → PASS (new test green, old suite green); `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/mobile typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "Athlete: warm-up sets skip the RPE step and record no felt RPE"` (+trailers).

---

### Task 2: "Start today's session" starts it

**Files:**
- Create: `apps/web/src/lib/session.ts` (create the `lib/` dir), `apps/mobile/src/store/session.ts`
- Modify: `apps/web/src/screens/Home.tsx`, `apps/web/src/screens/Training.tsx`, `apps/mobile/src/screens/Home.tsx`, `apps/mobile/src/screens/Training.tsx`
- Test: `apps/mobile/test/session.test.ts` (new, jest, pure helper)

**Interfaces:**
- Produces (identical in both apps): `sessionFrom(w: Workout, date: string): Session` — a fresh `status: 'active'` session, `blocks: freshSessionBlocks(w.blocks)`, `workoutId: w.id`.
- Home's Start: if `activeSession` exists, ONLY navigate (never mint a second live session); otherwise `update(draft => draft.sessions.push(sessionFrom(w, today)))` then navigate to Training.

- [ ] **Step 1: The pure helper + mobile test (TDD)**

`apps/mobile/test/session.test.ts`: `sessionFrom` returns `status: 'active'`, copies the name (falling back to `'Session'`), stamps `workoutId`, and produces fresh blocks (mutating the session's first set must not touch the source workout). Run → FAIL. Then both helpers — transcribed from `apps/web/src/screens/Training.tsx:47-61` / `apps/mobile/src/screens/Training.tsx:46-60` (the two existing `startWorkout`/`start` bodies, verified identical in shape):

```ts
// apps/web/src/lib/session.ts   (mobile: apps/mobile/src/store/session.ts, same body)
import { freshSessionBlocks, uid, type Session, type Workout } from '@hybrid/engine';

/** A fresh live session minted from a workout — the ONE place Start happens,
 *  shared by Home's CTA and Training's list so the two cannot diverge. */
export function sessionFrom(w: Workout, date: string): Session {
  return {
    id: uid(),
    date,
    name: w.name || 'Session',
    status: 'active',
    blocks: freshSessionBlocks(w.blocks),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    workoutId: w.id,
  };
}
```

- [ ] **Step 2: Training screens use the helper** — replace the inline `Session` literal in both Training screens' start functions with `draft.sessions.push(sessionFrom(w, today))`. Remove now-unused imports (`freshSessionBlocks`, `uid`, `Session` type where applicable).

- [ ] **Step 3: Home starts, guarded**

Web `Home.tsx`: destructure `update` from `useDb()` (line 44) and `ymd`/`today` already exist. Replace both `onStart={() => nav('/training')}` (line 132) with:

```tsx
onStart={() => {
  // The label is a promise. If nothing is live, Start creates the session
  // here; landing on /training then shows it in progress, not a second
  // identically-worded Start. A live session means Start only navigates —
  // two active sessions is a merge conflict waiting to happen.
  if (!activeSession) update((draft) => { draft.sessions.push(sessionFrom(w, today)); });
  nav('/training');
}}
```

Note `w` is the `PlanRow` map variable — pass a callback per row as today. Mobile `Home.tsx`: same change at the `PlanRow` call (line 130) and the primary CTA path — read lines 80-135 first; `toTraining` stays for "Resume session →" (line 118, active-session card) but plan rows get the minting callback (`update` from `useDb()`, `nav.navigate('Tabs', { screen: 'Train' })` after).

- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/mobile test` PASS; typecheck web+mobile PASS. Build web (`pnpm --filter @hybrid/web build`) and drive with a throwaway Playwright script (dual-server pattern from `checks/react-smoke.mjs`; delete after): seed one scheduled workout in localStorage, tap "Start today's session →", assert the Training screen shows "In progress" (not "Start a session").

- [ ] **Step 5: Commit** — `git commit -m "Athlete: Home's Start actually starts the session"` (+trailers).

---

### Task 3: Conditioning started from a block runs the block's prescription

**Files:**
- Modify: `apps/web/src/screens/Conditioning.tsx`, `apps/mobile/src/screens/Conditioning.tsx`
- Modify (display names, web M4): `apps/web/src/screens/Training.tsx:203`, `apps/web/src/screens/Recap.tsx`, `apps/web/src/screens/History.tsx`, `apps/mobile/src/screens/Training.tsx:212`, and mobile Recap/History if they print the raw key — grep `condFmt` in both apps' screens and convert every DISPLAY of the raw key to `CON_FORMATS[key]?.name ?? key`.

**Interfaces:**
- Consumes: `isCond` (type predicate → `CondBlock`), `CON_FORMATS: Record<CondFmtKey, {name, …}>` — both top-level `@hybrid/engine` exports; the existing `sinkBid`/`sinkBi` query/route params.
- Behavior contract: a run launched from a cond block opens on the block's `condFmt`; the banked `CondResult.effort` is the block's `effort` when there is one.

- [ ] **Step 1: Web — resolve the sink block before state initializes**

In `apps/web/src/screens/Conditioning.tsx`, directly after `sinkBi` (line 80):

```tsx
// The block this run was launched from, when there is one. Resolved by id
// first so an edited session still lands on the right block; `bi` is the
// fallback the result-sink already used.
const sb = activeSession
  ? (activeSession.blocks.find((b) => b.id === sinkBid) ?? activeSession.blocks[sinkBi])
  : undefined;
const sinkBlock = isCond(sb) ? sb : null;
```

Change the fmt init (line 81) to honor it — the module `RUN.fmt` still wins while a run is live (a mid-run remount must not flip the format):

```tsx
const [fmt, setFmtState] = useState<CondFmtKey>(() =>
  RUN.live ? RUN.fmt : sinkBlock?.condFmt && CON_FORMATS[sinkBlock.condFmt] ? sinkBlock.condFmt : RUN.fmt,
);
```

And in `finish()` (line 157) replace the hardcoded effort:

```tsx
effort: sinkBlock?.effort ?? (fmt === 'steady' ? 'easy' : 'hard'),
```

`activeSession` is already destructured (line 77); note `useDb()` ordering — `sb` must be computed before the `useState` call, which is fine since it is plain code, but keep it ABOVE the state block. Do not reorder hooks.

- [ ] **Step 2: Mobile — same three edits** — `apps/mobile/src/screens/Conditioning.tsx`: after `sinkBi` (line 57) compute `sinkBlock` the same way (`activeSession` comes from `useDb()` line 52 — verify); `useState<CondFmtKey>(() => sinkBlock?.condFmt && CON_FORMATS[sinkBlock.condFmt] ? sinkBlock.condFmt : 'intervals')` (line 58; mobile has no module RUN — verify how it survives remount by reading lines 60-75 first); `effort: sinkBlock?.effort ?? (fmt === 'steady' ? 'easy' : 'hard')` (line 190).

- [ ] **Step 3: Format display names** — every place that renders `b.condFmt` / `result.fmt` raw as copy becomes `CON_FORMATS[key]?.name ?? key`. Grep first: `grep -rn "condFmt" apps/web/src/screens apps/mobile/src/screens`. Known sites: web `Training.tsx:203`, `Recap.tsx` (~141), `History.tsx` (~158); mobile `Training.tsx:212`. Leave non-display uses (params, sinks) alone.

- [ ] **Step 4: Verify** — typecheck web+mobile PASS; mobile jest PASS. Throwaway Playwright drive (delete after): seed a session whose cond block is `condFmt: 'steady', effort: 'medium'`, open Training → "Start conditioning", assert the Conditioning screen shows "Steady-state" selected; finish a short run (or call the finish path) and assert the banked block's `condResult.effort === 'medium'` via localStorage.

- [ ] **Step 5: Commit** — `git commit -m "Athlete: conditioning launched from a block runs the block's prescription"` (+trailers).

---

### Task 4: Deleting a session requires a second tap (web)

**Files:**
- Modify: `apps/web/src/screens/Library.tsx`

**Interfaces:**
- Produces: an armed two-tap on "Delete session" (wave 1's Clear-day pattern; no modal, no new component). Mobile already confirms (`Alert.alert`, `apps/mobile/src/screens/Library.tsx:97`) — untouched.

- [ ] **Step 1: Implement**

In `Library.tsx` (sessions tab), add `const [armDel, setArmDel] = useState<string | null>(null);` beside `open`. The delete button (line 187) becomes:

```tsx
<Button
  size="sm"
  onClick={() => {
    // First tap arms, second destroys. The delete writes a sync tombstone —
    // by design unrecoverable — so it must not be reachable by one mis-tap
    // 20px from Edit. Same armed pattern as the coach's Clear day.
    if (armDel === w.id) {
      removeWorkout(w.id);
      setArmDel(null);
    } else setArmDel(w.id);
  }}
  className={armDel === w.id ? 'border-[color:var(--color-bad)]/40 text-bad' : undefined}
>
  {armDel === w.id ? 'Really delete?' : 'Delete session'}
</Button>
```

Disarm on collapse/other-card: in the card header's `onClick` (line 151) add `setArmDel(null);`, and add a 5s auto-disarm:

```tsx
useEffect(() => {
  if (!armDel) return;
  const t = setTimeout(() => setArmDel(null), 5000);
  return () => clearTimeout(t);
}, [armDel]);
```

- [ ] **Step 2: Verify** — typecheck PASS. Throwaway Playwright drive (delete after): expand a session → "Delete session" → button reads "Really delete?" and the session still exists → second click removes it; arming then waiting 5s disarms.

- [ ] **Step 3: Commit** — `git commit -m "Web: deleting a session takes two taps — the tombstone is forever"` (+trailers).

---

### Task 5: Coach review screen shows the prescription; publish status readable at a glance

**Files:**
- Modify: `apps/coach/src/builder/GuidedFlow.tsx` (ReviewScreen), `apps/coach/src/builder/steps/PublishStep.tsx`

**Interfaces:**
- Consumes: `rxLine(ex)` (engine, `packages/engine/src/session.ts:142` — takes an `Exercise<AnySet>`, returns "3 × 8kg · RPE 8 · rest 1:30"-style line), `CON_FORMATS`, `CON_EFFORTS`, `isCond`/`isText` type predicates, `IconSend` from `../../ui` (currently exported, unused).
- **Wave-1 collision warning:** wave 1's Task 4 rewrites ReviewScreen rows (name becomes an edit button, ✕ per row, header becomes an input). READ the whole post-wave-1 `GuidedFlow.tsx` before editing; the code below names WHAT each block renders — merge it into the row structure you find, keeping wave 1's buttons and aria-labels intact.

- [ ] **Step 1: Review detail**

Per exercise `<li>`, under the existing name/actions row, add the prescription line and cue:

```tsx
<p className="num ml-4 text-3 text-muted">{rxLine(ex)}</p>
{ex.cue ? <p className="ml-4 text-3 text-gold2">{ex.cue}</p> : null}
```

(`ml-4` = 32px, aligning under the name past the letter chip — adjust to the real row's indent after reading it.) Replace the `isCond(b) || isText(b) ? null : (…)` branch so cond and metcon render their content instead of nothing:

```tsx
{isText(b) ? (
  <p className="mt-1 whitespace-pre-wrap text-4 text-text">
    {b.body?.trim() || 'Nothing written for this one yet.'}
  </p>
) : null}
{isCond(b) ? (
  <p className="num mt-1 text-3 text-muted">
    {(CON_FORMATS[b.condFmt]?.name ?? b.condFmt) +
      ' · ' + (CON_EFFORTS[b.effort]?.name ?? b.effort) +
      (b.minutes ? ' · ' + b.minutes + ' min' : '')}
  </p>
) : null}
```

(`isCond`/`isText` are type predicates — `b` narrows to `CondBlock`/`TextBlock`; `b.effort` may be undefined on old data, hence the `??` fallbacks. `b.minutes` is `number | string | undefined` — truthiness check is correct.)

- [ ] **Step 2: Publish status tones + honest label + no-athlete guard**

In `PublishStep.tsx`, `msg` becomes `{ tone: 'ok' | 'warn'; text: string } | null`:

```tsx
const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

const validate = () => {
  try {
    assertPublishable(sess);
    setMsg({ tone: 'ok', text: cloud.user ? 'Ready to send.' : 'Ready to send — sign in to send this to an athlete.' });
  } catch (e) {
    setMsg({ tone: 'warn', text: 'Could not validate: ' + (e as Error).message });
  }
};

const publish = async () => {
  setPublishing(true);
  const err = await cloud.publish(sess, athlete, date);
  setMsg(err ? { tone: 'warn', text: err } : { tone: 'ok', text: 'Sent to athlete.' });
  setPublishing(false);
};
```

(Task 6 swaps the raw `.message`/`err` text through `humanizeError` — here only the tone plumbing lands.) The status line (line 56) becomes:

```tsx
{msg ? (
  <p
    role="status"
    className={
      'mt-1 flex items-center gap-0.5 rounded-md border px-1.5 py-1 text-3 ' +
      (msg.tone === 'ok'
        ? 'border-gold-line bg-gold-wash text-gold2'
        : 'border-[color:var(--color-warn)]/40 bg-panel2 text-warn')
    }
  >
    {msg.tone === 'ok' ? <IconSend size={14} /> : null}
    <span>{msg.text}</span>
  </p>
) : null}
```

Signed-out button label (line 50): `Validate & publish` → `Validate` (the smaller copy below it already explains why nothing sends). Send button gains `disabled={publishing || !athlete}`, and when `cloud.user && !cloud.athletes.length` render, in place of the empty `<select>`:

```tsx
<p className="text-3 text-muted">
  {cloud.loadError || 'No athletes yet — create an invite from the dashboard, and "Myself" appears once your account loads.'}
</p>
```

(Verify against `cloud.tsx`: `athletes` is `[]` until `refreshAthletes` resolves, then always contains "Myself"; `loadError` explains a refused read.)

- [ ] **Step 3: Verify** — `pnpm --filter @hybrid/coach typecheck && pnpm --filter @hybrid/coach test` PASS. Build + throwaway Playwright drive (delete after): author a 3×8@8 exercise with a cue and rest 90 → review row shows "3 × 8kg · RPE 8 · rest 1:30" and the cue; author a metcon → its body text is on the review card; the wave-1 cond block shows "Steady-state · Hard · 20 min"; signed out, click Validate → status has the gold border and the send icon.

- [ ] **Step 4: Commit** — `git commit -m "Coach: review shows the prescription; publish status wears its verdict"` (+trailers).

---

### Task 6: Coach error humanizer (TDD)

**Files:**
- Create: `apps/coach/src/errors.ts`
- Test: `apps/coach/test/errors.test.ts`
- Modify: `apps/coach/src/cloud.tsx`, `apps/coach/src/builder/steps/PublishStep.tsx`

**Interfaces:**
- Produces: `humanizeError(e: unknown, context?: string): string` — logs the raw value via `console.warn('[' + (context || 'error') + ']', e)`, returns a sentence from the spec's wording table. Accepts `Error | string | unknown`.
- **Call sites to convert (all verified by grep at drafting time):**

| # | file:line | today | becomes |
|---|---|---|---|
| 1 | `apps/coach/src/cloud.tsx:107` | `'Could not read your training: ' + error.message` | `'Could not read your training: ' + humanizeError(error, 'own-training')` (keep the `'none'`/`'shape'` sentinels at 117/127 untouched — Dashboard branches on them) |
| 2 | `cloud.tsx:175` | `'Could not read your athletes: ' + err.message` | `'Could not read your athletes: ' + humanizeError(err, 'athletes')` |
| 3 | `cloud.tsx:191` | `'Could not convert session: ' + (e as Error).message` | `humanizeError(e, 'publish')` (emit-mapping swallows the contract string) |
| 4 | `cloud.tsx:207` | `'Could not replace the existing assignment: ' + clear.error.message` | `'Could not replace the existing assignment: ' + humanizeError(clear.error, 'publish')` |
| 5 | `cloud.tsx:219` | `return error.message;` (bare — the audit's 2.9) | `return humanizeError(error, 'publish');` |
| 6 | `cloud.tsx:222` | `return String((e as Error)?.message \|\| e);` | `return humanizeError(e, 'publish');` |
| 7 | `cloud.tsx:261` | `return error.message;` (bare — 2.10) | `return humanizeError(error, 'invite');` |
| 8 | `cloud.tsx:274` | `'Could not revoke that invite: ' + error.message` | `'Could not revoke that invite: ' + humanizeError(error, 'invite')` |
| 9 | `cloud.tsx:279` | signIn `error.message` | `humanizeError(error, 'sign-in')` |
| 10 | `cloud.tsx:284` | signUp `error.message` | `humanizeError(error, 'sign-up')` (keep the confirm-email success sentence at 285) |
| 11 | `apps/coach/src/builder/steps/PublishStep.tsx:18` (post-Task-5 shape) | `'Could not validate: ' + (e as Error).message` | `humanizeError(e, 'validate')` |

- [ ] **Step 1: Failing tests** — `apps/coach/test/errors.test.ts` (vitest):

```ts
import { describe, expect, it, vi } from 'vitest';
import { humanizeError } from '../src/errors';

describe('humanizeError', () => {
  it('maps network failures', () => {
    expect(humanizeError(new TypeError('Failed to fetch'))).toBe(
      "Can't reach the server — check your connection and try again.",
    );
  });
  it('maps Supabase auth strings', () => {
    expect(humanizeError({ message: 'Invalid login credentials' })).toBe(
      "That email and password don't match. Check them and try again.",
    );
    expect(humanizeError(new Error('Email not confirmed'))).toBe(
      'Confirm your email first — the link is in your inbox.',
    );
    expect(humanizeError(new Error('User already registered'))).toBe(
      'That email already has an account — sign in instead.',
    );
  });
  it('never leaks an emit contract string', () => {
    const out = humanizeError(new Error('emit: set 2/0/1 carries logger field "feltRpe"'));
    expect(out).not.toContain('emit:');
    expect(out).toBe("This session isn't sendable yet — reopen it in the builder and check each block.");
  });
  it('maps JSON noise and falls back on anything else', () => {
    expect(humanizeError(new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`))).toBe(
      'The server sent back something unexpected — try again in a minute.',
    );
    expect(humanizeError({})).toBe('Something went wrong. Try again, or check your connection.');
    expect(humanizeError(undefined)).toBe('Something went wrong. Try again, or check your connection.');
  });
  it('logs the raw error to the console, never the UI', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    humanizeError(new Error('PGRST301 something obscure'), 'publish');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

Run `pnpm --filter @hybrid/coach test` → FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
// apps/coach/src/errors.ts
/*
 * The one place that decides what an error may SAY to a coach.
 *
 * Raw driver strings — Supabase auth codes, Postgrest noise, fetch internals,
 * the engine's emit contract — are for the console. The UI gets a sentence a
 * non-engineer can act on. Wording is kept in step with the athlete apps'
 * errors.ts by convention (see the wave-2 spec table), never by import.
 */
export function humanizeError(e: unknown, context?: string): string {
  const raw =
    typeof e === 'string'
      ? e
      : e && typeof e === 'object' && 'message' in e
        ? String((e as { message?: unknown }).message ?? '')
        : '';
  // The raw string still exists exactly once — where a developer looks.
  console.warn('[' + (context || 'error') + ']', e);
  const m = raw.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed') || m.includes('network request failed'))
    return "Can't reach the server — check your connection and try again.";
  if (m.includes('invalid login credentials')) return "That email and password don't match. Check them and try again.";
  if (m.includes('email not confirmed')) return 'Confirm your email first — the link is in your inbox.';
  if (m.includes('already registered')) return 'That email already has an account — sign in instead.';
  if (m.includes('emit:')) return "This session isn't sendable yet — reopen it in the builder and check each block.";
  if (m.includes('unexpected token') || m.includes('not valid json'))
    return 'The server sent back something unexpected — try again in a minute.';
  return 'Something went wrong. Try again, or check your connection.';
}
```

- [ ] **Step 3: Convert the 11 call sites** per the table (read each surrounding function first; sites 1-2 keep their context prefixes because Dashboard/App render them as "why the list is empty" explanations, and the prefix names WHICH read failed).
- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/coach test && pnpm --filter @hybrid/coach typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Coach: one place decides what an error may say"` (+trailers).

---

### Task 7: Web athlete error humanizer

**Files:**
- Create: `apps/web/src/errors.ts`
- Modify: `apps/web/src/cloud/sync.tsx`, `apps/web/src/cloud/whoop.tsx`, `apps/web/src/screens/Settings.tsx`

**Interfaces:**
- Produces: same `humanizeError(e, context?)` signature as Task 6's, with two athlete-flavored additions: `context === 'whoop'` maps network/JSON shapes to `"Can't reach WHOOP right now — your training data on this device is unaffected."`, and `context === 'invite'` maps unrecognized errors to `"That code didn't work — check it with your coach and try again."` (instead of the generic fallback). Web has no unit runner (`apps/web/package.json` test is a stub) — the module transcribes Task 6's tested logic; behavior is asserted by Task 12's smoke.
- **Call sites to convert (grep-verified):**

| # | file:line | today | becomes |
|---|---|---|---|
| 1 | `apps/web/src/cloud/sync.tsx:205` | `setError(String((e as Error)?.message \|\| e))` | `setError(humanizeError(e, 'sync'))` |
| 2 | `sync.tsx:247` | same shape in `pushNow().catch` | `humanizeError(e, 'sync')` |
| 3 | `sync.tsx:264` | signIn `e.message` | `humanizeError(e, 'sign-in')` |
| 4 | `sync.tsx:269` | signUp `e.message` | `humanizeError(e, 'sign-up')` |
| 5 | `sync.tsx:298` | claimInvite `e.message` | `humanizeError(e, 'invite')` |
| 6 | `apps/web/src/cloud/whoop.tsx:104` | sync `String((e as Error)?.message \|\| e)` | `humanizeError(e, 'whoop')` |
| 7 | `whoop.tsx:133` | refresh, same shape | `humanizeError(e, 'whoop')` |
| 8 | `apps/web/src/screens/Settings.tsx:74` | restore fallback `String((err as Error).message \|\| err)` | keep the `SyntaxError` branch ("That file isn't valid JSON."), route the fallback through `humanizeError(err, 'restore')` |

- [ ] **Step 1: Implement the module** — copy Task 6's body, drop the `emit:` branch (nothing emits on the athlete side), add before the generic fallback:

```ts
  if (context === 'whoop' && (m.includes('request failed') || m.includes('unexpected token') || m.includes('not valid json') || m.includes('failed to fetch') || m.includes('whoop is not connected')))
    return "Can't reach WHOOP right now — your training data on this device is unaffected.";
  if (context === 'invite') return "That code didn't work — check it with your coach and try again.";
```

(Note `whoop.tsx`'s `get()` throws `'Request failed (503)'`-style strings — that is the `request failed` match. `'WHOOP is not connected.'` from `sync()` line 98 is already human; matching it keeps the calmer WHOOP sentence.) Keep every mapped sentence byte-identical to Task 6 where the shape overlaps.

- [ ] **Step 2: Convert the 8 sites** per the table.
- [ ] **Step 3: Verify** — `pnpm --filter @hybrid/web typecheck` PASS; `pnpm --filter @hybrid/web build` PASS. Throwaway Playwright drive of the built app (functions host unreachable locally — exactly the audit's setup, delete script after): Settings' WHOOP card shows the WHOOP sentence and the page contains no "Unexpected token" text.
- [ ] **Step 4: Commit** — `git commit -m "Web: raw error strings stop reaching the athlete"` (+trailers).

---

### Task 8: Mobile error humanizer + GPS/HR failure distinction (TDD)

**Files:**
- Create: `apps/mobile/src/errors.ts`
- Test: `apps/mobile/test/errors.test.ts` (jest — same vectors as Task 6 plus the whoop/invite contexts)
- Modify: `apps/mobile/src/cloud/sync.tsx`, `apps/mobile/src/cloud/whoop.tsx`, `apps/mobile/src/screens/Settings.tsx`, `apps/mobile/src/native/capabilities.ts`, `apps/mobile/src/screens/Conditioning.tsx`

**Interfaces:**
- Produces: `humanizeError` identical in wording to Task 7's (RN network errors say "Network request failed" — already matched). Plus: `hrMsg`/`geoMsg` on the Conditioning screen become `{ text: string; warn: boolean } | null` so a permission denial stops looking like "Looking for your strap…".
- **Call sites to convert (grep-verified):**

| # | file:line | today | becomes |
|---|---|---|---|
| 1 | `apps/mobile/src/cloud/sync.tsx:217` | `setError(String((e as Error)?.message \|\| e))` | `humanizeError(e, 'sync')` |
| 2 | `sync.tsx:286` | same in `pushNow().catch` | `humanizeError(e, 'sync')` |
| 3 | `sync.tsx:303` | signIn `e.message` | `humanizeError(e, 'sign-in')` |
| 4 | `sync.tsx:308` | signUp `e.message` | `humanizeError(e, 'sign-up')` |
| 5 | `sync.tsx:337` | claimInvite `e.message` | `humanizeError(e, 'invite')` |
| 6 | `apps/mobile/src/cloud/whoop.tsx:187` | `String((e as Error)?.message \|\| e)` | `humanizeError(e, 'whoop')` |
| 7 | `whoop.tsx:216` | same | `humanizeError(e, 'whoop')` |
| 8 | `whoop.tsx:282` | same | `humanizeError(e, 'whoop')` |
| 9 | `apps/mobile/src/screens/Settings.tsx:138` | `` `Export failed: ${String((e as Error)?.message \|\| e)}` `` | `'Export failed: ' + humanizeError(e, 'backup')` |
| 10 | `apps/mobile/src/native/capabilities.ts:133` | `say('error', String((err …)?.message \|\| 'Bluetooth scan failed.'))` | `console.warn('[ble]', err); say('error', 'Bluetooth scan failed — check that Bluetooth is on, then try again.')` |
| 11 | `capabilities.ts:166` | `say('error', String((e …)?.message \|\| 'Could not connect to that strap.'))` | `console.warn('[ble]', e); say('error', 'Could not connect to that strap — move closer and try again.')` |
| 12 | `capabilities.ts:394` | `say('error', String((e …)?.message \|\| 'GPS is not available on this build.'))` | `console.warn('[gps]', e); say('error', 'GPS is not available right now — the run still counts by time and heart rate.')` |

(The other `say('error', …)` strings in capabilities.ts are already humanized fixed sentences — leave them.)

- [ ] **Step 1: Failing jest tests** — port Task 6's vectors (minus emit, plus whoop/invite contexts) to `apps/mobile/test/errors.test.ts`; run `pnpm --filter @hybrid/mobile test` → FAIL. Implement the module (Task 7's body verbatim). Run → PASS.
- [ ] **Step 2: Convert sites 1-9**, and 10-12 in capabilities.ts as fixed sentences + `console.warn`.
- [ ] **Step 3: Error tint on the live run (mobile M4)** — in `apps/mobile/src/screens/Conditioning.tsx`: `hrMsg`/`geoMsg` state (lines 62-63) become `useState<{ text: string; warn: boolean } | null>(null)`; the two `start()` callbacks (lines ~155-163) become:

```tsx
await monitor.current.start(setBpm, (state, msg) =>
  setHrMsg(
    state === 'connected'
      ? null
      : { text: state === 'scanning' ? 'Looking for your strap…' : msg, warn: state === 'error' },
  ),
);
// …
await geoTracker.current.start(
  (smp) => geoSamples.current.push(smp),
  (state, msg) => setGeoMsg(state === 'tracking' ? null : { text: msg, warn: state === 'error' }),
);
```

Render (lines 315-316): `<T className={'mt-1 text-3 ' + (hrMsg.warn ? 'text-warn' : 'text-muted')}>{hrMsg.text}</T>` (same for `geoMsg`); update the `bpm == null && hrMsg` guard for the new null shape, and the `setHrMsg('')`/`setGeoMsg('')` resets in `start()` become `null`. Grep the file for every other `hrMsg`/`geoMsg` reference before committing.

- [ ] **Step 4: Verify** — `pnpm --filter @hybrid/mobile test && pnpm --filter @hybrid/mobile typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Mobile: humanized errors, and a GPS/HR failure no longer whispers"` (+trailers).

---

### Task 9: Terminology & copy consistency batch

**Files:**
- Modify: `apps/web/src/screens/Library.tsx`, `apps/mobile/src/screens/Planner.tsx`, `apps/web/src/screens/Logger.tsx`, `apps/mobile/src/screens/Logger.tsx`, `apps/coach/src/builder/steps/MoreStep.tsx`, `apps/mobile/src/screens/History.tsx`, `apps/mobile/src/screens/Recap.tsx`

**Interfaces:** copy-only, except MoreStep which imports the coach's own `fmtRest` from `../../model` (its doc-commented purpose — an authoring-time M:SS/"none" preview — finally gets its caller; consistency 6.7 resolved by use, not deletion).

- [ ] **Step 1: Apply each row** (all sites verified at drafting time; re-grep any that drifted):

| item | file:line | change |
|---|---|---|
| 1.1 glyph | `apps/web/src/screens/Library.tsx:140` | `+ New session` → `＋ New session` (fullwidth U+FF0B, matching line 198's own quote of it and mobile) |
| 1.2 labels | `apps/mobile/src/screens/Planner.tsx:255-262` | labels → `☀ Warm-up / Cooldown`, `✎ Metcon / notes`; reorder buttons to web's order (Block, Warm-up/Cooldown, Conditioning, Metcon/notes); the row is four `flex-1` buttons — change the container to `flex-row flex-wrap` with `min-w-[48%]` per button so the longer labels wrap to a 2×2 grid instead of clipping. Verify against web `Planner.tsx:314-321`. |
| 1.4 fallback | `apps/web/src/screens/Logger.tsx:272`, `apps/mobile/src/screens/Logger.tsx:275` | `{s.name \|\| 'Workout'}` → `{s.name \|\| 'Session'}` (the back button beside it already says "back to session") |
| 1.5 copy | `apps/coach/src/builder/steps/MoreStep.tsx:51` | "The workout, as the athlete reads it" → "The session, as the athlete reads it" |
| 1.6 preview | `apps/coach/src/builder/steps/MoreStep.tsx:29-33` | beside the `Rest (seconds)` input render `<span className="num text-3 text-dim">{fmtRest(rest)}</span>` with `import { fmtRest } from '../../model';` — read the field's markup first and place the preview on the label row |
| 1.7 tense | `apps/mobile/src/screens/History.tsx:50` | "Your first one shows up here…" → "Your first one will show up here the moment you finish it." |
| 1.8 casing | `apps/web/src/screens/Logger.tsx:414`, `apps/mobile/src/screens/Logger.tsx:561` | `Skip Rest` → `Skip rest` |
| PR footnote | `apps/mobile/src/screens/Recap.tsx` (grep `first on record`) | → "first one on record" (match web `Recap.tsx:70`) |

- [ ] **Step 2: Verify** — typecheck all three apps; `pnpm --filter @hybrid/coach test && pnpm --filter @hybrid/mobile test` PASS (fix any snapshot/copy assertions these strings appear in — grep the test dirs for the old strings first).
- [ ] **Step 3: Commit** — `git commit -m "Copy: one voice across the three apps — glyphs, labels, casing, tense"` (+trailers).

---

### Task 10: Design-system floor — the on-accent token, mobile hex literals, touch-target verification

**Files:**
- Modify: `packages/design/src/tokens.ts`, `packages/design/src/tokens.css`, `apps/mobile/tailwind.config.js`, `docs/DESIGN-TOKENS.md`
- Modify (9 on-accent sites): `apps/web/src/ui/index.tsx:68`, `apps/web/src/UpdateBanner.tsx:70`, `apps/web/src/screens/planner/SupersetSeam.tsx:32`, `apps/coach/src/ui.tsx:27`, `apps/mobile/src/ui.tsx:300`, `apps/mobile/src/screens/planner/SupersetSeam.tsx:33-34`, `apps/mobile/src/screens/Settings.tsx:207,273,320`
- Modify (token-matching hex): `apps/mobile/src/screens/Progress.tsx:251,298,316`, `apps/mobile/src/screens/Recap.tsx:116`
- Modify: `checks/web-touch.mjs` (+ whatever offenders it finds)

- [ ] **Step 1: Mint the token** — `tokens.ts`: add `onAccent: '#1b1509',` in the BRAND block with the comment `/* Ink ON brass/gold — the doc's --on-accent gap, closed. */`; `tokens.css`: add `--color-on-accent: #1b1509;` beside the gold tokens; `apps/mobile/tailwind.config.js`: add `'on-accent': '#1b1509',` to `colors`. Update the `docs/DESIGN-TOKENS.md` gap table row ("Ink ON accent … `--on-accent`") to point at the new token, and run `node checks/docs.mjs` to confirm the doc checker is still green.

- [ ] **Step 2: Convert the nine sites** — className sites: `text-[#1b1509]` → `text-on-accent`, `border-[#1b1509]` → `border-on-accent`. RN style sites (`mobile/ui.tsx:300`, `Settings.tsx:207,273,320`): `{ color: '#1b1509' }` → `{ color: color.onAccent }` with `import { color } from '@hybrid/design';` (ui.tsx already imports it; check Settings' imports).

- [ ] **Step 3: Token-matching hex → tokens** — `Progress.tsx:251` and `Recap.tsx:116`: replace the `style={{ color: hex-ternary }}` with a className ternary using the existing utilities (`text-dim` / `text-ok` / `text-bad` / `text-muted`); `Progress.tsx:298,316`: `<Trend color="#9fc59b" …>` → `color={color.ok}`, `"#cf9d4f"` → `color.zMod` (import `color` from `@hybrid/design`; verify the exported key names against `packages/design/src/tokens.ts` — `ok` and `zMod` confirmed at drafting time).

- [ ] **Step 4: Touch-target verification, gym path** — the audit predates a re-measure: `c868a4a` already added the `pointer: coarse` 44px rule (`tokens.css:158-165`) and `checks/web-touch.mjs`, but the check only visits `/` and only measures `<button>`s. Extend `checks/web-touch.mjs`: (a) visit `/`, `/training`, and `/library` (seed localStorage with one workout + one active session before `page.goto` so Training renders its in-progress list — read how react-smoke seeds and copy the pattern); (b) widen the selector to `document.querySelectorAll('button, a, [role="button"], select')`, still filtered to visible. Run it. For any real offender under 44px on the coarse profile: anchors get added to the coarse-pointer rule in tokens.css as `a` alongside `button` ONLY if the failures are anchors; otherwise fix the specific control's padding. Acceptance: `node checks/web-touch.mjs` PASS on both profiles (coach app untouched — the rule is pointer-scoped, and the coach is desktop-only by constraint).

- [ ] **Step 5: Verify** — typecheck all apps; `pnpm --filter @hybrid/mobile test` PASS; `node checks/contrast.mjs && node checks/web-touch.mjs && node checks/docs.mjs` PASS (contrast guards the token swap changed no rendered color: on-accent is the same literal).
- [ ] **Step 6: Commit** — `git commit -m "Design: --on-accent exists; hex literals resolve through tokens; touch check covers the gym path"` (+trailers).

---

### Task 11: Mobile parity batch — empty state, exits, logged list, rest indicator, one-liners

**Files:**
- Modify: `apps/mobile/src/screens/Training.tsx`, `History.tsx`, `Calendar.tsx`, `Exercise.tsx`, `Conditioning.tsx`, `Logger.tsx`, `Progress.tsx`, `Settings.tsx`, `Library.tsx`, `apps/mobile/src/screens/planner/ExerciseCard.tsx`, `apps/mobile/src/ui.tsx` (Btn gains `label`)
- Test: extend `apps/mobile/test/training.test.tsx` (empty state) and `apps/mobile/test/logger.test.tsx` (logged list)

**Interfaces:**
- `Btn` gains an optional `label?: string` prop, passed to `Tap` as `label={label ?? (typeof children === 'string' ? children : undefined)}` — existing callers unchanged.
- Back-control pattern = mobile Logger's exact header Tap (`apps/mobile/src/screens/Logger.tsx:262-269`), placed in a row above the screen's Kicker.

- [ ] **Step 1: Training empty state (3.1)** — replace the silent `(candidates.length ? candidates : db.workouts).map(…)` (line 94) with web's shape (`apps/web/src/screens/Training.tsx:88-128`): candidates map as today; else `<Empty title="Nothing scheduled for today" body="Anything in your Library can be started now — scheduling is a convenience, not a gate." />`; then, when `!candidates.length && db.workouts.length`, a `<SectionHead title="Everything else" />` + the same row markup over `db.workouts`. Mobile `ui.tsx` exports `Empty`/`SectionHead` (verify imports). Extend `training.test.tsx`: with workouts but none scheduled today, "Nothing scheduled for today" renders and the library list appears under "Everything else".

- [ ] **Step 2: Back controls on the four exit-less screens (I1)** — History, Calendar, Exercise, Conditioning each get, above their `Kicker`:

```tsx
<Tap
  onPress={() => nav.goBack()}
  label="back"
  box={40}
  className="mb-1 h-5 w-5 items-center justify-center self-start rounded-md border border-line2 bg-panel2"
>
  <T className="text-6 text-muted">←</T>
</Tap>
```

History/Calendar don't import `useNavigation` yet — add it (Exercise and Conditioning: check first). On Conditioning it renders in BOTH setup and live states (bailing out of a live run is the point — the run itself survives per that screen's module comment; verify, and if mobile's run does NOT survive unmount, render the control only when `!live` and say so in the commit).

- [ ] **Step 3: LoggedList port (I2)** — transcribe web `Logger.tsx:661-680` into the mobile Logger card (below the hint block), RN-flavored:

```tsx
function LoggedList({ ex }: { ex: Exercise<LoggedSet> }) {
  const done = ex.sets.map((st, i) => ({ st, i })).filter((x) => x.st.done);
  if (!done.length) return null;
  return (
    <View className="mt-2 border-t border-line">
      {done.map(({ st, i }) => (
        <View key={i} className="flex-row items-center gap-1 border-b border-line py-1">
          <T num className="w-4 text-4 text-dim">{i + 1}</T>
          <T num className="flex-1 text-4 text-text">
            {(st.aVal || '—') + (isLiftMode(ex.mode) ? 'kg' : '') + (st.aVal2 ? ' × ' + st.aVal2 : '')}
            {isWarmup(st) ? '  warm-up' : ''}
          </T>
          {st.felt ? <T num className="text-4 text-gold2">RPE {st.felt}</T> : null}
        </View>
      ))}
    </View>
  );
}
```

(Imports already in the file: `isLiftMode`, `isWarmup`, types. Extend `logger.test.tsx`: after confirming a set, its weight×reps appears in the card.)

- [ ] **Step 4: Rest indicator on Training (I3)** — in `Training.tsx`'s active-session render, directly under the progress meter:

```tsx
{restRunning ? (
  <View className="mt-1 flex-row items-center gap-1 self-start rounded-pill border border-gold-line bg-panel2 px-1.5 py-0.5">
    <T num className="text-3 text-gold2">Rest · {fmtRest(restLeft)}</T>
    <Tap onPress={stopRest} label="skip rest" box={{ h: 32 }}>
      <T className="text-3 text-dim">Skip</T>
    </Tap>
  </View>
) : null}
```

where `const { running: restRunning, left: restLeft, stop: stopRest } = useRest();` (`apps/mobile/src/store/rest.tsx` exports `useRest` — verify the hook name by reading the file's bottom). Import `fmtRest` from `@hybrid/engine`. Deliberately NOT a floating overlay — the scheduled notification already covers backgrounding; this answers "how much longer" at a glance.

- [ ] **Step 5: One-liners** (each verified cheap; re-read each site first):
  - I8: `Calendar.tsx:28-36` — the `‹`/`›` `Btn`s get `label="previous month"` / `label="next month"` (via the new Btn prop).
  - I9: `Calendar.tsx` end — `<Btn className="mt-2" onPress={() => nav.navigate('Tabs', { screen: <library tab name> })}>Schedule something</Btn>` (read `apps/mobile/src/App.tsx`'s tab names first).
  - M2: `Library.tsx:159-161` — `isCondWorkout(w) || !w.blocks.length ? 'conditioning' : …` (import `isCondWorkout`; mirror web `Library.tsx:155-159`).
  - M7: mobile `History.tsx` Detail — append `b.condResult.felt ? ' · felt RPE ' + b.condResult.felt : ''` matching web `History.tsx` (~156-162, read both).
  - M6: `Progress.tsx:231` — `<SectionHead title="Top lifts · 8-week change" right={<Link onPress={() => nav.navigate('History')}>Full history ›</Link>} />` (mobile ui exports `Link`; Progress needs `useNavigation`).
  - I7: `Settings.tsx:71-76` — split: `saveFailed` → "The last save failed — usually a full disk. Export a backup below, then try again."; `!isPersistent` → keep the current build-wide wording. Two branches, `saveFailed` first.
  - I6: `Settings.tsx` sync status/error `T`s (~235-242) and WHOOP error `T` (~331) get `accessibilityLiveRegion="polite"` (status) / `"assertive"` (errors) — Android-only prop, safe everywhere.
  - M3: `planner/ExerciseCard.tsx:90-119` — the movement `Input` gets `accessibilityLabel="movement name"`, per-set inputs `"set target"` / `"RPE"` (match Logger's convention; check `Input`'s prop passthrough in `ui.tsx`).

- [ ] **Step 6: Verify** — `pnpm --filter @hybrid/mobile test && pnpm --filter @hybrid/mobile typecheck` → PASS.
- [ ] **Step 7: Commit** — `git commit -m "Mobile: parity batch — honest empty state, visible exits, logged list, rest at a glance"` (+trailers).

---

### Task 12: Hygiene, worthwhile polish, smoke coverage, full verification, push

**Files:**
- Modify: `apps/coach/src/ui.tsx`, `apps/coach/src/App.tsx`, `apps/coach/src/editor/MovementPicker.tsx`, `apps/web/src/screens/Exercise.tsx`, `apps/web/src/screens/Library.tsx`, `apps/web/src/screens/Progress.tsx`, `checks/react-smoke.mjs`

- [ ] **Step 1: Dead exports** — in `apps/coach/src/ui.tsx` delete `ADD`, `IconRight`, `IconLink`, `IconRest`, `IconCopy` (consistency 6.1-6.6). First run `grep -rn "ADD\|IconRight\|IconLink\|IconRest\|IconCopy" apps/coach/src --include='*.tsx' --include='*.ts'` and confirm the only hits are ui.tsx itself. `IconSend` STAYS (Task 5 uses it); `IconUp`/`IconDown`/`IconCheck` stay (used by App/MovementPicker); `model.ts`'s `fmtRest` stays (Task 9 gave it its caller).

- [ ] **Step 2: aria-current normalization (1.9/4.3)** — convert the raw-boolean sites to the token-or-undefined pattern used at `apps/coach/src/App.tsx:157`: App.tsx `:281` and `:400` (`aria-current={cond ? 'true' : undefined}` — pick `'date'`/`'page'`/`'true'` per what the control IS; read each) and `MovementPicker.tsx:75` (`aria-current={i === current ? 'true' : undefined}`). Line numbers may have drifted post-wave-1 — grep `aria-current` in apps/coach/src.

- [ ] **Step 3: Worthwhile polish**
  - Web P1: `apps/web/src/screens/Exercise.tsx` picker (~225-248) — when `movements.length === 0`, render `<Empty title="Nothing logged yet" body="Movements appear here as you train them." />` (same copy as Library's Exercises tab) instead of the search field + `Nothing matches ""` line.
  - Web P4: `apps/web/src/screens/Library.tsx:213` — `for {(w.dates || []).join(', ')}` → `for {(w.dates || []).map((d) => dayLabel(d) || d).join(', ')}` (import `dayLabel` from `@hybrid/engine`; History already uses it).
  - Web P2: `apps/web/src/screens/Progress.tsx` (~292) — the finding-title `truncate` → `line-clamp-2`.
  - Coach P4: `apps/coach/src/ui.tsx` `WELL` — replace `outline-none … focus:border-gold-line` with a real ring: `focus:outline-2 focus:outline-gold-line focus:outline-offset-0` (keep the border shift). First read how button focus outlines are produced (grep `outline` in tokens.css and ui.tsx) and reuse that exact treatment; acceptance = a focused WELL input shows a visible 2px outline in the browser.

- [ ] **Step 4: Smoke coverage for the wave** — extend `checks/react-smoke.mjs` (read the post-wave-1 file first; wave 1's Task 8 restructured it):
  - Web: seed a session whose first set target is `W10`; drive Finish Set; assert the RPE stage never appears and the stored set has no `felt` (read localStorage). Assert `Skip rest` casing while there.
  - Web: from Home with a seeded scheduled workout, click "Start today's session →", assert Training shows the in-progress header.
  - Web: assert Settings' WHOOP card text does NOT contain `Unexpected token` (functions host is unreachable under the smoke servers — the humanized sentence must show).
  - Coach: signed out, click Validate on the publish screen; assert the status node's class list contains the ok-tone class (`bg-gold-wash`) and the button reads `Validate`.
- [ ] **Step 5: Full verification** — `pnpm run test && pnpm run verify && node checks/contrast.mjs && node checks/web-touch.mjs && node checks/docs.mjs` → ALL PASS.
- [ ] **Step 6: Commit + push** — `git commit -m "Hygiene: dead exports gone, polish kept honest, smoke covers wave 2"` (+trailers); `git push -u origin main` (retry 2s/4s/8s/16s on network failure); confirm CI green for the pushed head via the GitHub MCP actions list.

---

## Self-review (done at drafting time)

- Spec §1→Task 1, §2→Task 2, §3→Task 3, §4→Task 4, §5→Task 5, §6-8→Tasks 6-8, §9→Task 9, §10→Task 10, §11→Task 11, §12→Task 12. No spec section unowned; no task outside the spec.
- Humanizer call sites: 11 coach + 8 web + 12 mobile = 31 enumerated with file:line, every one re-verified by grep against the working tree at drafting (audit said "8+"; the full sweep found these).
- Verified against source before writing call sites: `cloud.publish` returns `string|null`; `isCond`/`isText` are type predicates; `CON_FORMATS`/`CON_EFFORTS`/`rxLine`/`fmtRest`/`isWarmup`/`freshSessionBlocks` are top-level engine exports; mobile `Tap`/`Btn` props; `useRest` shape; golden vectors pin `rxLine`/`condEffortRpe`; `pointer: coarse` rule + `web-touch.mjs` already exist (the plan verifies-then-fixes instead of re-implementing).
- Wave-1 collisions are called out where they exist (Task 5 ReviewScreen, Task 6 PublishStep post-Task-5, Task 12 smoke) with re-read instructions rather than stale code.
- No placeholders: every code block is complete, or the step names the exact file/lines to read first and the exact acceptance check.
