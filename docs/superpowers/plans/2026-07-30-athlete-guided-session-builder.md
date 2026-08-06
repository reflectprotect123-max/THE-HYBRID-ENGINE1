# Athlete Guided Session Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "＋ New session" in both athlete apps with a guided, one-step-at-a-time flow for building a session — the same style the now-deleted coach builder used — instead of dropping straight into the dense Planner.

**Architecture:** One new shared, framework-free package (`packages/guided-flow`) holds the pure step-sequencing logic (what question comes next, when a step is satisfied enough to advance). Each app (`apps/web`, `apps/mobile`) gets its own small set of step components and an orchestrator screen built from that shared logic — no UI code is shared between the two apps, only `packages/guided-flow` and `packages/engine`. Each block, once its steps are answered, is appended to the session's `Workout` via each app's existing store (`update()`); after each block, an "add another?" screen shows a running summary and either loops back to block-type or opens the existing Planner.

**Tech Stack:** TypeScript throughout. `packages/guided-flow` is pure logic, tested with Vitest. `apps/web` is React + Vite + Tailwind + react-router-dom. `apps/mobile` is Expo + React Native + React Navigation.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-30-athlete-guided-session-builder-design.md` — read it once before starting; every task below implements a piece of it.
- Web touch targets stay at this app's existing ≥44×44px minimum (enforced by `checks/web-touch.mjs`); no change needed there, just don't regress it.
- Mobile touch targets target Android's stricter ≥48×48dp. This app's `Tap` primitive (`apps/mobile/src/ui.tsx`) already enforces this: pass its `box={{ h, w }}` prop with the control's real rendered size and `Tap` computes the correct `hitSlop` automatically against its own `MIN_TAP = 48` constant. Never pass `hitSlop` directly — `box` is the one lever.
- A reps/RPE chip's "selected" state must carry a signal beyond color. This plan uses a `✓ ` text prefix on the selected chip's label — matching this codebase's existing glyph-based UI language (Planner's own buttons already read `☀ Warm-up / Cooldown`, `♥ Conditioning`, `✎ Metcon / notes`) rather than introducing an icon library. Do **not** change the shared `Chip` component itself in either app's `ui` module — it is reused elsewhere and its look outside this feature is out of scope. The `✓` is added by the step component that renders the chip's children, nothing else.
- Do not modify `apps/web/src/screens/Planner.tsx`, `apps/mobile/src/screens/Planner.tsx`, or any `screens/planner/*` file. They keep every button and behavior they have today.
- No review/chain/split screen inside the guided flow. Superset-chaining, reordering, and adding further blocks after the first pass all remain Planner-only, exactly as the spec decided.
- No changes to coach-side plumbing (`Workout.origin`, `assignmentId`) — untouched.
- No iOS work. "Both platforms" means web and Android only.
- `packages/engine/test/golden.test.ts` (33 tests, pinned fixtures under `packages/engine/test/golden/`) must stay green with **zero fixtures edited**, start to finish. Nothing in this plan touches engine math — only calls to existing, already-tested engine constructors (`newBlock`, `newTextBlock`, `newCondBlock`, `newSet`).
- Frequent commits: one commit per task, after its own tests pass.

---

## Task 1: Shared package — pure step-sequencing logic

**Files:**
- Create: `packages/guided-flow/package.json`
- Create: `packages/guided-flow/tsconfig.json`
- Create: `packages/guided-flow/src/index.ts`
- Create: `packages/guided-flow/src/flowSteps.ts`
- Test: `packages/guided-flow/test/flowSteps.test.ts`

**Interfaces:**
- Produces (used by every later task): `FlowStep`, `BlockKind`, `FlowState`, `FlowDraft` types; `stepsFor(state: FlowState): FlowStep[]`; `nextStep(current: FlowStep, state: FlowState): FlowStep | null`; `prevStep(current: FlowStep, state: FlowState): FlowStep | null`; `canAdvance(step: FlowStep, draft: FlowDraft): boolean` — all exported from `@hybrid/guided-flow`.

- [ ] **Step 1: Scaffold the package**

`packages/guided-flow/package.json`:

```json
{
  "name": "@hybrid/guided-flow",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

`packages/guided-flow/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Run `pnpm install` from the repo root afterward so the new workspace package is linked (`pnpm-workspace.yaml` already globs `packages/*`, so no edit needed there).

- [ ] **Step 2: Write the failing tests**

`packages/guided-flow/test/flowSteps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canAdvance, nextStep, prevStep, stepsFor, type FlowDraft } from '../src/flowSteps';

const draft = (over: Partial<FlowDraft> = {}): FlowDraft => ({
  movementName: '', reps: '', rpe: '', condFmt: '', text: '', ...over,
});

describe('stepsFor', () => {
  it('a lift block walks movement through RPE', () => {
    expect(stepsFor({ blockKind: 'lift', isWarmupSet: false })).toEqual([
      'block-type', 'movement', 'sets', 'reps', 'rpe',
    ]);
  });

  it('a warm-up SET skips the RPE step entirely', () => {
    expect(stepsFor({ blockKind: 'lift', isWarmupSet: true })).toEqual([
      'block-type', 'movement', 'sets', 'reps',
    ]);
  });

  it('a conditioning block goes straight to its detail step', () => {
    expect(stepsFor({ blockKind: 'cond', isWarmupSet: false })).toEqual(['block-type', 'cond-detail']);
  });

  it('a warm-up/cooldown BLOCK and a metcon/notes block are both a single text step', () => {
    expect(stepsFor({ blockKind: 'warmup', isWarmupSet: false })).toEqual(['block-type', 'text']);
    expect(stepsFor({ blockKind: 'metcon', isWarmupSet: false })).toEqual(['block-type', 'text']);
  });
});

describe('nextStep / prevStep', () => {
  const lift = { blockKind: 'lift' as const, isWarmupSet: false };

  it('walks forward through the sequence', () => {
    expect(nextStep('block-type', lift)).toBe('movement');
    expect(nextStep('movement', lift)).toBe('sets');
    expect(nextStep('sets', lift)).toBe('reps');
    expect(nextStep('reps', lift)).toBe('rpe');
  });

  it('is null past the last step — the orchestrator commits the block here', () => {
    expect(nextStep('rpe', lift)).toBeNull();
  });

  it('walks backward, and is null before the first step', () => {
    expect(prevStep('sets', lift)).toBe('movement');
    expect(prevStep('block-type', lift)).toBeNull();
  });

  it('adapts mid-flow when isWarmupSet flips between reps and rpe', () => {
    // Sitting on 'reps' and the athlete ticks "this is a warm-up" before
    // advancing: RPE should no longer be next.
    const warm = { blockKind: 'lift' as const, isWarmupSet: true };
    expect(nextStep('reps', warm)).toBeNull();
  });
});

describe('canAdvance — what each step requires before moving on', () => {
  it('movement requires a picked movement', () => {
    expect(canAdvance('movement', draft())).toBe(false);
    expect(canAdvance('movement', draft({ movementName: 'Back Squat' }))).toBe(true);
  });

  it('reps requires a target', () => {
    expect(canAdvance('reps', draft())).toBe(false);
    expect(canAdvance('reps', draft({ reps: '8' }))).toBe(true);
  });

  it('rpe requires a value', () => {
    expect(canAdvance('rpe', draft())).toBe(false);
    expect(canAdvance('rpe', draft({ rpe: '8' }))).toBe(true);
  });

  it('cond-detail requires a picked format', () => {
    expect(canAdvance('cond-detail', draft())).toBe(false);
    expect(canAdvance('cond-detail', draft({ condFmt: 'steady' }))).toBe(true);
  });

  it('text requires actual content — an empty warm-up/metcon note is not worth a block', () => {
    expect(canAdvance('text', draft())).toBe(false);
    expect(canAdvance('text', draft({ text: '10 min bike' }))).toBe(true);
  });

  it('sets and block-type never block', () => {
    expect(canAdvance('sets', draft())).toBe(true);
    expect(canAdvance('block-type', draft())).toBe(true);
  });

  it('whitespace-only input does not count', () => {
    expect(canAdvance('movement', draft({ movementName: '   ' }))).toBe(false);
    expect(canAdvance('reps', draft({ reps: ' ' }))).toBe(false);
    expect(canAdvance('text', draft({ text: '  \n ' }))).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/guided-flow test`
Expected: FAIL — `Cannot find module '../src/flowSteps'` (the file does not exist yet).

- [ ] **Step 4: Write the implementation**

`packages/guided-flow/src/flowSteps.ts`:

```ts
export type FlowStep = 'block-type' | 'movement' | 'sets' | 'reps' | 'rpe' | 'cond-detail' | 'text';

export type BlockKind = 'lift' | 'warmup' | 'cond' | 'metcon' | null;

export interface FlowState {
  blockKind: BlockKind;
  /** Whether the SET currently being authored is marked as a warm-up. */
  isWarmupSet: boolean;
}

/** Every field any step's `canAdvance` check might need to read. */
export interface FlowDraft {
  movementName: string;
  reps: string;
  rpe: string;
  condFmt: string;
  text: string;
}

const LIFT_SEQUENCE: FlowStep[] = ['block-type', 'movement', 'sets', 'reps', 'rpe'];
const COND_SEQUENCE: FlowStep[] = ['block-type', 'cond-detail'];
const TEXT_SEQUENCE: FlowStep[] = ['block-type', 'text'];

/**
 * The ordered steps for the current state. A conditioning block authors its
 * format/effort/minutes on the 'cond-detail' step. A Warm-up/Cooldown BLOCK
 * and a Metcon/notes block are both a single open text box — see the spec's
 * "two separate warm-up concepts" note: this is the whole-BLOCK choice,
 * distinct from flagging one SET as a warm-up inside an ordinary lift block.
 * A warm-up SET skips 'rpe', since nothing in a warm-up counts toward
 * autoregulation (packages/engine/src/autoreg.ts).
 */
export function stepsFor(state: FlowState): FlowStep[] {
  if (state.blockKind === 'cond') return COND_SEQUENCE;
  if (state.blockKind === 'warmup' || state.blockKind === 'metcon') return TEXT_SEQUENCE;
  return state.isWarmupSet ? LIFT_SEQUENCE.filter((s) => s !== 'rpe') : LIFT_SEQUENCE;
}

export function nextStep(current: FlowStep, state: FlowState): FlowStep | null {
  const seq = stepsFor(state);
  const i = seq.indexOf(current);
  return i >= 0 && i < seq.length - 1 ? seq[i + 1] : null;
}

export function prevStep(current: FlowStep, state: FlowState): FlowStep | null {
  const seq = stepsFor(state);
  const i = seq.indexOf(current);
  return i > 0 ? seq[i - 1] : null;
}

/**
 * What each step requires before the flow may advance past it. The gate lives
 * here — pure and tested — rather than scattered across the step components,
 * so the button that actually advances and the one that merely looks primary
 * can never disagree about whether advancing is allowed.
 */
export function canAdvance(step: FlowStep, draft: FlowDraft): boolean {
  if (step === 'movement') return draft.movementName.trim().length > 0;
  if (step === 'reps') return draft.reps.trim().length > 0;
  if (step === 'rpe') return draft.rpe.trim().length > 0;
  if (step === 'cond-detail') return draft.condFmt.trim().length > 0;
  if (step === 'text') return draft.text.trim().length > 0;
  return true;
}
```

`packages/guided-flow/src/index.ts`:

```ts
export * from './flowSteps';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/guided-flow test`
Expected: PASS — all tests green.

Run also: `pnpm --filter @hybrid/guided-flow typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/guided-flow
git commit -m "guided-flow: pure step-sequencing logic for the athlete builder"
```

---

## Task 2: Web — block-type and movement steps

**Files:**
- Create: `apps/web/src/screens/guided/BlockTypeStep.tsx`
- Create: `apps/web/src/screens/guided/MovementStep.tsx`

**Interfaces:**
- Consumes: `BlockKind` from `@hybrid/guided-flow`; `knownMovements` from `@hybrid/engine`; `Button`, `Field`, `Kicker` from `../../ui`.
- Produces: `BlockTypeStep({ onPick }: { onPick: (kind: BlockKind) => void })`; `MovementStep({ value, known, onChange, onNext, onBack, disabled }: { value: string; known: string[]; onChange: (v: string) => void; onNext: () => void; onBack: () => void; disabled: boolean })`. Both consumed by Task 5's orchestrator.

- [ ] **Step 1: Write `BlockTypeStep.tsx`**

```tsx
import type { BlockKind } from '@hybrid/guided-flow';
import { Button } from '../../ui';

const CHOICES: { kind: Exclude<BlockKind, null>; label: string; glyph: string }[] = [
  { kind: 'lift', label: 'Lift', glyph: '🏋' },
  { kind: 'warmup', label: 'Warm-up / Cooldown', glyph: '☀' },
  { kind: 'cond', label: 'Conditioning', glyph: '♥' },
  { kind: 'metcon', label: 'Metcon / notes', glyph: '✎' },
];

export function BlockTypeStep({ onPick }: { onPick: (kind: Exclude<BlockKind, null>) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What are we doing?</h1>
      <div className="grid grid-cols-2 gap-1.5">
        {CHOICES.map((c) => (
          <Button
            key={c.kind}
            variant="brass"
            size="lg"
            className="flex-col gap-0.5 !h-9 !w-[9.5rem]"
            onClick={() => onPick(c.kind)}
          >
            <span aria-hidden className="text-8">{c.glyph}</span>
            <span>{c.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `MovementStep.tsx`**

Reuses the existing datalist pattern from `apps/web/src/screens/Planner.tsx` (`knownMovements` feeding a native `<datalist>`), rather than building a new search UI:

```tsx
import { Button, Field, Kicker } from '../../ui';

const MOVEMENT_LIST_ID = 'guided-movement-list';

export function MovementStep({
  value,
  known,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  known: string[];
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">Which movement?</h1>
      <Kicker>Type a name, or pick one you've done before</Kicker>
      <Field
        value={value}
        list={MOVEMENT_LIST_ID}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Movement"
        aria-label="movement name"
        className="max-w-[18rem]"
      />
      <datalist id={MOVEMENT_LIST_ID}>
        {known.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: no errors. (No unit test for these two — they're thin presentational components; their behavior is covered by Task 6's end-to-end check, matching how the coach builder's step components were verified.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/screens/guided/BlockTypeStep.tsx apps/web/src/screens/guided/MovementStep.tsx
git commit -m "web: guided builder — block-type and movement steps"
```

---

## Task 3: Web — sets, reps, RPE steps

**Files:**
- Create: `apps/web/src/screens/guided/SetsStep.tsx`
- Create: `apps/web/src/screens/guided/RepsStep.tsx`
- Create: `apps/web/src/screens/guided/RpeStep.tsx`

**Interfaces:**
- Consumes: `Button`, `Chip` from `../../ui`.
- Produces: `SetsStep({ value, onChange, onNext, onBack }: { value: number; onChange: (n: number) => void; onNext: () => void; onBack: () => void })`; `RepsStep({ value, isWarmupSet, onChange, onWarmupSetChange, onNext, onBack, disabled }: {...})`; `RpeStep({ value, onChange, onNext, onBack, disabled }: {...})`. All consumed by Task 5.

- [ ] **Step 1: Write `SetsStep.tsx`**

```tsx
import { Button } from '../../ui';

export function SetsStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: number;
  onChange: (n: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many sets?</h1>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(Math.max(1, value - 1))}
          aria-label="fewer sets"
          className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8"
        >
          −
        </button>
        <span className="num w-12 text-center text-9 font-[900]">{value}</span>
        <button
          onClick={() => onChange(Math.min(20, value + 1))}
          aria-label="more sets"
          className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8"
        >
          +
        </button>
      </div>
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `RepsStep.tsx`**

The `✓ ` prefix on a selected chip is the non-color selection signal (Global Constraints) — added here, not in the shared `Chip` component.

```tsx
import { useState } from 'react';
import { Button, Chip } from '../../ui';

const PRESETS = ['5', '8', '10', '12', 'max'];

export function RepsStep({
  value,
  isWarmupSet,
  onChange,
  onWarmupSetChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  isWarmupSet: boolean;
  onChange: (v: string) => void;
  onWarmupSetChange: (v: boolean) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  const [custom, setCustom] = useState('');
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many reps?</h1>
      <label className="flex items-center gap-1 text-4">
        <input
          type="checkbox"
          checked={isWarmupSet}
          onChange={(e) => onWarmupSetChange(e.target.checked)}
        />
        This is a warm-up
      </label>
      <div className="flex flex-wrap justify-center gap-1">
        {PRESETS.map((r) => (
          <Chip key={r} on={value === r} onClick={() => { onChange(r); setCustom(''); }}>
            {value === r ? '✓ ' : ''}{r}
          </Chip>
        ))}
      </div>
      <input
        value={custom}
        onChange={(e) => { setCustom(e.target.value); onChange(e.target.value); }}
        placeholder="or type a custom target, e.g. 8-12"
        aria-label="custom reps target"
        className="h-5 w-[16rem] rounded-md border border-line bg-well px-1.5 text-center text-4 outline-none focus:border-gold-line"
      />
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `RpeStep.tsx`**

```tsx
import { Button, Chip } from '../../ui';

const RPE_VALUES = ['6', '7', '8', '9', '10'];

export function RpeStep({
  value,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How hard should it feel?</h1>
      <div className="flex flex-wrap justify-center gap-1">
        {RPE_VALUES.map((r) => (
          <Chip key={r} on={value === r} onClick={() => onChange(r)}>
            {value === r ? '✓ ' : ''}RPE {r}
          </Chip>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/guided/SetsStep.tsx apps/web/src/screens/guided/RepsStep.tsx apps/web/src/screens/guided/RpeStep.tsx
git commit -m "web: guided builder — sets, reps, RPE steps"
```

---

## Task 4: Web — conditioning detail and text steps

**Files:**
- Create: `apps/web/src/screens/guided/CondDetailStep.tsx`
- Create: `apps/web/src/screens/guided/TextStep.tsx`

**Interfaces:**
- Consumes: `CON_FORMATS`, `CON_FORMAT_KEYS`, `CON_EFFORTS`, `CON_EFFORT_KEYS`, `type CondFmtKey`, `type EffortKey` from `@hybrid/engine`; `Button`, `Chip` from `../../ui`.
- Produces: `CondDetailStep({ condFmt, effort, minutes, onChange, onNext, onBack, disabled }: {...})`; `TextStep({ question, value, onChange, onNext, onBack, disabled }: {...})` — `TextStep` is shared by both Warm-up/Cooldown and Metcon/notes, parameterized by the `question` copy (e.g. "What's the warm-up?" vs. "What's the workout?").

- [ ] **Step 1: Write `CondDetailStep.tsx`**

Ported from the coach builder's `CondDetailStep.tsx`, with the same `aria-pressed` + brass/ghost pattern and the `✓` non-color signal added to the selected chip:

```tsx
import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, CON_FORMAT_KEYS, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { Button, Chip } from '../../ui';

export function CondDetailStep({
  condFmt,
  effort,
  minutes,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  condFmt: CondFmtKey | '';
  effort: EffortKey;
  minutes: number;
  onChange: (patch: { condFmt?: CondFmtKey; effort?: EffortKey; minutes?: number }) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What kind of conditioning?</h1>
      <div className="flex flex-wrap justify-center gap-1">
        {CON_FORMAT_KEYS.map((k) => (
          <Chip key={k} on={condFmt === k} onClick={() => onChange({ condFmt: k })}>
            {condFmt === k ? '✓ ' : ''}{CON_FORMATS[k].name}
          </Chip>
        ))}
      </div>
      <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Effort</span>
      <div className="flex flex-wrap justify-center gap-1">
        {CON_EFFORT_KEYS.map((k) => (
          <Chip key={k} on={effort === k} onClick={() => onChange({ effort: k })}>
            {effort === k ? '✓ ' : ''}{CON_EFFORTS[k].name}
          </Chip>
        ))}
      </div>
      <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Minutes (optional)</span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange({ minutes: Math.max(0, minutes - 5) })}
          aria-label="fewer minutes"
          className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8"
        >
          −
        </button>
        <span className="num w-12 text-center text-9 font-[900]">{minutes || '—'}</span>
        <button
          onClick={() => onChange({ minutes: Math.min(120, (minutes || 0) + 5) })}
          aria-label="more minutes"
          className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8"
        >
          +
        </button>
      </div>
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `TextStep.tsx`**

```tsx
import { Button } from '../../ui';

export function TextStep({
  question,
  value,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  /** e.g. "What's the warm-up?" or "What's the workout?" */
  question: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">{question}</h1>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        aria-label={question}
        className="w-full max-w-[24rem] resize-y rounded-md border border-line bg-well p-1.5 text-4 outline-none focus:border-gold-line"
      />
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Done
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/screens/guided/CondDetailStep.tsx apps/web/src/screens/guided/TextStep.tsx
git commit -m "web: guided builder — conditioning detail and text steps"
```

---

## Task 5: Web — orchestrator, route, and Library wiring

**Files:**
- Create: `apps/web/src/screens/guided/GuidedBuilder.tsx`
- Modify: `apps/web/src/App.tsx` (add the route)
- Modify: `apps/web/src/screens/Library.tsx:76-82` (the `addWorkout` function)

**Interfaces:**
- Consumes: everything from Task 2–4 (`BlockTypeStep`, `MovementStep`, `SetsStep`, `RepsStep`, `RpeStep`, `CondDetailStep`, `TextStep`); `stepsFor`, `nextStep`, `prevStep`, `canAdvance`, `type FlowStep`, `type BlockKind`, `type FlowDraft` from `@hybrid/guided-flow`; `newBlock`, `newTextBlock`, `newCondBlock`, `CON_EFFORTS`, `knownMovements`, `type Workout` from `@hybrid/engine`; `useDb` from `../store/db`.
- Produces: `GuidedBuilder()` — the screen mounted at route `/build/:id`.

- [ ] **Step 1: Write `GuidedBuilder.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  canAdvance,
  nextStep,
  prevStep,
  stepsFor,
  type BlockKind,
  type FlowDraft,
  type FlowStep,
} from '@hybrid/guided-flow';
import { CON_EFFORTS, knownMovements, newBlock, newCondBlock, newTextBlock, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { Button, Kicker } from '../../ui';
import { BlockTypeStep } from './BlockTypeStep';
import { MovementStep } from './MovementStep';
import { SetsStep } from './SetsStep';
import { RepsStep } from './RepsStep';
import { RpeStep } from './RpeStep';
import { CondDetailStep } from './CondDetailStep';
import { TextStep } from './TextStep';

interface Draft extends FlowDraft {
  blockKind: Exclude<BlockKind, null> | null;
  isWarmupSet: boolean;
  sets: number;
  effort: EffortKey;
  minutes: number;
}

const EMPTY_DRAFT: Draft = {
  blockKind: null,
  isWarmupSet: false,
  movementName: '',
  sets: 3,
  reps: '',
  rpe: '',
  condFmt: '',
  effort: 'medium',
  minutes: 0,
  text: '',
};

const BLOCK_LABEL: Record<Exclude<BlockKind, null>, string> = {
  lift: 'Lift',
  warmup: 'Warm-up / Cooldown',
  cond: 'Conditioning',
  metcon: 'Metcon / notes',
};

/**
 * The guided, one-step-at-a-time session builder. Replaces the old
 * "blank session straight into the Planner" entry point (see Library.tsx's
 * `addWorkout`) with a flow that authors one block at a time, then hands off
 * to the existing Planner for anything beyond a session's first pass —
 * there is no review/chain/split screen here (docs/superpowers/specs/
 * 2026-07-30-athlete-guided-session-builder-design.md).
 */
export function GuidedBuilder() {
  const { id } = useParams<{ id: string }>();
  const { db, update } = useDb();
  const nav = useNavigate();
  const known = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);

  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [added, setAdded] = useState<string[]>([]);
  const [phase, setPhase] = useState<'flow' | 'add-another'>('flow');

  if (!id) return null;
  const state = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmupSet };

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commitBlock() {
    const kind = draft.blockKind;
    if (!kind) return;
    let label = '';
    update((d) => {
      const w = d.workouts.find((x) => x.id === id);
      if (!w) return false;
      if (kind === 'lift') {
        const block = newBlock();
        const t = draft.isWarmupSet ? 'W' + draft.reps : draft.reps;
        const rpe = draft.isWarmupSet ? '' : draft.rpe;
        block.exercises[0].name = draft.movementName;
        block.exercises[0].sets = Array.from({ length: draft.sets }, () => ({ t, rpe }));
        w.blocks.push(block);
        label = draft.movementName;
      } else if (kind === 'cond') {
        // @hybrid/engine's flat-exported `newCondBlock` (from session.ts) is
        // zero-argument — the 4-arg version only exists as `emit.newCondBlock`,
        // reachable through the namespaced `emit` export, not this flat import.
        // Build with the zero-arg constructor, then set the fields by hand;
        // CON_EFFORTS[effort].zone reproduces the same zone derivation
        // emit.newCondBlock does internally (confirmed identical mapping:
        // easy→low, medium→mod, hard→high, in both CON_EFFORTS and emit's
        // own EFFORTS table).
        const block = newCondBlock();
        block.condFmt = (draft.condFmt || 'intervals') as CondFmtKey;
        block.effort = draft.effort;
        block.targetZone = CON_EFFORTS[draft.effort].zone;
        block.minutes = draft.minutes || '';
        w.blocks.push(block);
        label = 'Conditioning';
      } else {
        const block = newTextBlock();
        block.heading = BLOCK_LABEL[kind];
        block.body = draft.text;
        w.blocks.push(block);
        label = BLOCK_LABEL[kind];
      }
      w.updatedAt = Date.now();
    });
    setAdded((a) => [...a, label]);
    setPhase('add-another');
  }

  function goNext() {
    const next = nextStep(step, state);
    if (next) {
      setStep(next);
      return;
    }
    commitBlock();
  }

  function goBack() {
    const prev = prevStep(step, state);
    if (prev) {
      setStep(prev);
      return;
    }
    // No earlier step than block-type: back here means abandoning the flow.
    nav('/library');
  }

  function pick(kind: Exclude<BlockKind, null>) {
    patch({ blockKind: kind });
    setStep(nextStep('block-type', { blockKind: kind, isWarmupSet: false }) ?? 'block-type');
  }

  if (phase === 'add-another') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
        <Kicker>{added.join(', ')} added</Kicker>
        <h1 className="text-8 font-[800]">Add another block?</h1>
        <div className="mt-1 flex gap-1">
          <Button
            variant="brass"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setStep('block-type');
              setPhase('flow');
            }}
          >
            Yes, add another
          </Button>
          <Button onClick={() => nav(`/planner/${id}`)}>No, I'm done</Button>
        </div>
      </div>
    );
  }

  if (step === 'block-type') return <BlockTypeStep onPick={pick} />;

  if (step === 'movement') {
    return (
      <MovementStep
        value={draft.movementName}
        known={known}
        onChange={(v) => patch({ movementName: v })}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('movement', draft)}
      />
    );
  }

  if (step === 'sets') {
    return <SetsStep value={draft.sets} onChange={(n) => patch({ sets: n })} onNext={goNext} onBack={goBack} />;
  }

  if (step === 'reps') {
    return (
      <RepsStep
        value={draft.reps}
        isWarmupSet={draft.isWarmupSet}
        onChange={(v) => patch({ reps: v })}
        onWarmupSetChange={(v) => patch({ isWarmupSet: v })}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('reps', draft)}
      />
    );
  }

  if (step === 'rpe') {
    return (
      <RpeStep
        value={draft.rpe}
        onChange={(v) => patch({ rpe: v })}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('rpe', draft)}
      />
    );
  }

  if (step === 'cond-detail') {
    return (
      <CondDetailStep
        condFmt={draft.condFmt as CondFmtKey | ''}
        effort={draft.effort}
        minutes={draft.minutes}
        onChange={(p) => patch(p)}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('cond-detail', draft)}
      />
    );
  }

  // step === 'text'
  const question = draft.blockKind === 'warmup' ? "What's the warm-up?" : "What's the workout?";
  return (
    <TextStep
      question={question}
      value={draft.text}
      onChange={(v) => patch({ text: v })}
      onNext={goNext}
      onBack={goBack}
      disabled={!canAdvance('text', draft)}
    />
  );
}
```

- [ ] **Step 2: Wire the route in `App.tsx`**

In `apps/web/src/App.tsx`, add the import and the route alongside `/log/:bi/:ei` and `/planner/:id` — outside the `<Route element={<Shell />}>` wrapper, so it renders full-screen with no bottom nav, the same way Logger and Planner do:

```tsx
import { GuidedBuilder } from './screens/guided/GuidedBuilder';
```

```tsx
<Route path="/log/:bi/:ei" element={<Logger />} />
<Route path="/planner/:id" element={<Planner />} />
<Route path="/build/:id" element={<GuidedBuilder />} />
```

- [ ] **Step 3: Change `Library.tsx`'s `addWorkout`**

Currently (`apps/web/src/screens/Library.tsx:76-82`):

```tsx
function addWorkout() {
  const w: Workout = { id: uid(), name: 'New session', blocks: [newBlock()], updatedAt: Date.now() };
  update((draft) => {
    draft.workouts.push(w);
  });
  nav(`/planner/${w.id}`);
}
```

Change to create an empty-blocks workout (the guided flow adds real blocks itself) and navigate to the new route:

```tsx
function addWorkout() {
  const w: Workout = { id: uid(), name: 'New session', blocks: [], updatedAt: Date.now() };
  update((draft) => {
    draft.workouts.push(w);
  });
  nav(`/build/${w.id}`);
}
```

`newBlock` may become an unused import in this file if nothing else in `Library.tsx` uses it — check with a search before removing the import; if it's now unused, remove it (the typecheck step below will catch this either way with a "declared but never used" error under this repo's strict TS config).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/guided/GuidedBuilder.tsx apps/web/src/App.tsx apps/web/src/screens/Library.tsx
git commit -m "web: wire the guided builder in as the '+ New session' entry point"
```

---

## Task 6: Web — end-to-end check

**Files:**
- Modify: `checks/react-smoke.mjs`

**Interfaces:**
- Consumes: the running built app at the existing dual-nothing (single-app-now) server this file already sets up (see Task's context: coach's server-serving code was removed in the "Remove the coach builder app" commit — this file now serves only `apps/web/dist`).

- [ ] **Step 1: Add the scenario**

Find the existing test `"the Library creates a session and opens it in the plan editor"` in `checks/react-smoke.mjs`. Immediately after it, add:

```js
await t('the guided builder replaces "New session" and can build a full session', async () => {
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('button:has-text("＋ New session")');
  await page.waitForSelector('text=What are we doing?');

  // Lift block.
  await page.click('button:has-text("Lift")');
  await page.waitForSelector('text=Which movement?');
  await page.fill('input[aria-label="movement name"]', 'Back Squat');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many sets?');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many reps?');
  await page.click('button:has-text("8")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How hard should it feel?');
  await page.click('button:has-text("RPE 8")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=Add another block?');
  const afterFirst = await page.textContent('body');
  assert(/Back Squat added/.test(afterFirst), 'the running summary should name the block just added');

  // Warm-up/Cooldown block, as a single open text box.
  await page.click('button:has-text("Yes, add another")');
  await page.waitForSelector('text=What are we doing?');
  await page.click('button:has-text("Warm-up / Cooldown")');
  await page.waitForSelector("text=What's the warm-up?");
  await page.fill('textarea', '10 min bike, band work');
  await page.click('button:has-text("Done")');
  await page.waitForSelector('text=Add another block?');
  const afterSecond = await page.textContent('body');
  assert(/Warm-up \/ Cooldown added/.test(afterSecond), 'the warm-up block should show in the running summary');

  // Finish — lands in the existing Planner with both blocks present.
  await page.click('button:has-text("No, I\'m done")');
  await page.waitForSelector('text=Back Squat');
  const plannerText = await page.textContent('body');
  assert(/Back Squat/.test(plannerText), 'the lift block should carry into the Planner');
  assert(/10 min bike, band work/.test(plannerText), 'the warm-up note should carry into the Planner');
});
```

- [ ] **Step 2: Build and run it**

Run: `pnpm run build && node checks/react-smoke.mjs`
Expected: the new test passes alongside the existing ones (`All React smoke checks passed.`).

- [ ] **Step 3: Commit**

```bash
git add checks/react-smoke.mjs
git commit -m "web: end-to-end check for the guided builder"
```

---

## Task 7: Mobile — block-type and movement steps

**Files:**
- Create: `apps/mobile/src/screens/guided/BlockTypeStep.tsx`
- Create: `apps/mobile/src/screens/guided/MovementStep.tsx`

**Interfaces:**
- Consumes: `BlockKind` from `@hybrid/guided-flow`; `Btn`, `Card`, `Chip`, `Input`, `T`, `Tap`, `Title` from `../../ui`.
- Produces: `BlockTypeStep({ onPick }: { onPick: (kind: Exclude<BlockKind, null>) => void })`; `MovementStep({ value, known, onChange, onNext, onBack, disabled }: {...})`.

- [ ] **Step 1: Write `BlockTypeStep.tsx`**

```tsx
import { View } from 'react-native';
import type { BlockKind } from '@hybrid/guided-flow';
import { Btn, T, Title } from '../../ui';

const CHOICES: { kind: Exclude<BlockKind, null>; label: string; glyph: string }[] = [
  { kind: 'lift', label: 'Lift', glyph: '🏋' },
  { kind: 'warmup', label: 'Warm-up / Cooldown', glyph: '☀' },
  { kind: 'cond', label: 'Conditioning', glyph: '♥' },
  { kind: 'metcon', label: 'Metcon / notes', glyph: '✎' },
];

export function BlockTypeStep({ onPick }: { onPick: (kind: Exclude<BlockKind, null>) => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>What are we doing?</Title>
      <View className="flex-row flex-wrap justify-center gap-2">
        {CHOICES.map((c) => (
          <Btn key={c.kind} variant="brass" size="lg" onPress={() => onPick(c.kind)} label={c.label}>
            {c.glyph + ' ' + c.label}
          </Btn>
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Write `MovementStep.tsx`**

Reuses the existing `Suggest` chip pattern already built for `apps/mobile/src/screens/planner/ExerciseCard.tsx` (type into `Input`, tap a suggested chip to autofill), rather than a new search UI:

```tsx
import { View } from 'react-native';
import { Btn, Chip, Input, T, Title } from '../../ui';

const MAX_SUGGEST = 6;

function Suggest({ typed, known, onPick }: { typed: string; known: string[]; onPick: (name: string) => void }) {
  const q = String(typed || '').trim().toLowerCase();
  const hits = known.filter((n) => n.toLowerCase() !== q && (!q || n.toLowerCase().includes(q))).slice(0, MAX_SUGGEST);
  if (!hits.length) return null;
  return (
    <View className="mt-1 flex-row flex-wrap justify-center gap-1">
      {hits.map((n) => (
        <Chip key={n} onPress={() => onPick(n)}>
          {n}
        </Chip>
      ))}
    </View>
  );
}

export function MovementStep({
  value,
  known,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  known: string[];
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>Which movement?</Title>
      <T className="text-3 text-muted">Type a name, or pick one you've done before</T>
      <Input value={value} onChangeText={onChange} placeholder="Movement" accessibilityLabel="movement name" />
      <Suggest typed={value} known={known} onPick={onChange} />
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Next
        </Btn>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/guided/BlockTypeStep.tsx apps/mobile/src/screens/guided/MovementStep.tsx
git commit -m "mobile: guided builder — block-type and movement steps"
```

---

## Task 8: Mobile — sets, reps, RPE steps

**Files:**
- Create: `apps/mobile/src/screens/guided/SetsStep.tsx`
- Create: `apps/mobile/src/screens/guided/RepsStep.tsx`
- Create: `apps/mobile/src/screens/guided/RpeStep.tsx`

**Interfaces:**
- Consumes: `Btn`, `Chip`, `Input`, `T`, `Tap`, `Title` from `../../ui`.
- Produces: `SetsStep`, `RepsStep`, `RpeStep` — same prop shapes as their web counterparts in Task 3, adapted to React Native.

- [ ] **Step 1: Write `SetsStep.tsx`**

This app's spacing scale is 8px per unit (`apps/mobile/tailwind.config.js`: `{ ..., 5: 40, 6: 48, 8: 64, 10: 80, ... }`), not Tailwind's stock 4px scale — so a 40dp circle is `h-5 w-5`, not `h-10 w-10`. These −/+ circles render at 40dp, under the 48dp minimum — `Tap`'s `box={{ h: 40, w: 40 }}` tells it the real rendered size, and it pads the hit area to 48dp on its own (see Global Constraints; don't pass `hitSlop` directly).

```tsx
import { View } from 'react-native';
import { Btn, T, Tap, Title } from '../../ui';

export function SetsStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: number;
  onChange: (n: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>How many sets?</Title>
      <View className="flex-row items-center gap-4">
        <Tap
          onPress={() => onChange(Math.max(1, value - 1))}
          label="fewer sets"
          box={{ h: 40, w: 40 }}
          className="h-5 w-5 items-center justify-center rounded-full border border-line2"
        >
          <T className="text-8">−</T>
        </Tap>
        <T num w="black" className="w-12 text-center text-9">{String(value)}</T>
        <Tap
          onPress={() => onChange(Math.min(20, value + 1))}
          label="more sets"
          box={{ h: 40, w: 40 }}
          className="h-5 w-5 items-center justify-center rounded-full border border-line2"
        >
          <T className="text-8">+</T>
        </Tap>
      </View>
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext}>Next</Btn>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Write `RepsStep.tsx`**

```tsx
import { useState } from 'react';
import { View } from 'react-native';
import { Btn, Chip, Input, T, Tap, Title } from '../../ui';

const PRESETS = ['5', '8', '10', '12', 'max'];

export function RepsStep({
  value,
  isWarmupSet,
  onChange,
  onWarmupSetChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  isWarmupSet: boolean;
  onChange: (v: string) => void;
  onWarmupSetChange: (v: boolean) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  const [custom, setCustom] = useState('');
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>How many reps?</Title>
      <Tap
        onPress={() => onWarmupSetChange(!isWarmupSet)}
        label="this is a warm-up"
        selected={isWarmupSet}
        box={{ h: 40 }}
        className="flex-row items-center gap-1.5"
      >
        <View
          className={`h-5 w-5 items-center justify-center rounded border ${
            isWarmupSet ? 'border-gold-line bg-gold-wash' : 'border-line2'
          }`}
        >
          {isWarmupSet ? <T className="text-3">✓</T> : null}
        </View>
        <T className="text-4">This is a warm-up</T>
      </Tap>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {PRESETS.map((r) => (
          <Chip key={r} on={value === r} onPress={() => { onChange(r); setCustom(''); }}>
            {(value === r ? '✓ ' : '') + r}
          </Chip>
        ))}
      </View>
      <Input
        value={custom}
        onChangeText={(v) => { setCustom(v); onChange(v); }}
        placeholder="or type a custom target, e.g. 8-12"
        accessibilityLabel="custom reps target"
      />
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Next
        </Btn>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Write `RpeStep.tsx`**

```tsx
import { View } from 'react-native';
import { Btn, Chip, Title } from '../../ui';

const RPE_VALUES = ['6', '7', '8', '9', '10'];

export function RpeStep({
  value,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>How hard should it feel?</Title>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {RPE_VALUES.map((r) => (
          <Chip key={r} on={value === r} onPress={() => onChange(r)}>
            {(value === r ? '✓ ' : '') + 'RPE ' + r}
          </Chip>
        ))}
      </View>
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Next
        </Btn>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors — `Tap` already accepts `box: { h?: number; w?: number }` (`apps/mobile/src/ui.tsx`), so no prop-type changes are needed here.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/guided/SetsStep.tsx apps/mobile/src/screens/guided/RepsStep.tsx apps/mobile/src/screens/guided/RpeStep.tsx
git commit -m "mobile: guided builder — sets, reps, RPE steps"
```

---

## Task 9: Mobile — conditioning detail and text steps

**Files:**
- Create: `apps/mobile/src/screens/guided/CondDetailStep.tsx`
- Create: `apps/mobile/src/screens/guided/TextStep.tsx`

**Interfaces:**
- Consumes: `CON_FORMATS`, `CON_FORMAT_KEYS`, `CON_EFFORTS`, `CON_EFFORT_KEYS`, `type CondFmtKey`, `type EffortKey` from `@hybrid/engine`; `Btn`, `Chip`, `Input`, `T`, `Tap`, `Title` from `../../ui`.
- Produces: `CondDetailStep`, `TextStep` — same prop shapes as their web counterparts in Task 4.

- [ ] **Step 1: Write `CondDetailStep.tsx`**

```tsx
import { View } from 'react-native';
import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, CON_FORMAT_KEYS, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { Btn, Chip, T, Tap, Title } from '../../ui';

export function CondDetailStep({
  condFmt,
  effort,
  minutes,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  condFmt: CondFmtKey | '';
  effort: EffortKey;
  minutes: number;
  onChange: (patch: { condFmt?: CondFmtKey; effort?: EffortKey; minutes?: number }) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>What kind of conditioning?</Title>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {CON_FORMAT_KEYS.map((k) => (
          <Chip key={k} on={condFmt === k} onPress={() => onChange({ condFmt: k })}>
            {(condFmt === k ? '✓ ' : '') + CON_FORMATS[k].name}
          </Chip>
        ))}
      </View>
      <T className="text-2 uppercase text-dim">Effort</T>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {CON_EFFORT_KEYS.map((k) => (
          <Chip key={k} on={effort === k} onPress={() => onChange({ effort: k })}>
            {(effort === k ? '✓ ' : '') + CON_EFFORTS[k].name}
          </Chip>
        ))}
      </View>
      <T className="text-2 uppercase text-dim">Minutes (optional)</T>
      <View className="flex-row items-center gap-4">
        <Tap
          onPress={() => onChange({ minutes: Math.max(0, minutes - 5) })}
          label="fewer minutes"
          box={{ h: 40, w: 40 }}
          className="h-5 w-5 items-center justify-center rounded-full border border-line2"
        >
          <T className="text-8">−</T>
        </Tap>
        <T num w="black" className="w-12 text-center text-9">{minutes || '—'}</T>
        <Tap
          onPress={() => onChange({ minutes: Math.min(120, (minutes || 0) + 5) })}
          label="more minutes"
          box={{ h: 40, w: 40 }}
          className="h-5 w-5 items-center justify-center rounded-full border border-line2"
        >
          <T className="text-8">+</T>
        </Tap>
      </View>
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Next
        </Btn>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Write `TextStep.tsx`**

```tsx
import { View } from 'react-native';
import { Btn, Input, Title } from '../../ui';

export function TextStep({
  question,
  value,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  question: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>{question}</Title>
      <Input
        value={value}
        onChangeText={onChange}
        placeholder="Type here"
        accessibilityLabel={question}
        multiline
        numberOfLines={6}
        style={{ height: 140, width: '100%', textAlignVertical: 'top' }}
      />
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Done
        </Btn>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/guided/CondDetailStep.tsx apps/mobile/src/screens/guided/TextStep.tsx
git commit -m "mobile: guided builder — conditioning detail and text steps"
```

---

## Task 10: Mobile — orchestrator, navigator, and Library wiring

**Files:**
- Create: `apps/mobile/src/screens/guided/GuidedBuilder.tsx`
- Modify: `apps/mobile/src/App.tsx` (add `GuidedBuilder` to `RootStackParams` and the navigator)
- Modify: `apps/mobile/src/screens/Library.tsx` (the create-session function and its call sites)

**Interfaces:**
- Consumes: everything from Task 7–9; `stepsFor`, `nextStep`, `prevStep`, `canAdvance`, types from `@hybrid/guided-flow`; `newBlock`, `newTextBlock`, `newCondBlock`, `CON_EFFORTS`, `knownMovements` from `@hybrid/engine`; `useDb` from `../../store/db`; `RootStackParams` from `../../App`.
- Produces: `GuidedBuilderScreen()` — the screen registered as the `GuidedBuilder` stack route.

- [ ] **Step 1: Write `GuidedBuilder.tsx`**

Same state machine as web's `GuidedBuilder.tsx` (Task 5), adapted to React Navigation instead of react-router:

```tsx
import { useMemo, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  canAdvance,
  nextStep,
  prevStep,
  type BlockKind,
  type FlowDraft,
  type FlowStep,
} from '@hybrid/guided-flow';
import { CON_EFFORTS, knownMovements, newBlock, newCondBlock, newTextBlock, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { Btn, Kicker, Screen } from '../../ui';
import type { RootStackParams } from '../../App';
import { BlockTypeStep } from './BlockTypeStep';
import { MovementStep } from './MovementStep';
import { SetsStep } from './SetsStep';
import { RepsStep } from './RepsStep';
import { RpeStep } from './RpeStep';
import { CondDetailStep } from './CondDetailStep';
import { TextStep } from './TextStep';

interface Draft extends FlowDraft {
  blockKind: Exclude<BlockKind, null> | null;
  isWarmupSet: boolean;
  sets: number;
  effort: EffortKey;
  minutes: number;
}

const EMPTY_DRAFT: Draft = {
  blockKind: null,
  isWarmupSet: false,
  movementName: '',
  sets: 3,
  reps: '',
  rpe: '',
  condFmt: '',
  effort: 'medium',
  minutes: 0,
  text: '',
};

const BLOCK_LABEL: Record<Exclude<BlockKind, null>, string> = {
  lift: 'Lift',
  warmup: 'Warm-up / Cooldown',
  cond: 'Conditioning',
  metcon: 'Metcon / notes',
};

export function GuidedBuilderScreen() {
  const { params } = useRoute<RouteProp<RootStackParams, 'GuidedBuilder'>>();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, update } = useDb();
  const known = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);

  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [added, setAdded] = useState<string[]>([]);
  const [phase, setPhase] = useState<'flow' | 'add-another'>('flow');

  const state = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmupSet };

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commitBlock() {
    const kind = draft.blockKind;
    if (!kind) return;
    let label = '';
    update((d) => {
      const w = d.workouts.find((x) => x.id === params.id);
      if (!w) return false;
      if (kind === 'lift') {
        const block = newBlock();
        const t = draft.isWarmupSet ? 'W' + draft.reps : draft.reps;
        const rpe = draft.isWarmupSet ? '' : draft.rpe;
        block.exercises[0].name = draft.movementName;
        block.exercises[0].sets = Array.from({ length: draft.sets }, () => ({ t, rpe }));
        w.blocks.push(block);
        label = draft.movementName;
      } else if (kind === 'cond') {
        // @hybrid/engine's flat-exported `newCondBlock` (from session.ts) is
        // zero-argument — the 4-arg version only exists as `emit.newCondBlock`,
        // reachable through the namespaced `emit` export, not this flat import.
        // Build with the zero-arg constructor, then set the fields by hand;
        // CON_EFFORTS[effort].zone reproduces the same zone derivation
        // emit.newCondBlock does internally (confirmed identical mapping:
        // easy→low, medium→mod, hard→high, in both CON_EFFORTS and emit's
        // own EFFORTS table).
        const block = newCondBlock();
        block.condFmt = (draft.condFmt || 'intervals') as CondFmtKey;
        block.effort = draft.effort;
        block.targetZone = CON_EFFORTS[draft.effort].zone;
        block.minutes = draft.minutes || '';
        w.blocks.push(block);
        label = 'Conditioning';
      } else {
        const block = newTextBlock();
        block.heading = BLOCK_LABEL[kind];
        block.body = draft.text;
        w.blocks.push(block);
        label = BLOCK_LABEL[kind];
      }
      w.updatedAt = Date.now();
    });
    setAdded((a) => [...a, label]);
    setPhase('add-another');
  }

  function goNext() {
    const next = nextStep(step, state);
    if (next) {
      setStep(next);
      return;
    }
    commitBlock();
  }

  function goBack() {
    const prev = prevStep(step, state);
    if (prev) {
      setStep(prev);
      return;
    }
    nav.navigate('Tabs', { screen: 'Library' } as never);
  }

  function pick(kind: Exclude<BlockKind, null>) {
    patch({ blockKind: kind });
    setStep(nextStep('block-type', { blockKind: kind, isWarmupSet: false }) ?? 'block-type');
  }

  if (phase === 'add-another') {
    return (
      <Screen>
        <Kicker>{added.join(', ')} added</Kicker>
        <Btn variant="brass" onPress={() => { setDraft(EMPTY_DRAFT); setStep('block-type'); setPhase('flow'); }}>
          Yes, add another
        </Btn>
        <Btn onPress={() => nav.navigate('Planner', { id: params.id })}>No, I&apos;m done</Btn>
      </Screen>
    );
  }

  if (step === 'block-type') return <BlockTypeStep onPick={pick} />;

  if (step === 'movement') {
    return (
      <MovementStep
        value={draft.movementName}
        known={known}
        onChange={(v) => patch({ movementName: v })}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('movement', draft)}
      />
    );
  }

  if (step === 'sets') {
    return <SetsStep value={draft.sets} onChange={(n) => patch({ sets: n })} onNext={goNext} onBack={goBack} />;
  }

  if (step === 'reps') {
    return (
      <RepsStep
        value={draft.reps}
        isWarmupSet={draft.isWarmupSet}
        onChange={(v) => patch({ reps: v })}
        onWarmupSetChange={(v) => patch({ isWarmupSet: v })}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('reps', draft)}
      />
    );
  }

  if (step === 'rpe') {
    return (
      <RpeStep
        value={draft.rpe}
        onChange={(v) => patch({ rpe: v })}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('rpe', draft)}
      />
    );
  }

  if (step === 'cond-detail') {
    return (
      <CondDetailStep
        condFmt={draft.condFmt as CondFmtKey | ''}
        effort={draft.effort}
        minutes={draft.minutes}
        onChange={(p) => patch(p)}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('cond-detail', draft)}
      />
    );
  }

  const question = draft.blockKind === 'warmup' ? "What's the warm-up?" : "What's the workout?";
  return (
    <TextStep
      question={question}
      value={draft.text}
      onChange={(v) => patch({ text: v })}
      onNext={goNext}
      onBack={goBack}
      disabled={!canAdvance('text', draft)}
    />
  );
}
```

- [ ] **Step 2: Wire the navigator in `App.tsx`**

Add to `RootStackParams` (`apps/mobile/src/App.tsx:64` area, alongside `Planner: { id: string }`):

```ts
GuidedBuilder: { id: string };
```

Add the import and the screen, alongside the `Planner` screen registration:

```tsx
import { GuidedBuilderScreen } from './screens/guided/GuidedBuilder';
```

```tsx
<Stack.Screen name="Planner" component={PlannerScreen} />
<Stack.Screen name="GuidedBuilder" component={GuidedBuilderScreen} />
```

- [ ] **Step 3: Change `Library.tsx`'s create-session function**

Find the function that mirrors web's `addWorkout` (`apps/mobile/src/screens/Library.tsx`, the one building `{ id: uid(), name: 'New session', blocks: [newBlock()], updatedAt: Date.now() }` and calling `nav.navigate('Planner', { id: w.id })`). Change `blocks: [newBlock()]` to `blocks: []`, and change the navigation call to `nav.navigate('GuidedBuilder', { id: w.id })`. If `newBlock` becomes unused elsewhere in the file, remove the import — the typecheck step catches this either way.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/guided/GuidedBuilder.tsx apps/mobile/src/App.tsx apps/mobile/src/screens/Library.tsx
git commit -m "mobile: wire the guided builder in as the '+ New session' entry point"
```

---

## Task 11: Mobile — end-to-end check

**Files:**
- Create: `apps/mobile/test/guidedBuilder.test.tsx`

**Interfaces:**
- Consumes: `renderScreen`, `seed`, `liftWorkout` (or an equivalent minimal `Workout` fixture — check `apps/mobile/test/harness.tsx` for what fixtures already exist; use one if it fits, otherwise write a minimal inline `Workout` the same way `apps/mobile/test/training.test.tsx` does) from `./harness`; `fireEvent`, `screen` from `@testing-library/react-native`; `GuidedBuilderScreen` from `../src/screens/guided/GuidedBuilder`.

- [ ] **Step 1: Write the failing test**

```tsx
/*
 * The guided builder: mounting it against a seeded store and driving the
 * whole flow for real, the same way training.test.tsx mounts Training.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen, seed } from './harness';
import { GuidedBuilderScreen } from '../src/screens/guided/GuidedBuilder';

describe('GuidedBuilderScreen', () => {
  it('builds a lift block end to end and lands on "add another?"', () => {
    const w = { id: 'w1', name: 'New session', blocks: [], updatedAt: Date.now() };
    seed({ workouts: [w] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('🏋 Lift'));
    expect(screen.getByText('Which movement?')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How many sets?')).toBeTruthy();

    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How many reps?')).toBeTruthy();

    fireEvent.press(screen.getByText('8'));
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How hard should it feel?')).toBeTruthy();

    fireEvent.press(screen.getByText('RPE 8'));
    fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Add another block?')).toBeTruthy();
    expect(screen.getByText('Back Squat added')).toBeTruthy();
  });
});
```

Check `renderScreen`'s exact signature in `apps/mobile/test/harness.tsx` before relying on the `{ id: 'w1' }` second argument — the file already supports passing route params to a screen mounted inside a one-route stack (`export function renderScreen(ui: ReactElement, params?: object)`), so this should work as written; adjust only if the harness's actual shape differs.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @hybrid/mobile test -- guidedBuilder`
Expected: FAIL — `Cannot find module '../src/screens/guided/GuidedBuilder'` (Task 10 must land before this test can pass; if Task 10 is already done by the time this task runs, it should instead fail on a missing screen route registration or similar — either way, confirm it fails before writing anything new here).

- [ ] **Step 3: Run it to verify it passes**

Run: `pnpm --filter @hybrid/mobile test -- guidedBuilder`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/test/guidedBuilder.test.tsx
git commit -m "mobile: end-to-end test for the guided builder"
```

---

## Task 12: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1: Full workspace typecheck and test**

Run: `pnpm run typecheck && pnpm run test`
Expected: all packages pass, including `packages/engine` (247 tests, `golden.test.ts`'s 33 unchanged) and the new `packages/guided-flow`.

- [ ] **Step 2: Full verify**

Run: `pnpm run verify`
Expected: typecheck, test, build:site, check:csp, `checks/react-smoke.mjs`, `checks/deploy-smoke.mjs` all pass.

- [ ] **Step 3: Touch targets, contrast, docs**

Run: `node checks/web-touch.mjs && node checks/contrast.mjs && node checks/docs.mjs`
Expected: all pass. If `docs.mjs` flags the README (it checks backticked paths/symbols), add a row for the new `packages/guided-flow` package if the README's Layout section lists every `packages/*` entry — check `README.md`'s Layout block before assuming this is needed.

- [ ] **Step 4: Push**

```bash
git push -u origin main
```

If it fails on a network error, retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s).

---

## Self-Review Notes

- **Spec coverage:** every numbered item in the spec's "The flow, block by block" section maps to a task above — block-type (Task 2/7), movement (Task 2/7), sets/reps/RPE (Task 3/8), conditioning (Task 4/9), warm-up/metcon as one text step (Task 4/9), add-another with running summary (Task 5/10), back-navigation behavior (Task 5/10), hand-off to Planner (Task 5/10), shared pure logic (Task 1), touch targets and non-color chip signal (Tasks 3, 4, 8, 9), end-to-end tests for both apps (Task 6, 11).
- **Type consistency checked:** `FlowDraft`/`BlockKind`/`FlowStep` from Task 1 are the exact types every later task imports and extends (`Draft extends FlowDraft` in both orchestrators) — no renamed fields between tasks.
- **Out-of-scope items** (Planner changes, review/chain/split screen, coach plumbing, iOS) appear in no task above, matching the spec.
