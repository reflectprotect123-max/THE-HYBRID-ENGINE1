# Mobile Self-Coach Approval Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the web self-coach "propose, then decide" Auto-Coached gate (`docs/RISK_REGISTER.md` R2, `apps/web/src/autocoach/*`) to `apps/mobile`, so an athlete using the phone app gets the same Approve/Decline mechanics and the same Shadow → Assisted → Auto-Daily mode switch web already has. Today `apps/mobile` has none of this — no ledger, no policy, no consent, no receipt, no mode switcher, and `@hybrid/auto-coach` isn't even a dependency.

**Architecture:** Six new files under `apps/mobile/src/autocoach/`, each a close structural port of its `apps/web/src/autocoach/` counterpart, swapping `localStorage` for mobile's existing MMKV-backed `storage` port (`apps/mobile/src/store/storage.ts`) and HTML/Tailwind JSX for RN primitives (`View`/`T`/`Tap`/`Card` from `apps/mobile/src/ui.tsx`). Two integration points: a `SessionReceipt` card mounted in `apps/mobile/src/screens/Home.tsx` (mirrors web's `Home.tsx` mount, same screen role), and a mode-switcher section added to the existing `apps/mobile/src/screens/Settings.tsx`. `@hybrid/auto-coach` and `@hybrid/engine` are consumed unchanged — this plan touches neither package.

**Tech Stack:** React Native 0.81 / React 19, NativeWind 4 (`className` on RN primitives), TypeScript, Jest + `jest-expo` + `@testing-library/react-native` (mobile's existing test stack — NOT Vitest), `react-native-mmkv` via `apps/mobile/src/store/storage.ts`, existing `@hybrid/auto-coach` and `@hybrid/engine` packages (untouched).

## Global Constraints

- `packages/auto-coach` is not modified — same constraint as the web plan. `resolveSession()`'s signature and hard-safety gate are read-only here.
- `LedgerEntry.action` stays `'applied' | 'undone'` — no third value.
- Every new/modified test file is colocated (`src/x.ts` next to `src/x.test.ts`), per `CLAUDE.md`.
- Every non-trivial behavior gets a test demonstrated able to fail (mutation-tested), per this repo's established discipline.
- "Today" and "this weekday" use mobile's existing **local-time** convention (`ymd(new Date())`, `new Date().getDay()` from `@hybrid/engine`), matching `Home.tsx`/`Training.tsx` — NOT web's UTC convention (`toISOString().slice(0,10)`, `getUTCDay()`). This is a deliberate deviation from a verbatim port: matching every other mobile screen's day-boundary behavior matters more than byte-identical dates with web, since `pendingProposal`/`ledger` records are mobile-local anyway (mobile and web already keep fully separate localStorage/MMKV stores — nothing here is synced between them).
- No offline queueing for Approve/Decline: if the write fails, the UI shows an error and the athlete retries by tapping again — same manual-retry pattern as web, no persisted retry queue.
- RN has no `outline` CSS concept — every web `outline outline-1 outline-X` becomes `border border-X`. There is no bare `<button>`/`<span>`/`<div>`/`<details>` on RN — use `Tap` (pressable), `T` (text), `View`, and a `useState`-toggled block in place of `<details>/<summary>`.
- `pnpm run typecheck`, `pnpm --filter @hybrid/mobile test`, and `pnpm --filter @hybrid/mobile typecheck` must stay green after every task.

---

### Task 1: Add `@hybrid/auto-coach` as a mobile dependency

**Files:**
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Produces: `@hybrid/auto-coach` resolvable from any `apps/mobile/src/**` file, exporting `resolveSession`, `AutoCoachResolution`, `AutonomyPolicy`, `DEFAULT_POLICY`, `ResolutionOperation` (all already exported by the package — confirmed via its use in `apps/web/src/autocoach/*`).

- [ ] **Step 1: Add the dependency**

In `apps/mobile/package.json`, add a new line inside `"dependencies"`, alphabetically after `"@hybrid/config": "workspace:*",` and before `"@hybrid/coordinator-adapter": "workspace:*",`:

```json
    "@hybrid/auto-coach": "workspace:*",
```

- [ ] **Step 2: Install and verify resolution**

Run: `pnpm install`
Expected: lockfile updates, no errors. `@hybrid/auto-coach`'s own dependencies (`@hybrid/engine`, `@hybrid/shared-core`, `@hybrid/whole-athlete-state`) are already present in mobile's tree, so this pulls in no new transitive package.

- [ ] **Step 3: Confirm the import resolves**

Run: `pnpm --filter @hybrid/mobile exec tsc -p tsconfig.json --noEmit`
Expected: PASS (no new errors — nothing imports the package yet, this just confirms workspace linking).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "chore(mobile): add @hybrid/auto-coach dependency"
```

---

### Task 2: `ledger.ts` — mobile port

**Files:**
- Create: `apps/mobile/src/autocoach/ledger.ts`
- Test: `apps/mobile/src/autocoach/ledger.test.ts`

**Interfaces:**
- Consumes: `storage` from `../store/storage` (`Storage` port: `getItem(k): string|null`, `setItem(k,v): void`, `removeItem(k): void`, all synchronous — confirmed shape from `apps/mobile/src/store/storage.ts`).
- Produces: `LedgerEntry` (type), `NewLedgerEntry` (type), `useLedger(): LedgerEntry[]`, `getLedgerEntries(): LedgerEntry[]`, `recordApply(entry: NewLedgerEntry): LedgerEntry`, `recordUndo(entry: LedgerEntry): LedgerEntry`, `canUndo(entry: LedgerEntry): boolean`, `resetLedgerForTests(): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/autocoach/ledger.test.ts
import {
  canUndo,
  getLedgerEntries,
  recordApply,
  recordUndo,
  resetLedgerForTests,
  type NewLedgerEntry,
} from './ledger';

function fixtureEntry(over: Partial<NewLedgerEntry> = {}): NewLedgerEntry {
  return {
    date: '2026-08-09',
    workoutId: 'w-1',
    wasForked: false,
    beforeBlocks: [],
    operations: [],
    reasonCodes: ['low_readiness'],
    ...over,
  };
}

beforeEach(() => resetLedgerForTests());

describe('mobile ledger store', () => {
  it('starts empty', () => {
    expect(getLedgerEntries()).toEqual([]);
  });

  it('recordApply adds an entry with action "applied"', () => {
    const e = recordApply(fixtureEntry());
    expect(e.action).toBe('applied');
    expect(getLedgerEntries()).toHaveLength(1);
    expect(getLedgerEntries()[0].id).toBe(e.id);
  });

  it('recordUndo adds a NEW entry with action "undone", keeping the original', () => {
    const applied = recordApply(fixtureEntry());
    const undone = recordUndo(applied);
    expect(undone.action).toBe('undone');
    expect(undone.id).not.toBe(applied.id);
    expect(getLedgerEntries()).toHaveLength(2);
  });

  it('newest entry is first', () => {
    recordApply(fixtureEntry({ workoutId: 'w-1' }));
    recordApply(fixtureEntry({ workoutId: 'w-2' }));
    expect(getLedgerEntries()[0].workoutId).toBe('w-2');
  });

  it('caps at 30 entries, dropping the oldest', () => {
    for (let i = 0; i < 35; i++) recordApply(fixtureEntry({ workoutId: `w-${i}` }));
    const entries = getLedgerEntries();
    expect(entries).toHaveLength(30);
    expect(entries[0].workoutId).toBe('w-34');
    expect(entries[29].workoutId).toBe('w-5');
  });

  it('canUndo is true for an applied entry with beforeBlocks', () => {
    const e = recordApply(fixtureEntry({ beforeBlocks: [] }));
    expect(canUndo(e)).toBe(true);
  });

  it('canUndo is false for an undone entry', () => {
    const applied = recordApply(fixtureEntry());
    const undone = recordUndo(applied);
    expect(canUndo(undone)).toBe(false);
  });

  it('canUndo is true for a forked entry with a forkedWorkoutId, false without one', () => {
    const withFork = recordApply(fixtureEntry({ wasForked: true, forkedWorkoutId: 'w-fork', beforeBlocks: undefined }));
    expect(canUndo(withFork)).toBe(true);
    const withoutFork = recordApply(fixtureEntry({ wasForked: true, forkedWorkoutId: undefined, beforeBlocks: undefined }));
    expect(canUndo(withoutFork)).toBe(false);
  });

  it('persists across a reload of the module state via getLedgerEntries', () => {
    recordApply(fixtureEntry());
    resetLedgerForTests();
    expect(getLedgerEntries()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/ledger.test.ts`
Expected: FAIL — `Cannot find module './ledger'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/autocoach/ledger.ts
import { useSyncExternalStore } from 'react';
import type { Block } from '@hybrid/engine';
import type { ResolutionOperation } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * Auto-Coached apply/undo history. Additive persistence: its own storage
 * key, never a field on EngineDB, invisible to sync — mirrors policy.ts.
 * This is bookkeeping for what the athlete did, not athlete data; losing it
 * loses undo capability, never a workout. Ported from apps/web's ledger.ts.
 */

export interface LedgerEntry {
  id: string;
  at: number;
  date: string;
  workoutId: string;
  action: 'applied' | 'undone';
  wasForked: boolean;
  forkedWorkoutId?: string;
  beforeBlocks?: Block[];
  operations: ResolutionOperation[];
  reasonCodes: string[];
}

const KEY = 'hybrid-auto-coach-ledger-v1';
const MAX_ENTRIES = 30;

interface LedgerState {
  schemaVersion: 1;
  entries: LedgerEntry[];
}

const empty = (): LedgerState => ({ schemaVersion: 1, entries: [] });

let state: LedgerState = load();
const listeners = new Set<() => void>();

function load(): LedgerState {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as LedgerState;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function uid(): string {
  return `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function persist(next: LedgerState): void {
  state = next;
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage write failed — ledger stays session-local */
  }
  listeners.forEach((l) => l());
}

export function useLedger(): LedgerEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.entries,
  );
}

export function getLedgerEntries(): LedgerEntry[] {
  return state.entries;
}

export type NewLedgerEntry = Omit<LedgerEntry, 'id' | 'at' | 'action'>;

export function recordApply(entry: NewLedgerEntry): LedgerEntry {
  const full: LedgerEntry = { ...entry, id: uid(), at: Date.now(), action: 'applied' };
  persist({ schemaVersion: 1, entries: [full, ...state.entries].slice(0, MAX_ENTRIES) });
  return full;
}

export function recordUndo(entry: LedgerEntry): LedgerEntry {
  const undone: LedgerEntry = { ...entry, id: uid(), at: Date.now(), action: 'undone' };
  persist({ schemaVersion: 1, entries: [undone, ...state.entries].slice(0, MAX_ENTRIES) });
  return undone;
}

export function canUndo(entry: LedgerEntry): boolean {
  if (entry.action !== 'applied') return false;
  return entry.wasForked ? !!entry.forkedWorkoutId : entry.beforeBlocks !== undefined;
}

export function resetLedgerForTests(): void {
  persist(empty());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/ledger.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/autocoach/ledger.ts apps/mobile/src/autocoach/ledger.test.ts
git commit -m "feat(mobile): port auto-coach ledger store"
```

---

### Task 3: `policy.ts` — mobile port

**Files:**
- Create: `apps/mobile/src/autocoach/policy.ts`
- Test: `apps/mobile/src/autocoach/policy.test.ts`

**Interfaces:**
- Consumes: `storage` from `../store/storage`; `DEFAULT_POLICY`, `AutonomyPolicy` from `@hybrid/auto-coach`.
- Produces: `usePolicy(): AutonomyPolicy`, `updatePolicy(fn: (p: AutonomyPolicy) => AutonomyPolicy): void`, `resetPolicyForTests(): void` (new — web's `policy.ts` has no reset export because its tests reset via `localStorage.clear()`; mobile's `storage` port needs an explicit reset the same way `ledger.ts`/`discipline.ts` provide one).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/autocoach/policy.test.ts
import { updatePolicy, getPolicy, resetPolicyForTests } from './policy';

beforeEach(() => resetPolicyForTests());

describe('mobile policy store', () => {
  it('defaults to shadow mode, active status', () => {
    const p = getPolicy();
    expect(p.mode).toBe('shadow');
    expect(p.status).toBe('active');
  });

  it('updatePolicy applies the updater and bumps version', () => {
    const before = getPolicy();
    updatePolicy((p) => ({ ...p, mode: 'assisted' }));
    const after = getPolicy();
    expect(after.mode).toBe('assisted');
    expect(after.version).toBe(before.version + 1);
  });

  it('persists across resetPolicyForTests reload from storage', () => {
    updatePolicy((p) => ({ ...p, mode: 'auto_daily' }));
    resetPolicyForTests();
    // resetPolicyForTests clears storage, so this reload sees the default again
    expect(getPolicy().mode).toBe('shadow');
  });

  it('pause/resume toggles status', () => {
    updatePolicy((p) => ({ ...p, status: 'paused' }));
    expect(getPolicy().status).toBe('paused');
    updatePolicy((p) => ({ ...p, status: 'active' }));
    expect(getPolicy().status).toBe('active');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/policy.test.ts`
Expected: FAIL — `Cannot find module './policy'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/autocoach/policy.ts
import { useSyncExternalStore } from 'react';
import { DEFAULT_POLICY, type AutonomyPolicy } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * The athlete-owned autonomy policy, ported from apps/web's policy.ts.
 * Additive persistence: its own storage key, never a field on EngineDB,
 * invisible to sync. Ships shadow mode by default — nothing is applied
 * automatically until the athlete explicitly changes mode via the mode
 * switcher, and pausing is one tap from the receipt itself.
 */

const KEY = 'hybrid-auto-coach-policy-v1';

let policy: AutonomyPolicy = load();
const listeners = new Set<() => void>();

function load(): AutonomyPolicy {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return DEFAULT_POLICY;
    const parsed = JSON.parse(raw) as AutonomyPolicy;
    if (parsed?.schemaVersion !== 1) return DEFAULT_POLICY;
    return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    return DEFAULT_POLICY;
  }
}

export function usePolicy(): AutonomyPolicy {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => policy,
  );
}

/** Non-hook read, for code outside a component render (mirrors ledger.ts's
 *  getLedgerEntries, needed by SessionReceipt's effect and its handlers,
 *  which are not always inside the render that owns usePolicy()). */
export function getPolicy(): AutonomyPolicy {
  return policy;
}

export function updatePolicy(fn: (p: AutonomyPolicy) => AutonomyPolicy): void {
  policy = { ...fn(policy), version: policy.version + 1 };
  try {
    storage.setItem(KEY, JSON.stringify(policy));
  } catch {
    /* storage write failed — policy stays session-local */
  }
  listeners.forEach((l) => l());
}

export function resetPolicyForTests(): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  policy = DEFAULT_POLICY;
  listeners.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/policy.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/autocoach/policy.ts apps/mobile/src/autocoach/policy.test.ts
git commit -m "feat(mobile): port auto-coach policy store"
```

---

### Task 4: `consent.ts` — mobile port

**Files:**
- Create: `apps/mobile/src/autocoach/consent.ts`
- Test: `apps/mobile/src/autocoach/consent.test.ts`

**Interfaces:**
- Consumes: `storage` from `../store/storage`; `AutonomyPolicy` from `@hybrid/auto-coach`.
- Produces: `AutoCoachConsent` (type), `ConsentRecord` (type), `DEFAULT_CONSENT`, `CONSENT_TEXT_VERSION`, `useConsent(): AutoCoachConsent`, `recordConsent(kind, accepted): void`, `recordComprehensionPassed(passed): void`, `ComprehensionStatement` (type), `COMPREHENSION_STATEMENTS`, `allComprehensionCorrect(answers): boolean`, `highestAllowedMode(consentState): AutonomyPolicy['mode']`, `resetConsentForTests(): void` (new, same rationale as Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/autocoach/consent.test.ts
import {
  allComprehensionCorrect,
  COMPREHENSION_STATEMENTS,
  getConsent,
  highestAllowedMode,
  recordComprehensionPassed,
  recordConsent,
  resetConsentForTests,
} from './consent';

beforeEach(() => resetConsentForTests());

describe('mobile consent store', () => {
  it('starts with no consent recorded', () => {
    const c = getConsent();
    expect(c.proposalsConsent).toBeNull();
    expect(c.autoApplyConsent).toBeNull();
    expect(c.comprehensionPassed).toBe(false);
  });

  it('recordConsent("proposals", true) sets proposalsConsent, leaves autoApply alone', () => {
    recordConsent('proposals', true);
    const c = getConsent();
    expect(c.proposalsConsent?.accepted).toBe(true);
    expect(c.autoApplyConsent).toBeNull();
  });

  it('recordConsent bumps version', () => {
    const before = getConsent().version;
    recordConsent('proposals', true);
    expect(getConsent().version).toBe(before + 1);
  });

  it('recordComprehensionPassed sets the flag independent of consents', () => {
    recordComprehensionPassed(true);
    expect(getConsent().comprehensionPassed).toBe(true);
  });

  it('allComprehensionCorrect requires every answer to match, in order', () => {
    const allCorrect = COMPREHENSION_STATEMENTS.map((s) => s.correct);
    expect(allComprehensionCorrect(allCorrect)).toBe(true);
    const oneWrong = [...allCorrect];
    oneWrong[0] = !oneWrong[0];
    expect(allComprehensionCorrect(oneWrong)).toBe(false);
  });

  it('allComprehensionCorrect fails on a null (unanswered) entry', () => {
    const withNull = COMPREHENSION_STATEMENTS.map((s) => s.correct) as (boolean | null)[];
    withNull[2] = null;
    expect(allComprehensionCorrect(withNull)).toBe(false);
  });

  it('allComprehensionCorrect fails on wrong-length input', () => {
    expect(allComprehensionCorrect([true])).toBe(false);
  });

  it('highestAllowedMode: no proposals consent caps at shadow', () => {
    expect(highestAllowedMode({ proposalsConsent: null, autoApplyConsent: null })).toBe('shadow');
  });

  it('highestAllowedMode: proposals accepted but not autoApply caps at assisted', () => {
    expect(
      highestAllowedMode({
        proposalsConsent: { accepted: true, at: 1, textVersion: 1 },
        autoApplyConsent: null,
      }),
    ).toBe('assisted');
  });

  it('highestAllowedMode: both accepted allows auto_daily', () => {
    expect(
      highestAllowedMode({
        proposalsConsent: { accepted: true, at: 1, textVersion: 1 },
        autoApplyConsent: { accepted: true, at: 1, textVersion: 1 },
      }),
    ).toBe('auto_daily');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/consent.test.ts`
Expected: FAIL — `Cannot find module './consent'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/autocoach/consent.ts
import { useSyncExternalStore } from 'react';
import type { AutonomyPolicy } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * Consent for Auto-Coached, ported from apps/web's consent.ts. Two consents
 * only — proposalsConsent (required to leave shadow for assisted) and
 * autoApplyConsent (required, additionally, for auto_daily). Additive store:
 * its own storage key, same useSyncExternalStore shape as policy.ts, never
 * a field on EngineDB.
 */

export const CONSENT_SCHEMA_VERSION = 1 as const;

/** Bump when the consent copy changes materially, so a stale acceptance can
 * be told apart from one made against the current text. Kept in sync by
 * hand with apps/web/src/autocoach/consent.ts's CONSENT_TEXT_VERSION — the
 * two apps show independently-worded but equivalent consent copy, so this
 * is not required to match web's value, only to bump whenever THIS file's
 * copy changes. */
export const CONSENT_TEXT_VERSION = 1;

export interface ConsentRecord {
  accepted: boolean;
  at: number;
  textVersion: number;
}

export interface AutoCoachConsent {
  schemaVersion: typeof CONSENT_SCHEMA_VERSION;
  version: number;
  proposalsConsent: ConsentRecord | null;
  autoApplyConsent: ConsentRecord | null;
  comprehensionPassed: boolean;
}

export const DEFAULT_CONSENT: AutoCoachConsent = {
  schemaVersion: CONSENT_SCHEMA_VERSION,
  version: 1,
  proposalsConsent: null,
  autoApplyConsent: null,
  comprehensionPassed: false,
};

const KEY = 'hybrid-auto-coach-consent-v1';

let consent: AutoCoachConsent = load();
const listeners = new Set<() => void>();

function load(): AutoCoachConsent {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return DEFAULT_CONSENT;
    const parsed = JSON.parse(raw) as AutoCoachConsent;
    if (parsed?.schemaVersion !== 1) return DEFAULT_CONSENT;
    return { ...DEFAULT_CONSENT, ...parsed };
  } catch {
    return DEFAULT_CONSENT;
  }
}

function set(next: AutoCoachConsent): void {
  consent = { ...next, version: consent.version + 1 };
  try {
    storage.setItem(KEY, JSON.stringify(consent));
  } catch {
    /* storage write failed — consent stays session-local */
  }
  listeners.forEach((l) => l());
}

export function useConsent(): AutoCoachConsent {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => consent,
  );
}

/** Non-hook read, mirrors policy.ts's getPolicy() — needed outside render. */
export function getConsent(): AutoCoachConsent {
  return consent;
}

export function recordConsent(kind: 'proposals' | 'autoApply', accepted: boolean): void {
  const record: ConsentRecord = { accepted, at: Date.now(), textVersion: CONSENT_TEXT_VERSION };
  set({
    ...consent,
    proposalsConsent: kind === 'proposals' ? record : consent.proposalsConsent,
    autoApplyConsent: kind === 'autoApply' ? record : consent.autoApplyConsent,
  });
}

export function recordComprehensionPassed(passed: boolean): void {
  set({ ...consent, comprehensionPassed: passed });
}

/* ---------- pure logic, tested directly ---------- */

export interface ComprehensionStatement {
  text: string;
  correct: boolean;
}

/** Same five true/false statements as web's ModeSwitcher quiz, order fixed
 * so tests can address them by index. */
export const COMPREHENSION_STATEMENTS: ComprehensionStatement[] = [
  { text: 'It can make small changes to today’s session.', correct: true },
  { text: 'It can diagnose an injury.', correct: false },
  { text: 'It can override a safety flag.', correct: false },
  { text: 'It changes your long-term goal without asking.', correct: false },
  { text: 'Material changes are shown before you train.', correct: true },
];

export function allComprehensionCorrect(answers: (boolean | null)[]): boolean {
  if (answers.length !== COMPREHENSION_STATEMENTS.length) return false;
  return answers.every((a, i) => a === COMPREHENSION_STATEMENTS[i].correct);
}

export function highestAllowedMode(
  consentState: Pick<AutoCoachConsent, 'proposalsConsent' | 'autoApplyConsent'>,
): AutonomyPolicy['mode'] {
  if (!consentState.proposalsConsent?.accepted) return 'shadow';
  if (!consentState.autoApplyConsent?.accepted) return 'assisted';
  return 'auto_daily';
}

export function resetConsentForTests(): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  consent = DEFAULT_CONSENT;
  listeners.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/consent.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/autocoach/consent.ts apps/mobile/src/autocoach/consent.test.ts
git commit -m "feat(mobile): port auto-coach consent store"
```

---

### Task 5: `applyResolution.ts` — mobile port (pure, no storage)

**Files:**
- Create: `apps/mobile/src/autocoach/applyResolution.ts`
- Test: `apps/mobile/src/autocoach/applyResolution.test.ts`

**Interfaces:**
- Consumes: `Block`, `Workout` from `@hybrid/engine`; `AutoCoachResolution` from `@hybrid/auto-coach`; `LedgerEntry` from `./ledger` (Task 2).
- Produces: `isOneOffToday(workout, today): boolean`, `MutatePlan`/`ForkPlan`/`ApplyPlan` (types), `planApply(workout, resolution, today, mkId): ApplyPlan`, `ledgerEntryFromApply(plan, resolution, today): Omit<LedgerEntry,'id'|'at'|'action'>`, `canApply(resolution): boolean`, `RestorePlan`/`DeleteForkPlan`/`UndoPlan` (types), `planUndo(entry): UndoPlan | null`.

This file is pure logic with zero RN/DOM surface — it is a byte-for-byte port of web's `applyResolution.ts` (only the import path for `LedgerEntry` changes, and it already points at the local `./ledger`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/autocoach/applyResolution.test.ts
import type { AutoCoachResolution } from '@hybrid/auto-coach';
import type { Workout } from '@hybrid/engine';
import {
  canApply,
  isOneOffToday,
  ledgerEntryFromApply,
  planApply,
  planUndo,
} from './applyResolution';
import type { LedgerEntry } from './ledger';

function fixtureWorkout(over: Partial<Workout> = {}): Workout {
  return {
    id: 'w-1',
    kind: 'strength',
    name: 'Push Day',
    blocks: [],
    dates: ['2026-08-09'],
    updatedAt: 1000,
    ...over,
  };
}

function fixtureResolution(over: Partial<AutoCoachResolution> = {}): AutoCoachResolution {
  return {
    schemaVersion: 1,
    state: 'advisory',
    originalWorkoutId: 'w-1',
    resolvedWorkout: { id: 'w-1', name: 'Push Day', kind: 'strength', blocks: [] } as AutoCoachResolution['resolvedWorkout'],
    operations: [{ type: 'cap_intensity', before: '5x5 @ 225', after: '5x5 @ 205' } as never],
    signals: [],
    inferences: [],
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    requiresConfirmation: true,
    autoApplyAllowed: false,
    athleteMessage: 'Cap intensity today.',
    ...over,
  };
}

describe('isOneOffToday', () => {
  it('true for a one-off dated today with no recurring days', () => {
    expect(isOneOffToday(fixtureWorkout({ dates: ['2026-08-09'], days: undefined }), '2026-08-09')).toBe(true);
  });

  it('false when the workout also carries recurring days', () => {
    expect(isOneOffToday(fixtureWorkout({ dates: ['2026-08-09'], days: [0] }), '2026-08-09')).toBe(false);
  });

  it('false when today is not in dates', () => {
    expect(isOneOffToday(fixtureWorkout({ dates: ['2026-08-01'] }), '2026-08-09')).toBe(false);
  });
});

describe('planApply', () => {
  const mkId = () => 'forked-1';

  it('plans a mutate for a one-off-today workout', () => {
    const plan = planApply(fixtureWorkout(), fixtureResolution(), '2026-08-09', mkId);
    expect(plan.kind).toBe('mutate');
    if (plan.kind === 'mutate') expect(plan.workoutId).toBe('w-1');
  });

  it('plans a fork for a recurring-template workout, using mkId for the new id', () => {
    const plan = planApply(fixtureWorkout({ days: [0], dates: [] }), fixtureResolution(), '2026-08-09', mkId);
    expect(plan.kind).toBe('fork');
    if (plan.kind === 'fork') {
      expect(plan.forkedWorkoutId).toBe('forked-1');
      expect(plan.sourceWorkoutId).toBe('w-1');
      expect(plan.date).toBe('2026-08-09');
    }
  });
});

describe('ledgerEntryFromApply', () => {
  it('records beforeBlocks for a mutate plan, no forkedWorkoutId', () => {
    const plan = planApply(fixtureWorkout(), fixtureResolution(), '2026-08-09', () => 'x');
    const entry = ledgerEntryFromApply(plan, fixtureResolution(), '2026-08-09');
    expect(entry.wasForked).toBe(false);
    expect(entry.forkedWorkoutId).toBeUndefined();
    expect(entry.beforeBlocks).toBeDefined();
  });

  it('records forkedWorkoutId for a fork plan, no beforeBlocks', () => {
    const plan = planApply(fixtureWorkout({ days: [0], dates: [] }), fixtureResolution(), '2026-08-09', () => 'forked-2');
    const entry = ledgerEntryFromApply(plan, fixtureResolution(), '2026-08-09');
    expect(entry.wasForked).toBe(true);
    expect(entry.forkedWorkoutId).toBe('forked-2');
    expect(entry.beforeBlocks).toBeUndefined();
  });
});

describe('canApply', () => {
  it('false for safety_stop', () => {
    expect(canApply(fixtureResolution({ state: 'safety_stop' }))).toBe(false);
  });

  it('false when nothing changed (only keep_as_planned operations)', () => {
    expect(canApply(fixtureResolution({ operations: [{ type: 'keep_as_planned' } as never] }))).toBe(false);
  });

  it('true when there is a real change and it requires confirmation', () => {
    expect(canApply(fixtureResolution({ requiresConfirmation: true, autoApplyAllowed: false }))).toBe(true);
  });

  it('true when auto-apply is allowed even without requiresConfirmation', () => {
    expect(canApply(fixtureResolution({ requiresConfirmation: false, autoApplyAllowed: true }))).toBe(true);
  });
});

describe('planUndo', () => {
  const baseEntry: LedgerEntry = {
    id: 'e1',
    at: 1,
    date: '2026-08-09',
    workoutId: 'w-1',
    action: 'applied',
    wasForked: false,
    beforeBlocks: [],
    operations: [],
    reasonCodes: [],
  };

  it('null for an already-undone entry', () => {
    expect(planUndo({ ...baseEntry, action: 'undone' })).toBeNull();
  });

  it('restore plan for a mutate entry with beforeBlocks', () => {
    const plan = planUndo(baseEntry);
    expect(plan?.kind).toBe('restore');
  });

  it('null for a mutate entry missing beforeBlocks', () => {
    expect(planUndo({ ...baseEntry, beforeBlocks: undefined })).toBeNull();
  });

  it('delete-fork plan for a forked entry with a forkedWorkoutId', () => {
    const plan = planUndo({ ...baseEntry, wasForked: true, forkedWorkoutId: 'w-fork', beforeBlocks: undefined });
    expect(plan?.kind).toBe('delete-fork');
  });

  it('null for a forked entry missing forkedWorkoutId', () => {
    expect(planUndo({ ...baseEntry, wasForked: true, forkedWorkoutId: undefined, beforeBlocks: undefined })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/applyResolution.test.ts`
Expected: FAIL — `Cannot find module './applyResolution'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/autocoach/applyResolution.ts
import type { Block, Workout } from '@hybrid/engine';
import type { AutoCoachResolution } from '@hybrid/auto-coach';
import type { LedgerEntry } from './ledger';

/**
 * Fork-vs-mutate for Applying a resolution, and the reverse for Undo.
 * Ported unchanged from apps/web/src/autocoach/applyResolution.ts — pure
 * logic, no RN/DOM surface, no persistence.
 *
 * A workout only qualifies for an in-place mutation when it is dated today
 * AND carries no `days` at all. A workout that has both (dates includes
 * today, but also plays a recurring role on other weekdays) is the same
 * object other future occurrences render from — mutating it in place would
 * leak today's adaptation into those, exactly the corruption the
 * recurring-template fork exists to prevent.
 */

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

export function isOneOffToday(workout: Workout, today: string): boolean {
  return (workout.dates?.includes(today) ?? false) && !(workout.days && workout.days.length > 0);
}

export interface MutatePlan {
  kind: 'mutate';
  workoutId: string;
  beforeBlocks: Block[];
  afterBlocks: Block[];
}

export interface ForkPlan {
  kind: 'fork';
  sourceWorkoutId: string;
  forkedWorkoutId: string;
  name: string | undefined;
  workoutKind: Workout['kind'];
  date: string;
  blocks: Block[];
}

export type ApplyPlan = MutatePlan | ForkPlan;

export function planApply(
  workout: Workout,
  resolution: AutoCoachResolution,
  today: string,
  mkId: () => string,
): ApplyPlan {
  if (isOneOffToday(workout, today)) {
    return {
      kind: 'mutate',
      workoutId: workout.id,
      beforeBlocks: clone(workout.blocks),
      afterBlocks: clone(resolution.resolvedWorkout.blocks),
    };
  }
  return {
    kind: 'fork',
    sourceWorkoutId: workout.id,
    forkedWorkoutId: mkId(),
    name: workout.name,
    workoutKind: workout.kind,
    date: today,
    blocks: clone(resolution.resolvedWorkout.blocks),
  };
}

export function ledgerEntryFromApply(
  plan: ApplyPlan,
  resolution: AutoCoachResolution,
  today: string,
): Omit<LedgerEntry, 'id' | 'at' | 'action'> {
  return {
    date: today,
    workoutId: plan.kind === 'mutate' ? plan.workoutId : plan.sourceWorkoutId,
    wasForked: plan.kind === 'fork',
    forkedWorkoutId: plan.kind === 'fork' ? plan.forkedWorkoutId : undefined,
    beforeBlocks: plan.kind === 'mutate' ? plan.beforeBlocks : undefined,
    operations: resolution.operations,
    reasonCodes: resolution.reasonCodes,
  };
}

export function canApply(resolution: AutoCoachResolution): boolean {
  if (resolution.state === 'safety_stop') return false;
  const hasChange = resolution.operations.some((o) => o.type !== 'keep_as_planned');
  if (!hasChange) return false;
  return resolution.autoApplyAllowed || resolution.requiresConfirmation;
}

export interface RestorePlan {
  kind: 'restore';
  workoutId: string;
  blocks: Block[];
}

export interface DeleteForkPlan {
  kind: 'delete-fork';
  workoutId: string;
}

export type UndoPlan = RestorePlan | DeleteForkPlan;

export function planUndo(entry: LedgerEntry): UndoPlan | null {
  if (entry.action !== 'applied') return null;
  if (entry.wasForked) {
    if (!entry.forkedWorkoutId) return null;
    return { kind: 'delete-fork', workoutId: entry.forkedWorkoutId };
  }
  if (entry.beforeBlocks === undefined) return null;
  return { kind: 'restore', workoutId: entry.workoutId, blocks: entry.beforeBlocks };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/applyResolution.test.ts`
Expected: PASS, all 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/autocoach/applyResolution.ts apps/mobile/src/autocoach/applyResolution.test.ts
git commit -m "feat(mobile): port auto-coach apply/undo planning"
```

---

### Task 6: `pendingProposal.ts` — mobile port

**Files:**
- Create: `apps/mobile/src/autocoach/pendingProposal.ts`
- Test: `apps/mobile/src/autocoach/pendingProposal.test.ts`

**Interfaces:**
- Consumes: `storage` from `../store/storage`; `AutoCoachResolution` from `@hybrid/auto-coach`.
- Produces: `PendingProposal` (type), `NewPendingProposal` (type), `usePendingProposal(): PendingProposal | null`, `getPendingProposal(): PendingProposal | null`, `proposePending(entry): PendingProposal`, `decidePending(status): void`, `withdrawPending(): void`, `resetPendingProposalForTests(): void`.

This is a byte-for-byte structural port of web's `pendingProposal.ts` (Task 1 of the web plan) with `localStorage` swapped for `storage`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/autocoach/pendingProposal.test.ts
import type { AutoCoachResolution } from '@hybrid/auto-coach';
import {
  decidePending,
  getPendingProposal,
  proposePending,
  resetPendingProposalForTests,
  withdrawPending,
  type NewPendingProposal,
} from './pendingProposal';

function fixtureResolution(): AutoCoachResolution {
  return {
    schemaVersion: 1,
    state: 'advisory',
    originalWorkoutId: 'w-1',
    resolvedWorkout: { id: 'w-1', name: 'Test', kind: 'strength', blocks: [] } as AutoCoachResolution['resolvedWorkout'],
    operations: [],
    signals: [],
    inferences: [],
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    requiresConfirmation: true,
    autoApplyAllowed: false,
    athleteMessage: 'Cap intensity today.',
  };
}

function fixtureEntry(over: Partial<NewPendingProposal> = {}): NewPendingProposal {
  return {
    date: '2026-08-09',
    sourceWorkoutId: 'w-1',
    sourceWorkoutUpdatedAt: 1000,
    resolution: fixtureResolution(),
    ...over,
  };
}

beforeEach(() => resetPendingProposalForTests());

describe('mobile pendingProposal store', () => {
  it('starts empty', () => {
    expect(getPendingProposal()).toBeNull();
  });

  it('proposePending creates a record with status pending', () => {
    proposePending(fixtureEntry());
    const p = getPendingProposal();
    expect(p?.status).toBe('pending');
    expect(p?.date).toBe('2026-08-09');
    expect(p?.sourceWorkoutId).toBe('w-1');
  });

  it('decidePending flips status to approved without touching other fields', () => {
    proposePending(fixtureEntry({ sourceWorkoutUpdatedAt: 42 }));
    decidePending('approved');
    const p = getPendingProposal();
    expect(p?.status).toBe('approved');
    expect(p?.sourceWorkoutUpdatedAt).toBe(42);
  });

  it('decidePending declined leaves status declined', () => {
    proposePending(fixtureEntry());
    decidePending('declined');
    expect(getPendingProposal()?.status).toBe('declined');
  });

  it('decidePending is a no-op when there is no proposal', () => {
    decidePending('approved');
    expect(getPendingProposal()).toBeNull();
  });

  it('withdrawPending clears the record entirely', () => {
    proposePending(fixtureEntry());
    withdrawPending();
    expect(getPendingProposal()).toBeNull();
  });

  it('a fresh proposePending call replaces any existing record, even a decided one', () => {
    proposePending(fixtureEntry({ date: '2026-08-08' }));
    decidePending('declined');
    proposePending(fixtureEntry({ date: '2026-08-09' }));
    const p = getPendingProposal();
    expect(p?.date).toBe('2026-08-09');
    expect(p?.status).toBe('pending');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/pendingProposal.test.ts`
Expected: FAIL — `Cannot find module './pendingProposal'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/autocoach/pendingProposal.ts
import { useSyncExternalStore } from 'react';
import type { AutoCoachResolution } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * The self-coach "propose, then decide" gate (docs/RISK_REGISTER.md R2),
 * ported from apps/web's pendingProposal.ts. Additive persistence: its own
 * storage key, never a field on EngineDB, invisible to sync — mirrors
 * ledger.ts/policy.ts/consent.ts. Holds at most one record. Date-matching
 * against "today" is the caller's job (SessionReceipt.tsx) — this store
 * never filters by date itself.
 */

export interface PendingProposal {
  date: string;
  sourceWorkoutId: string;
  sourceWorkoutUpdatedAt: number;
  /** frozen at propose time; approving applies THIS, never a fresh re-resolve */
  resolution: AutoCoachResolution;
  status: 'pending' | 'approved' | 'declined';
}

const KEY = 'hybrid-auto-coach-pending-v1';

interface PendingState {
  schemaVersion: 1;
  proposal: PendingProposal | null;
}

const empty = (): PendingState => ({ schemaVersion: 1, proposal: null });

let state: PendingState = load();
const listeners = new Set<() => void>();

function isValidProposal(p: unknown): p is PendingProposal {
  if (p === null) return true;
  if (typeof p !== 'object') return false;
  const c = p as Partial<PendingProposal>;
  return (
    typeof c.date === 'string' &&
    !!c.resolution &&
    (c.status === 'pending' || c.status === 'approved' || c.status === 'declined')
  );
}

function load(): PendingState {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as PendingState;
    if (parsed?.schemaVersion !== 1 || !isValidProposal(parsed.proposal)) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function persist(next: PendingState): void {
  state = next;
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage write failed — pending proposal stays session-local */
  }
  listeners.forEach((l) => l());
}

export function usePendingProposal(): PendingProposal | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.proposal,
  );
}

export function getPendingProposal(): PendingProposal | null {
  return state.proposal;
}

export type NewPendingProposal = Omit<PendingProposal, 'status'>;

export function proposePending(entry: NewPendingProposal): PendingProposal {
  const full: PendingProposal = { ...entry, status: 'pending' };
  persist({ schemaVersion: 1, proposal: full });
  return full;
}

export function decidePending(status: 'approved' | 'declined'): void {
  if (!state.proposal) return;
  persist({ schemaVersion: 1, proposal: { ...state.proposal, status } });
}

export function withdrawPending(): void {
  persist(empty());
}

export function resetPendingProposalForTests(): void {
  persist(empty());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/pendingProposal.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/autocoach/pendingProposal.ts apps/mobile/src/autocoach/pendingProposal.test.ts
git commit -m "feat(mobile): port auto-coach pending-proposal store"
```

---

### Task 7: `SessionReceipt.tsx` — mobile component, wired into `Home.tsx`

**Files:**
- Create: `apps/mobile/src/autocoach/SessionReceipt.tsx`
- Test: `apps/mobile/src/autocoach/SessionReceipt.test.tsx`
- Modify: `apps/mobile/src/screens/Home.tsx`

**Interfaces:**
- Consumes: `resolveSession` from `@hybrid/auto-coach`; `ymd, uid, tombstone` from `@hybrid/engine`; `useDb` from `../store/db`; `Card, Kicker, T, Tap` from `../ui`; `canApply, ledgerEntryFromApply, planApply, planUndo` from `./applyResolution` (Task 5); `canUndo, recordApply, recordUndo, useLedger` from `./ledger` (Task 2); `decidePending, proposePending, usePendingProposal, withdrawPending` from `./pendingProposal` (Task 6); `updatePolicy, usePolicy` from `./policy` (Task 3).
- Produces: `SessionReceipt(): JSX.Element | null`, a default export mounted in `Home.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/mobile/src/autocoach/SessionReceipt.test.tsx
import { render, fireEvent, screen } from '@testing-library/react-native';
import type { AutoCoachResolution } from '@hybrid/auto-coach';

jest.mock('@hybrid/auto-coach', () => ({
  ...jest.requireActual('@hybrid/auto-coach'),
  resolveSession: jest.fn(),
}));

import { resolveSession } from '@hybrid/auto-coach';
import { useDb } from '../store/db';
import { SessionReceipt } from './SessionReceipt';
import { resetPendingProposalForTests, getPendingProposal } from './pendingProposal';
import { resetLedgerForTests, getLedgerEntries } from './ledger';
import { resetPolicyForTests } from './policy';

jest.mock('../store/db', () => ({ useDb: jest.fn() }));

const mockResolveSession = resolveSession as jest.Mock;
const mockUseDb = useDb as jest.Mock;

const TODAY_WORKOUT = {
  id: 'w-1',
  name: 'Push Day',
  kind: 'strength' as const,
  blocks: [],
  dates: [new Date().toISOString().slice(0, 10)],
  updatedAt: 1000,
};

function baseResolution(over: Partial<AutoCoachResolution> = {}): AutoCoachResolution {
  return {
    schemaVersion: 1,
    state: 'advisory',
    originalWorkoutId: 'w-1',
    resolvedWorkout: { ...TODAY_WORKOUT },
    operations: [{ type: 'cap_intensity', before: '225', after: '205' } as never],
    signals: [{ text: 'Low HRV', quality: 'known' } as never],
    inferences: ['Capping intensity today'],
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    requiresConfirmation: true,
    autoApplyAllowed: false,
    athleteMessage: 'Capping intensity today.',
    ...over,
  };
}

let updateSpy: jest.Mock;

beforeEach(() => {
  resetPendingProposalForTests();
  resetLedgerForTests();
  resetPolicyForTests();
  updateSpy = jest.fn();
  mockUseDb.mockReturnValue({
    workouts: [TODAY_WORKOUT],
    update: updateSpy,
    athleteState: {},
  });
  mockResolveSession.mockReturnValue(baseResolution());
});

describe('mobile SessionReceipt', () => {
  it('renders nothing when there is no workout today', () => {
    mockUseDb.mockReturnValue({ workouts: [], update: updateSpy, athleteState: {} });
    const { toJSON } = render(<SessionReceipt />);
    expect(toJSON()).toBeNull();
  });

  it('auto-proposes an eligible resolution and shows Approve/Decline', () => {
    render(<SessionReceipt />);
    expect(getPendingProposal()?.status).toBe('pending');
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('Approve applies the frozen proposal and records the ledger entry', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Approve'));
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(getLedgerEntries()).toHaveLength(1);
    expect(getLedgerEntries()[0].action).toBe('applied');
    expect(getPendingProposal()?.status).toBe('approved');
  });

  it('Decline records declined without mutating the workout', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Decline'));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(getPendingProposal()?.status).toBe('declined');
  });

  it('withdraws a pending proposal when a fresh resolve turns safety_stop', () => {
    const { rerender } = render(<SessionReceipt />);
    expect(getPendingProposal()?.status).toBe('pending');
    mockResolveSession.mockReturnValue(baseResolution({ state: 'safety_stop' }));
    rerender(<SessionReceipt />);
    expect(getPendingProposal()).toBeNull();
  });

  it('does not show Approve/Decline once a proposal is already decided', () => {
    render(<SessionReceipt />);
    fireEvent.press(screen.getByText('Decline'));
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/SessionReceipt.test.tsx`
Expected: FAIL — `Cannot find module './SessionReceipt'`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/mobile/src/autocoach/SessionReceipt.tsx
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { resolveSession } from '@hybrid/auto-coach';
import { tombstone, uid, ymd, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Kicker, T, Tap } from '../ui';
import { canApply, ledgerEntryFromApply, planApply, planUndo } from './applyResolution';
import { canUndo, recordApply, recordUndo, useLedger } from './ledger';
import { decidePending, proposePending, usePendingProposal, withdrawPending } from './pendingProposal';
import { updatePolicy, usePolicy } from './policy';

/**
 * The Auto-Coached receipt for today's session, ported from
 * apps/web/src/autocoach/SessionReceipt.tsx. Signal, inference, action, with
 * the original always visible. An eligible resolution is PROPOSED
 * automatically (docs/RISK_REGISTER.md R2) — nothing applies until the
 * athlete taps Approve; Decline is always safe. "Today" here uses mobile's
 * local-time convention (ymd/getDay), matching Home.tsx/Training.tsx — not
 * web's UTC convention. See applyResolution.ts and pendingProposal.ts.
 */

function todaysWorkout(workouts: Workout[], today: string, dow: number): Workout | null {
  return (
    workouts.find((w) => w.dates?.includes(today)) ??
    workouts.find((w) => w.days?.includes(dow)) ??
    null
  );
}

const STATE_PILL: Record<string, { text: string; border: string }> = {
  normal: { text: 'text-muted', border: 'border-line2' },
  advisory: { text: 'text-gold2', border: 'border-gold-line' },
  uncertain: { text: 'text-warn', border: 'border-warn/40' },
  safety_stop: { text: 'text-bad', border: 'border-bad/40' },
};

function StatePill({ state, confidence }: { state: string; confidence: string }) {
  const tone = STATE_PILL[state] ?? STATE_PILL.normal;
  return (
    <View className={`ml-auto shrink-0 rounded-pill border px-1 py-0.5 ${tone.border}`}>
      <T w="bold" className={`text-2 uppercase tracking-wide ${tone.text}`}>
        {state.replace('_', ' ')} · {confidence}
      </T>
    </View>
  );
}

export function SessionReceipt({ compact }: { compact?: boolean }) {
  const { workouts, update, athleteState } = useDb();
  const policy = usePolicy();
  const ledger = useLedger();
  const pendingRaw = usePendingProposal();
  const today = ymd(new Date());
  const dow = new Date().getDay();
  const workout = useMemo(() => todaysWorkout(workouts, today, dow), [workouts, today, dow]);

  const r = useMemo(
    () => (workout ? resolveSession({ workout, policy, state: athleteState }) : null),
    [workout, policy, athleteState],
  );

  const pending = pendingRaw?.date === today ? pendingRaw : null;

  const latestToday = ledger.find((e) => e.date === today) ?? null;
  const appliedEntry = latestToday?.action === 'applied' ? latestToday : null;

  useEffect(() => {
    if (!workout || !r || appliedEntry) return;
    if (pending) {
      if (
        pending.status === 'pending' &&
        (r.state === 'safety_stop' ||
          pending.sourceWorkoutId !== workout.id ||
          pending.sourceWorkoutUpdatedAt !== (workout.updatedAt ?? 0) ||
          policy.status !== 'active')
      ) {
        withdrawPending();
      }
      return;
    }
    if (canApply(r)) {
      proposePending({
        date: today,
        sourceWorkoutId: workout.id,
        sourceWorkoutUpdatedAt: workout.updatedAt ?? 0,
        resolution: r,
      });
    }
  }, [workout, r, pending, appliedEntry, today]);

  if (!workout || policy.status === 'revoked' || !r) return null;

  const displayResolution = pending?.status === 'pending' ? pending.resolution : r;

  const changed = displayResolution.operations.some((o) => o.type !== 'keep_as_planned');
  if (compact && !changed) return null;

  const showDecide = pending?.status === 'pending';
  const showUndo = appliedEntry !== null && canUndo(appliedEntry);

  const handleApprove = () => {
    if (!pending || pending.status !== 'pending') return;
    if (
      r.state === 'safety_stop' ||
      pending.sourceWorkoutId !== workout.id ||
      pending.sourceWorkoutUpdatedAt !== (workout.updatedAt ?? 0) ||
      policy.status !== 'active'
    ) {
      withdrawPending();
      return;
    }
    const plan = planApply(workout, pending.resolution, today, uid);
    update((draft) => {
      if (plan.kind === 'mutate') {
        const target = draft.workouts.find((x) => x.id === plan.workoutId);
        if (!target) return false;
        target.blocks = plan.afterBlocks;
        target.updatedAt = Date.now();
      } else {
        draft.workouts.push({
          id: plan.forkedWorkoutId,
          name: plan.name,
          kind: plan.workoutKind,
          blocks: plan.blocks,
          dates: [plan.date],
          updatedAt: Date.now(),
        });
      }
    });
    recordApply(ledgerEntryFromApply(plan, pending.resolution, today));
    decidePending('approved');
  };

  const handleDecline = () => {
    if (!pending || pending.status !== 'pending') return;
    decidePending('declined');
  };

  const handleUndo = () => {
    if (!appliedEntry) return;
    const plan = planUndo(appliedEntry);
    if (!plan) return;
    update((draft) => {
      if (plan.kind === 'restore') {
        const target = draft.workouts.find((x) => x.id === plan.workoutId);
        if (!target) return false;
        target.blocks = plan.blocks;
        target.updatedAt = Date.now();
      } else {
        const i = draft.workouts.findIndex((x) => x.id === plan.workoutId);
        if (i >= 0) draft.workouts.splice(i, 1);
        tombstone(draft, plan.workoutId);
      }
    });
    recordUndo(appliedEntry);
  };

  const quiet = displayResolution.state === 'normal' && !changed;

  return (
    <Card
      tone={quiet ? 'quiet' : undefined}
      className={displayResolution.state === 'safety_stop' ? 'border-bad/40' : ''}
    >
      <View className="flex-row items-baseline gap-1">
        <Kicker>Auto-Coached · {policy.status === 'paused' ? 'paused' : policy.mode}</Kicker>
        <StatePill state={displayResolution.state} confidence={displayResolution.confidence} />
      </View>

      <T className="mt-1 text-3 text-text">{displayResolution.athleteMessage}</T>

      {changed && (
        <View className="mt-1">
          {displayResolution.operations
            .filter((o) => o.type !== 'keep_as_planned')
            .map((o, i) => (
              <View key={i} className="mt-0.5 rounded bg-well px-1 py-0.5">
                <T className="text-3 tabular-nums">
                  <T className="text-dim line-through">{o.before}</T>
                  <T className="text-muted"> → </T>
                  <T className="text-gold2">{o.after}</T>
                </T>
              </View>
            ))}
        </View>
      )}

      {appliedEntry && (
        <T className="mt-1 text-3 text-ok">
          Applied{appliedEntry.wasForked ? ' — today only, future sessions are unchanged' : ''} — undo
          available.
        </T>
      )}

      <View className="mt-1 flex-row items-center gap-1">
        <T className="flex-1 text-2 text-dim">
          {policy.mode === 'shadow'
            ? 'Shadow mode — shown, never applied. The plan itself is unchanged.'
            : 'Nothing applies without your confirmation.'}
        </T>
        <Tap
          onPress={() =>
            updatePolicy((p) => ({ ...p, status: p.status === 'paused' ? 'active' : 'paused' }))
          }
          className="shrink-0 rounded border border-line px-1 py-0.5"
        >
          <T className="text-3 text-muted">{policy.status === 'paused' ? 'Resume' : 'Pause'}</T>
        </Tap>
        {showDecide && (
          <>
            <Tap onPress={handleDecline} className="shrink-0 rounded border border-line px-1 py-0.5">
              <T className="text-3 text-muted">Decline</T>
            </Tap>
            <Tap onPress={handleApprove} className="shrink-0 rounded border border-gold-line bg-gold-wash px-1 py-0.5">
              <T className="text-3 text-gold2">Approve</T>
            </Tap>
          </>
        )}
        {showUndo && (
          <Tap onPress={handleUndo} className="shrink-0 rounded border border-line px-1 py-0.5">
            <T className="text-3 text-muted">Undo</T>
          </Tap>
        )}
      </View>
    </Card>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/SessionReceipt.test.tsx`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Wire `SessionReceipt` into `Home.tsx`**

In `apps/mobile/src/screens/Home.tsx`, add the import alongside the existing screen imports (near line 24, after `import { resolveDayTarget, sessionFrom } from '../store/session';`):

```tsx
import { SessionReceipt } from '../autocoach/SessionReceipt';
```

Then mount it right after the "Today's plan" block and before `<SectionHead title="Readiness" />` (the same relative position web uses — cause, then consequence, then the setting that governs future consequences):

```tsx
      <SessionReceipt />

      <SectionHead title="Readiness" />
```

- [ ] **Step 6: Run the mobile test suite and typecheck**

Run: `pnpm --filter @hybrid/mobile exec jest src/screens/screens.test.tsx src/autocoach`
Expected: PASS — confirms `Home.tsx` still renders with `SessionReceipt` mounted (screens.test.tsx smoke-renders every registered screen; if it mocks `@hybrid/auto-coach`'s `resolveSession`, verify the mock returns something `SessionReceipt` can render without throwing — if it does not currently mock that module, add a mock returning a `normal`-state resolution with no operations, so the smoke test exercises the "nothing to review, card recedes" path).

Run: `pnpm --filter @hybrid/mobile exec tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/autocoach/SessionReceipt.tsx apps/mobile/src/autocoach/SessionReceipt.test.tsx apps/mobile/src/screens/Home.tsx
git commit -m "feat(mobile): auto-coach session receipt with approve/decline, mounted on Home"
```

---

### Task 8: Mode switcher — new component wired into `Settings.tsx`

**Files:**
- Create: `apps/mobile/src/autocoach/ModeSwitcher.tsx`
- Test: `apps/mobile/src/autocoach/ModeSwitcher.test.tsx`
- Modify: `apps/mobile/src/screens/Settings.tsx`

**Interfaces:**
- Consumes: `AutonomyPolicy` from `@hybrid/auto-coach`; `Card, Kicker, T, Tap, Btn, SectionHead` from `../ui`; `allComprehensionCorrect, COMPREHENSION_STATEMENTS, CONSENT_TEXT_VERSION, highestAllowedMode, recordComprehensionPassed, recordConsent, useConsent` from `./consent` (Task 4); `updatePolicy, usePolicy` from `./policy` (Task 3).
- Produces: `ModeSwitcher(): JSX.Element`.

Web's `ModeSwitcher` uses `<details>`-free, always-inline `stage`-driven panels (`explain`/`quiz`/`autoApplyConsent`) — that structure ports directly to RN with no `<details>` substitution needed, since web never used `<details>` here (only `SessionReceipt`'s "Why" section did, which mobile's port above already dropped per the design note in Task 7 — the "Why — signals and inference" collapsible is intentionally omitted from the mobile v1 receipt to keep this plan's scope to what's specified; it can be added later as a `useState`-toggled block following the same `Tap`-driven pattern as `stage` here).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/mobile/src/autocoach/ModeSwitcher.test.tsx
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ModeSwitcher } from './ModeSwitcher';
import { resetConsentForTests, getConsent } from './consent';
import { resetPolicyForTests, getPolicy } from './policy';

beforeEach(() => {
  resetConsentForTests();
  resetPolicyForTests();
});

describe('mobile ModeSwitcher', () => {
  it('shows Shadow as the current mode initially', () => {
    render(<ModeSwitcher />);
    expect(screen.getByText('Shadow')).toBeTruthy();
  });

  it('starting the quiz and answering everything correctly advances to Assisted', () => {
    render(<ModeSwitcher />);
    fireEvent.press(screen.getByText('Turn on Assisted'));
    fireEvent.press(screen.getByText('Continue'));
    // Answer each statement per COMPREHENSION_STATEMENTS' known correct values
    const trueButtons = screen.getAllByText('True');
    const falseButtons = screen.getAllByText('False');
    fireEvent.press(trueButtons[0]); // statement 0: correct=true
    fireEvent.press(falseButtons[1]); // statement 1: correct=false
    fireEvent.press(falseButtons[2]); // statement 2: correct=false
    fireEvent.press(falseButtons[3]); // statement 3: correct=false
    fireEvent.press(trueButtons[4]); // statement 4: correct=true
    fireEvent.press(screen.getByText('Submit'));
    expect(getPolicy().mode).toBe('assisted');
    expect(getConsent().proposalsConsent?.accepted).toBe(true);
  });

  it('a wrong quiz answer shows the retry message and does not advance mode', () => {
    render(<ModeSwitcher />);
    fireEvent.press(screen.getByText('Turn on Assisted'));
    fireEvent.press(screen.getByText('Continue'));
    const trueButtons = screen.getAllByText('True');
    // Answer all 5 as True (statements 1-3 are actually false, so this is wrong)
    for (let i = 0; i < 5; i++) fireEvent.press(screen.getAllByText('True')[i] ?? trueButtons[0]);
    fireEvent.press(screen.getByText('Submit'));
    expect(screen.getByText(/Not quite/)).toBeTruthy();
    expect(getPolicy().mode).toBe('shadow');
  });

  it('Cancel returns to idle without recording any consent', () => {
    render(<ModeSwitcher />);
    fireEvent.press(screen.getByText('Turn on Assisted'));
    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.getByText('Turn on Assisted')).toBeTruthy();
    expect(getConsent().proposalsConsent).toBeNull();
  });

  it('revoking proposals consent clamps mode back to shadow', () => {
    recordConsentHelper();
    render(<ModeSwitcher />);
    fireEvent.press(screen.getByText('Revoke reading & proposing'));
    expect(getPolicy().mode).toBe('shadow');
  });
});

function recordConsentHelper() {
  const { recordConsent } = jest.requireActual('./consent');
  const { updatePolicy } = jest.requireActual('./policy');
  recordConsent('proposals', true);
  updatePolicy((p: import('@hybrid/auto-coach').AutonomyPolicy) => ({ ...p, mode: 'assisted' }));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/ModeSwitcher.test.tsx`
Expected: FAIL — `Cannot find module './ModeSwitcher'`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/mobile/src/autocoach/ModeSwitcher.tsx
import { useState } from 'react';
import { View } from 'react-native';
import type { AutonomyPolicy } from '@hybrid/auto-coach';
import { Btn, Card, Kicker, T, Tap } from '../ui';
import {
  allComprehensionCorrect,
  COMPREHENSION_STATEMENTS,
  CONSENT_TEXT_VERSION,
  highestAllowedMode,
  recordComprehensionPassed,
  recordConsent,
  useConsent,
} from './consent';
import { updatePolicy, usePolicy } from './policy';

/**
 * Where the athlete changes Auto-Coached mode on mobile, ported from
 * apps/web/src/autocoach/ModeSwitcher.tsx. Forward movement (shadow →
 * assisted → auto_daily) is gated by consent — a comprehension check the
 * first time, a shorter one-sentence consent the second. Backward movement
 * and pausing need neither.
 */

const MODE_LABEL: Record<AutonomyPolicy['mode'], string> = {
  shadow: 'Shadow',
  assisted: 'Assisted',
  auto_daily: 'Auto-Coached Daily',
};

const MODE_DESCRIPTION: Record<AutonomyPolicy['mode'], string> = {
  shadow: 'Shows what it would do. Nothing is ever applied.',
  assisted: 'Proposes changes to today. You confirm before anything applies.',
  auto_daily:
    'Suggests permitted changes to today automatically — nothing applies until you approve it. Review stays available; pause is one tap.',
};

type Stage = 'idle' | 'explain' | 'quiz' | 'autoApplyConsent';

export function ModeSwitcher() {
  const policy = usePolicy();
  const consent = useConsent();
  const [stage, setStage] = useState<Stage>('idle');
  const [answers, setAnswers] = useState<(boolean | null)[]>(() =>
    Array(COMPREHENSION_STATEMENTS.length).fill(null),
  );
  const [showRetry, setShowRetry] = useState(false);

  const resetQuiz = () => {
    setAnswers(Array(COMPREHENSION_STATEMENTS.length).fill(null));
    setShowRetry(false);
  };

  const cancel = () => {
    setStage('idle');
    resetQuiz();
  };

  const submitQuiz = () => {
    if (allComprehensionCorrect(answers)) {
      recordComprehensionPassed(true);
      recordConsent('proposals', true);
      updatePolicy((p) => ({ ...p, mode: 'assisted' }));
      setStage('idle');
      resetQuiz();
    } else {
      setShowRetry(true);
    }
  };

  const acceptAutoApply = () => {
    recordConsent('autoApply', true);
    updatePolicy((p) => ({ ...p, mode: 'auto_daily' }));
    setStage('idle');
  };

  const revokeProposals = () => {
    recordConsent('proposals', false);
    updatePolicy((p) => ({
      ...p,
      mode: highestAllowedMode({
        proposalsConsent: { accepted: false, at: Date.now(), textVersion: CONSENT_TEXT_VERSION },
        autoApplyConsent: consent.autoApplyConsent,
      }),
    }));
  };

  const revokeAutoApply = () => {
    recordConsent('autoApply', false);
    updatePolicy((p) => ({
      ...p,
      mode: highestAllowedMode({
        proposalsConsent: consent.proposalsConsent,
        autoApplyConsent: { accepted: false, at: Date.now(), textVersion: CONSENT_TEXT_VERSION },
      }),
    }));
  };

  const allAnswered = answers.every((a) => a !== null);

  return (
    <Card tone={stage === 'idle' ? 'quiet' : undefined}>
      <View className="flex-row items-baseline gap-1">
        <Kicker>Auto-Coached mode</Kicker>
        <T w="bold" className="ml-auto text-3 text-gold2">{MODE_LABEL[policy.mode]}</T>
      </View>
      <T className="mt-1 text-3 text-muted">{MODE_DESCRIPTION[policy.mode]}</T>

      {stage === 'idle' && (
        <View className="mt-1 flex-row flex-wrap items-center gap-1">
          {policy.mode === 'shadow' && (
            <Btn variant="brass" onPress={() => setStage('explain')}>
              Turn on Assisted
            </Btn>
          )}
          {policy.mode === 'assisted' && (
            <>
              <Btn variant="ghost" onPress={() => updatePolicy((p) => ({ ...p, mode: 'shadow' }))}>
                Back to Shadow
              </Btn>
              <Btn variant="brass" onPress={() => setStage('autoApplyConsent')}>
                Turn on Auto-Coached Daily
              </Btn>
            </>
          )}
          {policy.mode === 'auto_daily' && (
            <Btn variant="ghost" onPress={() => updatePolicy((p) => ({ ...p, mode: 'assisted' }))}>
              Back to Assisted
            </Btn>
          )}
        </View>
      )}

      {stage === 'explain' && (
        <View className="mt-1 rounded-md border border-line bg-well p-1.5">
          <T className="text-3 text-text">
            · It can make small changes to today's session, like capping intensity or trimming
            conditioning minutes, when your check-in supports it.
          </T>
          <T className="mt-0.5 text-3 text-text">
            · It cannot diagnose anything, override a safety flag, or change your long-term goal.
          </T>
          <T className="mt-0.5 text-3 text-text">
            · You choose what it's allowed to touch, and you can pause it any time from the receipt.
          </T>
          <View className="mt-1 flex-row items-center gap-1">
            <Tap onPress={cancel}>
              <T className="text-3 text-dim underline">Cancel</T>
            </Tap>
            <Btn variant="brass" className="ml-auto" onPress={() => setStage('quiz')}>
              Continue
            </Btn>
          </View>
        </View>
      )}

      {stage === 'quiz' && (
        <View className="mt-1 rounded-md border border-line bg-well p-1.5">
          <T className="text-3 text-dim">Quick check — true or false.</T>
          {COMPREHENSION_STATEMENTS.map((s, i) => (
            <View key={i} className="mt-1 flex-row flex-wrap items-center gap-1">
              <T className="text-3 text-text">{s.text}</T>
              {([true, false] as const).map((v) => (
                <Tap
                  key={String(v)}
                  onPress={() => setAnswers((cur) => cur.map((a, ai) => (ai === i ? v : a)))}
                  className={`rounded-pill border px-1 py-0.5 ${
                    answers[i] === v ? 'border-gold-line' : 'border-line'
                  }`}
                >
                  <T className={`text-3 ${answers[i] === v ? 'text-gold2' : 'text-muted'}`}>
                    {v ? 'True' : 'False'}
                  </T>
                </Tap>
              ))}
            </View>
          ))}
          {showRetry && <T className="mt-1 text-3 text-warn">Not quite — let's go over that again.</T>}
          <View className="mt-1 flex-row items-center gap-1">
            <Tap onPress={cancel}>
              <T className="text-3 text-dim underline">Cancel</T>
            </Tap>
            <Btn variant="brass" className="ml-auto" onPress={submitQuiz} disabled={!allAnswered}>
              Submit
            </Btn>
          </View>
        </View>
      )}

      {stage === 'autoApplyConsent' && (
        <View className="mt-1 rounded-md border border-line bg-well p-1.5">
          <T className="text-3 text-text">
            Permitted changes will be suggested for today's session and applied only once you
            approve them — review is always available, and pausing is one tap.
          </T>
          <View className="mt-1 flex-row items-center gap-1">
            <Tap onPress={cancel}>
              <T className="text-3 text-dim underline">Cancel</T>
            </Tap>
            <Btn variant="brass" className="ml-auto" onPress={acceptAutoApply}>
              Agree and turn on
            </Btn>
          </View>
        </View>
      )}

      {(consent.proposalsConsent?.accepted || consent.autoApplyConsent?.accepted) && (
        <View className="mt-1 flex-row flex-wrap items-center gap-1 border-t border-line pt-1">
          <T className="text-2 uppercase tracking-wide text-dim">Consent</T>
          {consent.proposalsConsent?.accepted && (
            <Tap onPress={revokeProposals}>
              <T className="text-3 text-dim underline">Revoke reading & proposing</T>
            </Tap>
          )}
          {consent.autoApplyConsent?.accepted && (
            <Tap onPress={revokeAutoApply}>
              <T className="text-3 text-dim underline">Revoke automatic application</T>
            </Tap>
          )}
        </View>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/mobile exec jest src/autocoach/ModeSwitcher.test.tsx`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Wire `ModeSwitcher` into `Settings.tsx`**

In `apps/mobile/src/screens/Settings.tsx`, add the import alongside existing imports (near line 27):

```tsx
import { ModeSwitcher } from '../autocoach/ModeSwitcher';
```

Add a new section — find the screen's outer `<ScrollView>`/section list (the file's `SectionHead`/`Card` blocks, same pattern as `Home.tsx`) and add, as its own section, near the end of the existing sections (after account/data sections, before any final "About" section if one exists — placement only needs to be a coherent new section, not interleaved with unrelated settings):

```tsx
      <SectionHead title="Auto-Coached" />
      <ModeSwitcher />
```

- [ ] **Step 6: Run the mobile test suite and typecheck**

Run: `pnpm --filter @hybrid/mobile exec jest`
Expected: PASS, full suite green (this also re-runs `screens.test.tsx`, confirming `Settings.tsx` still smoke-renders with `ModeSwitcher` mounted).

Run: `pnpm --filter @hybrid/mobile exec tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/autocoach/ModeSwitcher.tsx apps/mobile/src/autocoach/ModeSwitcher.test.tsx apps/mobile/src/screens/Settings.tsx
git commit -m "feat(mobile): auto-coach mode switcher, mounted on Settings"
```

---

### Task 9: Full verification and handoff notes

**Files:**
- Modify: `docs/RISK_REGISTER.md` (append a short note; the mobile port doesn't change the R2 risk analysis itself, which is platform-agnostic, but the register should record that the gate is now live on both platforms).

- [ ] **Step 1: Run the whole workspace's checks**

```bash
pnpm run typecheck
pnpm run test
pnpm run check:ecosystem
pnpm --filter @hybrid/mobile exec jest
pnpm --filter @hybrid/mobile typecheck
```

Expected: everything PASS. `pnpm run test` re-runs the web suite too — confirms this plan touched nothing under `apps/web`.

- [ ] **Step 2: Bundle-check the mobile app**

Run: `pnpm --filter @hybrid/mobile exec expo export --platform android --output-dir .expo-export`
Expected: exports cleanly — proves the new `apps/mobile/src/autocoach/*` files parse and bundle correctly through Metro, the same canary check `CLAUDE.md`'s test-colocation section describes for confirming nothing test-shaped leaks into a shipped artifact. Delete `.expo-export` afterward (`rm -rf apps/mobile/.expo-export`) — it's a verification artifact, not a checked-in build.

- [ ] **Step 3: Update `docs/RISK_REGISTER.md`**

Find R2's entry and add one sentence noting mobile parity, e.g. directly under wherever R2's "resolved" status is recorded on web:

```markdown
Ported to `apps/mobile` (2026-08-09): the same propose-then-decide gate,
policy, consent and ledger now exist on mobile
(`apps/mobile/src/autocoach/*`), independently persisted (mobile and web
keep separate storage — this was never a shared/synced concept on either
platform) but structurally identical and covered by the same test
discipline.
```

- [ ] **Step 4: Commit**

```bash
git add docs/RISK_REGISTER.md
git commit -m "docs: record mobile parity for the self-coach approval gate (R2)"
```

- [ ] **Step 5: Push**

```bash
git push -u origin claude/handoff-md-review-z00wqf
```
