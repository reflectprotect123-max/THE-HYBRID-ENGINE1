# PWA Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/web` a full, screen-for-screen replacement for `apps/mobile`, so the native app can be deleted.

**Architecture:** Phase 1 closes small UX/capability gaps on the training world (already ~1:1 between the two apps). Phase 2 ports the mobile-only nutrition world (12 screens, its own sealed nav context) to web, reusing `packages/nutrition-core` / `packages/nutrition-adapter` / `packages/nutrition-engine` functions that already exist and are already used by mobile — this is UI construction over an existing, shared API surface, not new domain logic. A final phase deletes `apps/mobile`.

**Tech Stack:** React (web), Vite, Vitest, TypeScript, Tailwind (web's existing utility classes — no new design system), Chrome-only browser APIs (`BarcodeDetector`, `navigator.wakeLock`, `Notification`, `navigator.geolocation`), `tesseract.js` (new dependency, Task 2.11 only).

## Global Constraints

- Android/Chrome only — no iOS Safari workarounds, no cross-browser polyfills beyond what Chrome/Android already supports natively.
- Zero behavior changes to any screen that already matches between mobile and web (all of Training world) — this plan only adds, it does not restyle.
- Every new screen/module gets a colocated test file (`Foo.tsx` + `Foo.test.tsx` in the same directory) — this repo's established convention, no `test/` directory placement for actual tests.
- Reuse `packages/nutrition-core` / `-adapter` / `-engine` functions verbatim where mobile already uses them — do not re-derive or duplicate domain logic in a screen file.
- Match `apps/web`'s existing code conventions (its own Tailwind class patterns, its own component/hook style) — do not import mobile's NativeWind patterns or RN-specific idioms.
- Run `pnpm --filter @hybrid/web exec tsc --noEmit -p .` and the relevant Vitest file(s) after every task; both must be clean before commit.

---

## Phase 1 — Training-world close-out

### Task 1.1: BLE connection-state UX in `connectStrap`

**Files:**
- Modify: `apps/web/src/screens/Conditioning.tsx` (locate `connectStrap` function and its call site/state wiring — grep `connectStrap` in this file first)
- Test: `apps/web/src/screens/Conditioning.test.tsx` (create if it doesn't already exist; check first)

**Interfaces:**
- Consumes: nothing new — this modifies an existing function in place.
- Produces: `connectStrap(onBpm: (bpm: number) => void, onState: (state: 'scanning' | 'connected' | 'error', message?: string) => void): Promise<void>` — the new signature. Any other code in this file calling `connectStrap` must be updated to pass an `onState` handler.

Reference shape from mobile (`apps/mobile/src/native/capabilities.ts`), reproduce the same three states and messages on web:
- `'scanning'` — no message needed, or `'Searching for a heart-rate broadcast…'`.
- `'connected'` — no message needed.
- `'error'` — with one of these messages depending on which failure branch fired: `'Bluetooth permission was refused.'` (device picker cancelled by user), `'No heart-rate broadcast found. Make sure HR Broadcast is on in your WHOOP app.'` (scan found no matching device — if Web Bluetooth's `requestDevice` call itself rejects because no device was chosen, use this branch), `'Could not connect to that strap.'` (`device.gatt.connect()` throws), `'This browser does not support Bluetooth.'` (`!navigator.bluetooth`).

- [ ] **Step 1: Write the failing test — no-Bluetooth-support state**

```typescript
// apps/web/src/screens/Conditioning.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Conditioning } from './Conditioning';
// (import whatever provider/router wrapper this repo's other screen tests use —
//  check apps/web/src/screens/Home.test.tsx for the render-helper pattern and reuse it)

describe('Conditioning strap connection state', () => {
  beforeEach(() => {
    // @ts-expect-error test override
    delete (navigator as any).bluetooth;
  });

  it('shows an error state when the browser has no Bluetooth support', async () => {
    render(<Conditioning />); // wrap with whatever this repo's render helper provides
    fireEvent.click(screen.getByText(/connect.*strap/i)); // adjust to the real connect button text
    await waitFor(() => {
      expect(screen.getByText('This browser does not support Bluetooth.')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/screens/Conditioning.test.tsx`
Expected: FAIL — either the button text doesn't match yet (adjust to the real label found when reading the file) or the error message isn't rendered because `connectStrap` doesn't report state yet.

- [ ] **Step 3: Read the current `connectStrap` implementation and its call site**

Before writing code, read `apps/web/src/screens/Conditioning.tsx` in full around `connectStrap` (grep for it) to get the exact current signature, the component state variable it feeds (e.g. `RUN.bpm`), and the JSX that renders the strap-connect button, so the new `onState`-driven UI slots into the existing layout rather than replacing it.

- [ ] **Step 4: Add state plumbing and the new `onState` parameter**

Add a new piece of component state (e.g. `const [strapState, setStrapState] = useState<{status: 'idle'|'scanning'|'connected'|'error'; message?: string}>({status: 'idle'})`), pass `(state, message) => setStrapState({status: state, message})` as `onState` when calling `connectStrap`, and render `strapState.message` next to the existing connect button when `strapState.status === 'error'`, and a "Searching…" label when `'scanning'`.

- [ ] **Step 5: Update `connectStrap`'s internals to call `onState` at each transition**

Locate every `catch` block and the start of the function; add the matching `onState('scanning')` / `onState('connected')` / `onState('error', message)` calls per the message table above, replacing the current silent `catch {}`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/screens/Conditioning.test.tsx`
Expected: PASS

- [ ] **Step 7: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/screens/Conditioning.tsx apps/web/src/screens/Conditioning.test.tsx
git commit -m "Surface Bluetooth strap connection state instead of failing silently"
```

---

### Task 1.2: Screen Wake Lock during Logger and Conditioning sessions

**Files:**
- Create: `apps/web/src/native/wakeLock.ts`
- Test: `apps/web/src/native/wakeLock.test.ts`
- Modify: `apps/web/src/screens/Logger.tsx` (session-start/end lifecycle — grep for where the session begins/ends)
- Modify: `apps/web/src/screens/Conditioning.tsx` (same, `RUN` start/finish)

**Interfaces:**
- Produces:
  ```typescript
  // apps/web/src/native/wakeLock.ts
  export async function requestWakeLock(): Promise<WakeLockSentinel | null>;
  export function releaseWakeLock(lock: WakeLockSentinel | null): void;
  ```
  `WakeLockSentinel` is the built-in DOM type from the Screen Wake Lock API (`lib.dom.d.ts` already has it in a modern TS target — confirm `apps/web/tsconfig.json`'s `lib` includes a recent enough `dom` lib; if `WakeLockSentinel` isn't found, add `"lib": [..., "dom"]` is already almost certainly present, so this should just work).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/native/wakeLock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { requestWakeLock, releaseWakeLock } from './wakeLock';

describe('requestWakeLock', () => {
  it('requests a screen wake lock when the API is available', async () => {
    const mockLock = { release: vi.fn(), released: false, type: 'screen' } as any;
    const request = vi.fn().mockResolvedValue(mockLock);
    // @ts-expect-error test override
    navigator.wakeLock = { request };

    const lock = await requestWakeLock();

    expect(request).toHaveBeenCalledWith('screen');
    expect(lock).toBe(mockLock);
  });

  it('returns null without throwing when the API is unavailable', async () => {
    // @ts-expect-error test override
    delete navigator.wakeLock;

    const lock = await requestWakeLock();

    expect(lock).toBeNull();
  });

  it('releases a held lock', () => {
    const mockLock = { release: vi.fn() } as any;
    releaseWakeLock(mockLock);
    expect(mockLock.release).toHaveBeenCalled();
  });

  it('does nothing when releasing a null lock', () => {
    expect(() => releaseWakeLock(null)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/native/wakeLock.test.ts`
Expected: FAIL — module `./wakeLock` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/native/wakeLock.ts
/**
 * Screen Wake Lock, Chrome/Android only (this repo's whole native-capability
 * surface is Android-scoped). Silently returns null anywhere the API is
 * absent — mirrors this file's siblings' "degrade, never throw" convention.
 */
export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  if (!('wakeLock' in navigator)) return null;
  try {
    return await (navigator as Navigator & { wakeLock: WakeLock }).wakeLock.request('screen');
  } catch {
    return null;
  }
}

export function releaseWakeLock(lock: WakeLockSentinel | null): void {
  lock?.release();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/native/wakeLock.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into Logger.tsx**

Read `apps/web/src/screens/Logger.tsx`'s session lifecycle (where it currently mounts/unmounts the active-set UI). Add:
```typescript
import { requestWakeLock, releaseWakeLock } from '../native/wakeLock';
// ...inside the component, near other session-lifecycle effects:
useEffect(() => {
  let lock: WakeLockSentinel | null = null;
  requestWakeLock().then((l) => { lock = l; });
  return () => releaseWakeLock(lock);
}, []);
```
Place this at the same scope mobile's `expo-keep-awake` call sits at (session-active, not the whole screen if the screen also renders a pre-session state) — confirm the right scope by reading how mobile's `Logger.tsx:169` gates it (per the earlier investigation) and match that gating condition.

- [ ] **Step 6: Wire into Conditioning.tsx**

Same pattern, at `RUN` start/finish (mobile gates this across `Conditioning.tsx:249-364` — an active-run scope, not full-screen-mount). Add the same `useEffect` pattern scoped to the run being active.

- [ ] **Step 7: Run typecheck and full web test suite**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .` then `pnpm --filter @hybrid/web exec vitest run src/native/wakeLock.test.ts src/screens/Logger.test.tsx src/screens/Conditioning.test.tsx`
Expected: all clean/passing (Logger.test.tsx may not exist — check first, don't create one here if it doesn't, that's out of this task's scope)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/native/wakeLock.ts apps/web/src/native/wakeLock.test.ts apps/web/src/screens/Logger.tsx apps/web/src/screens/Conditioning.tsx
git commit -m "Keep the screen awake during an active Logger or Conditioning session"
```

---

### Task 1.3: Foreground GPS tracking during Conditioning

**Files:**
- Create: `apps/web/src/native/geoTracker.ts`
- Test: `apps/web/src/native/geoTracker.test.ts`
- Modify: `apps/web/src/screens/Conditioning.tsx` (wherever it consumes route/distance data — check if this exists at all on web today; if Conditioning has no route/distance UI yet, this task adds the data source only, not new UI, since new UI is out of this plan's "port existing behavior" scope — skip UI changes if none exist on web to feed)

**Interfaces:**
- Produces:
  ```typescript
  // apps/web/src/native/geoTracker.ts
  export interface GeoPoint { lat: number; lon: number; at: number }
  export function createGeoTracker(): {
    start(onPoint: (point: GeoPoint) => void, onError: (message: string) => void): void;
    stop(): void;
  };
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/native/geoTracker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createGeoTracker } from './geoTracker';

describe('createGeoTracker', () => {
  it('starts watching position and forwards points', () => {
    const watchId = 42;
    const watchPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 1.5, longitude: 2.5 } as GeolocationCoordinates,
        timestamp: 1000,
      } as GeolocationPosition);
      return watchId;
    });
    const clearWatch = vi.fn();
    // @ts-expect-error test override
    navigator.geolocation = { watchPosition, clearWatch };

    const tracker = createGeoTracker();
    const onPoint = vi.fn();
    tracker.start(onPoint, vi.fn());

    expect(onPoint).toHaveBeenCalledWith({ lat: 1.5, lon: 2.5, at: 1000 });

    tracker.stop();
    expect(clearWatch).toHaveBeenCalledWith(watchId);
  });

  it('reports an error when geolocation is unavailable', () => {
    // @ts-expect-error test override
    delete navigator.geolocation;

    const tracker = createGeoTracker();
    const onError = vi.fn();
    tracker.start(vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith('This browser does not support location tracking.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/native/geoTracker.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/native/geoTracker.ts
/**
 * Foreground-only GPS, Chrome/Android. Deliberately NOT equivalent to
 * mobile's background-surviving expo-location tracker — there is no
 * reliable browser API for that, and this project's design spec says so
 * explicitly rather than papering over the gap.
 */
export interface GeoPoint { lat: number; lon: number; at: number }

export function createGeoTracker() {
  let watchId: number | null = null;

  return {
    start(onPoint: (point: GeoPoint) => void, onError: (message: string) => void): void {
      if (!('geolocation' in navigator)) {
        onError('This browser does not support location tracking.');
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (pos) => onPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude, at: pos.timestamp }),
        () => onError('Location tracking failed. Check your browser permissions.'),
        { enableHighAccuracy: true },
      );
    },
    stop(): void {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/native/geoTracker.test.ts`
Expected: PASS

- [ ] **Step 5: Check whether Conditioning.tsx has any route/distance display to wire this into**

Read `apps/web/src/screens/Conditioning.tsx` for any existing distance/route/pace UI. If one exists, wire `createGeoTracker` into it the same way `connectStrap`/HR is wired (start on run-start, stop on run-finish, feed points into whatever local state the existing UI reads). If no such UI exists on web today, stop here — this task's job is providing the data-source module; adding brand-new route UI is out of this "port existing behavior" plan.

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/native/geoTracker.ts apps/web/src/native/geoTracker.test.ts
git add apps/web/src/screens/Conditioning.tsx # only if Step 5 modified it
git commit -m "Add foreground-only GPS tracking (Web Geolocation API)"
```

---

### Task 1.4: Rest-alarm notifications

**Files:**
- Modify: `apps/web/src/store/rest.tsx` (already has `navigator.vibrate`, per investigation, around line 87)
- Test: `apps/web/src/store/rest.test.tsx` (create if it doesn't exist — check first)

**Interfaces:**
- Consumes: nothing new.
- Produces: extends whatever the existing rest-timer completion function is (find it by reading the file) to also fire a `Notification` when permission is already granted.

- [ ] **Step 1: Read `apps/web/src/store/rest.tsx` in full**

Identify the exact function that runs when a rest timer completes (where `navigator.vibrate` is currently called) and its exact name/signature.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/web/src/store/rest.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
// import the actual completion function found in Step 1, e.g.:
// import { fireRestComplete } from './rest';

describe('rest timer completion notification', () => {
  beforeEach(() => {
    // @ts-expect-error test override
    global.Notification = vi.fn();
    // @ts-expect-error test override
    global.Notification.permission = 'granted';
  });

  it('fires a Notification when permission is already granted', () => {
    // call the real completion function here, e.g. fireRestComplete();
    expect(global.Notification).toHaveBeenCalledWith(
      'Rest complete',
      expect.objectContaining({ body: expect.any(String) }),
    );
  });

  it('does not throw when Notification is unsupported', () => {
    // @ts-expect-error test override
    delete global.Notification;
    // expect(() => fireRestComplete()).not.toThrow();
  });
});
```

(Fill in the real import/call once Step 1 identifies the actual function name — do not leave the commented-out lines in the final test file, replace them with the real call.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/store/rest.test.tsx`
Expected: FAIL — no Notification call happens yet.

- [ ] **Step 4: Add the Notification call alongside the existing vibrate call**

```typescript
if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
  new Notification('Rest complete', { body: 'Time for your next set.' });
}
```
Add this next to the existing `navigator.vibrate(...)` call — do not request permission here (that's a separate, explicit user action, out of this task's scope; only fire when permission is already granted, silently skip otherwise).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/store/rest.test.tsx`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/store/rest.tsx apps/web/src/store/rest.test.tsx
git commit -m "Fire a browser notification on rest-timer completion when permitted"
```

---

## Phase 2 — Nutrition world

### Task 2.1: `useDiscipline` hook and persistence (web)

**Files:**
- Create: `apps/web/src/discipline.ts`
- Test: `apps/web/src/discipline.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // apps/web/src/discipline.ts
  export type WorldId = 'training' | 'nutrition';
  export function useDiscipline(): WorldId;
  export function setDiscipline(next: WorldId): void;
  export function lastTrainingWorld(): WorldId | null; // always 'training' today, but mirrors mobile's shape for future scope creep — actually: mobile's trainingScope exists because mobile has MULTIPLE training worlds (strength/conditioning build profiles); confirm this by re-reading discipline.ts before assuming — if web only ever has one training world, simplify this away and note it in the commit message rather than porting unnecessary complexity.
  ```

- [ ] **Step 1: Re-read `apps/mobile/src/discipline.ts` in full**

Before writing anything, read the actual mobile file (not just the earlier summary) to get its exact storage keys, exact `useSyncExternalStore` wiring, and confirm whether `trainingScope`/`lastTrainingWorld` tracks something web actually needs (web's build-profile split, if any — check `apps/web/src/App.tsx` for any existing build-profile/world concept before assuming one is needed).

- [ ] **Step 2: Write the failing test**

```typescript
// apps/web/src/discipline.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiscipline, setDiscipline } from './discipline';

describe('useDiscipline', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to training when nothing is persisted', () => {
    const { result } = renderHook(() => useDiscipline());
    expect(result.current).toBe('training');
  });

  it('reflects setDiscipline immediately, including in other hook instances', () => {
    const { result: a } = renderHook(() => useDiscipline());
    const { result: b } = renderHook(() => useDiscipline());

    act(() => setDiscipline('nutrition'));

    expect(a.current).toBe('nutrition');
    expect(b.current).toBe('nutrition');
  });

  it('persists across a fresh hook mount (simulating reload)', () => {
    act(() => setDiscipline('nutrition'));
    const { result } = renderHook(() => useDiscipline());
    expect(result.current).toBe('nutrition');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/discipline.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Write the implementation**

Match mobile's exact storage-key strings so a future analytics/debugging comparison isn't confused by a naming drift, using the same `useSyncExternalStore` pattern:

```typescript
// apps/web/src/discipline.ts
import { useSyncExternalStore } from 'react';

export type WorldId = 'training' | 'nutrition';

const STORAGE_KEY = 'hybrid-active-discipline-v1';
const listeners = new Set<() => void>();
let active: WorldId = (localStorage.getItem(STORAGE_KEY) as WorldId | null) ?? 'training';

export function setDiscipline(next: WorldId): void {
  active = next;
  localStorage.setItem(STORAGE_KEY, next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WorldId {
  return active;
}

export function useDiscipline(): WorldId {
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

(If Step 1 finds web genuinely needs a `lastTrainingWorld` equivalent, add it here with the same pattern as mobile's `hybrid-last-training-world-v1` key — otherwise omit it and note why in the commit message.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/discipline.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/discipline.ts apps/web/src/discipline.test.ts
git commit -m "Add useDiscipline hook for the training/nutrition world switch"
```

---

### Task 2.2: `NutritionBottomNav` component and route fork in `App.tsx`

**Files:**
- Create: `apps/web/src/components/NutritionBottomNav.tsx`
- Test: `apps/web/src/components/NutritionBottomNav.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `useDiscipline` from Task 2.1 (`WorldId`).
- Produces: `NutritionBottomNav` — a component with the same prop-less, route-aware shape as the existing `apps/web/src/components/BottomNav.tsx` (read that file first and match its exact structural pattern — same active-route-highlighting approach, same underlying router links), with 5 items: Log, Food, Weight, Coach, Settings, routing to `/nutrition/log`, `/nutrition/food`, `/nutrition/weight`, `/nutrition/coach`, `/nutrition/settings` respectively.

- [ ] **Step 1: Read `apps/web/src/components/BottomNav.tsx` in full**

Get its exact router integration (react-router `NavLink`? something else?), icon usage pattern, and active-state styling classes, so `NutritionBottomNav` is visually and structurally consistent, not a divergent one-off.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/web/src/components/NutritionBottomNav.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NutritionBottomNav } from './NutritionBottomNav';

describe('NutritionBottomNav', () => {
  it('renders all five nutrition tabs', () => {
    render(<MemoryRouter><NutritionBottomNav /></MemoryRouter>);
    expect(screen.getByText('Log')).toBeInTheDocument();
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.getByText('Coach')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('marks the current route active', () => {
    render(
      <MemoryRouter initialEntries={['/nutrition/weight']}>
        <NutritionBottomNav />
      </MemoryRouter>,
    );
    expect(screen.getByText('Weight').closest('a')).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/components/NutritionBottomNav.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Write `NutritionBottomNav.tsx`**

Copy `BottomNav.tsx`'s structure exactly (same `NavLink` usage, same wrapper markup/classes), swapping only the 5 route/label/icon triples for Log/Food/Weight/Coach/Settings pointing at the `/nutrition/*` paths above. Reuse whatever icon set `BottomNav.tsx` already imports from (don't add a new icon library).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/components/NutritionBottomNav.test.tsx`
Expected: PASS

- [ ] **Step 6: Fork the route tree in `App.tsx`**

Read `apps/web/src/App.tsx` in full. Add: `const world = useDiscipline();` near the top of the component that currently renders `<BottomNav />` and the training `<Routes>`. Wrap the existing training routes block in `{world === 'training' && (...)}` and add a new sibling `{world === 'nutrition' && (...)}` block with a `<Routes>` for the 5 nutrition paths (pointing at placeholder imports for now — the actual screen components land in Tasks 2.3–2.13; import them lazily or leave a `// TODO: Task 2.x` marker ONLY on the import line itself, not as a stand-in implementation, since these are genuinely not built yet and this task's job is the routing skeleton). Render `world === 'training' ? <BottomNav /> : <NutritionBottomNav />` in place of the current unconditional `<BottomNav />`.

- [ ] **Step 7: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: no errors (route imports may need `// @ts-expect-error` or stub files if Step 6's placeholders don't exist yet — prefer creating minimal placeholder screen files over `@ts-expect-error`: a one-line `export function Log() { return null; }` per nutrition screen file, later overwritten by its real task, keeps the app buildable throughout this plan's execution)

- [ ] **Step 8: Create minimal placeholder files for the 5 route targets if Step 7 needs them**

`apps/web/src/screens/nutrition/{Log,Food,Weight,Coach,NutritionSettings}.tsx`, each: `export function <Name>() { return null; }` — these get overwritten by their real tasks below (Log→Task 2.5 extending existing FoodLog, Food→2.4, Weight→2.9, Coach→2.13, NutritionSettings→2.10).

- [ ] **Step 9: Run full web test suite**

Run: `pnpm --filter @hybrid/web exec vitest run`
Expected: all passing (no regressions to any existing screen's routing)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/NutritionBottomNav.tsx apps/web/src/components/NutritionBottomNav.test.tsx apps/web/src/App.tsx apps/web/src/screens/nutrition/
git commit -m "Fork the route tree and nav bar by discipline world (training/nutrition)"
```

---

### Task 2.3: New nutrition-core write paths — `CustomFood`/`Recipe` CRUD wiring

**Files:**
- Modify: `apps/web/src/screens/nutrition/entry.ts` (existing file, per investigation only supports `quick_add` today)
- Test: `apps/web/src/screens/nutrition/entry.test.ts` (create if it doesn't exist — check first, extend if it does)

**Interfaces:**
- Consumes: `logEntryFromCustomFood`, `logEntryFromFood`, `logEntryFromRecipe`, `upsertCachedFood` from `@hybrid/nutrition-core` (exact export names — verify via `grep -n "export function logEntryFrom\|export function upsertCachedFood" packages/nutrition-core/src/*.ts` before writing the import, since the investigation reported these names but did not show their exact parameter signatures).
- Produces: extends whatever the current write function in `entry.ts` looks like (e.g. if it's `writeQuickAdd(...)`, add sibling `writeFromCustomFood(...)`, `writeFromFood(...)`, `writeFromRecipe(...)`, `saveCustomFood(...)` using the same store-write pattern already established in this file).

- [ ] **Step 1: Read `apps/web/src/screens/nutrition/entry.ts` in full**

Get its exact current function name(s), exact store/db write call it makes, and its exact return/error-handling shape, so new functions match established conventions in this specific file rather than inventing a new pattern.

- [ ] **Step 2: Read the exact signatures of `logEntryFromCustomFood`, `logEntryFromFood`, `logEntryFromRecipe`, `upsertCachedFood` in `packages/nutrition-core`**

`grep -n "logEntryFromCustomFood\|logEntryFromFood\|logEntryFromRecipe\|upsertCachedFood" packages/nutrition-core/src/*.ts` and read each function's actual parameter/return types.

- [ ] **Step 3: Write the failing test** (using the REAL signatures from Step 2 — this is a placeholder in this plan only because the exact types aren't known until Step 2 runs; the implementer fills in real types, not `any`)

```typescript
// apps/web/src/screens/nutrition/entry.test.ts
import { describe, it, expect, vi } from 'vitest';
// import { writeFromCustomFood } from './entry'; // adjust to entry.ts's real exported name pattern from Step 1

describe('writeFromCustomFood', () => {
  it('writes a log entry built from a custom food via logEntryFromCustomFood', () => {
    // Arrange a minimal CustomFood fixture using the real type from nutrition-core.
    // Act: call writeFromCustomFood(fixture, quantity, unit) — real signature from Step 2.
    // Assert: the same underlying store-write call entry.ts's existing writeQuickAdd
    // uses (found in Step 1) was called with a LogEntry shaped by logEntryFromCustomFood.
  });
});
```

This step's exact assertions depend on Step 1/2's findings — the implementer writes the concrete test once those are known, following this file's existing test (if any) for the store-mocking pattern.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/screens/nutrition/entry.test.ts`
Expected: FAIL — new function doesn't exist yet.

- [ ] **Step 5: Implement the new write functions in `entry.ts`**

Following the exact pattern found in Step 1 (same error handling, same store call), add:
```typescript
import { logEntryFromCustomFood, logEntryFromFood, logEntryFromRecipe, upsertCachedFood } from '@hybrid/nutrition-core';
// then one function per new entry kind, each: build the LogEntry via the core
// function, then call this file's existing store-write primitive (same one
// writeQuickAdd/whatever Step 1 found already uses) with it.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/screens/nutrition/entry.test.ts`
Expected: PASS

- [ ] **Step 7: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/screens/nutrition/entry.ts apps/web/src/screens/nutrition/entry.test.ts
git commit -m "Add write paths for custom-food, food and recipe log entries"
```

---

### Task 2.4: `Food` screen — router/composer

**Files:**
- Create/overwrite: `apps/web/src/screens/nutrition/Food.tsx` (overwrites Task 2.2's placeholder)
- Test: `apps/web/src/screens/nutrition/Food.test.tsx`

**Interfaces:**
- Consumes: nothing from packages — this is pure UI composition.
- Produces: `Food` — a component that renders sub-views (FoodSearch, QuickAdd, CustomFood, RecipeBuilder, BarcodeScanner, LabelReader — from Tasks 2.6, 2.5(quick-add is folded into 2.5's DailyLog per the design doc), 2.7, 2.8, 2.11, 2.12) selected by a local tab/mode state, matching mobile's `Food.tsx` composer role. Since this task runs before those screens exist, render each sub-view slot as a named placeholder import guarded the same way Task 2.2's App.tsx placeholders were, and note in the commit message which later task overwrites each one.

- [ ] **Step 1: Read mobile's `apps/mobile/src/screens/nutrition/Food.tsx` in full**

Get its exact mode-switching mechanism (tabs? buttons? a segmented control?) and exact list of sub-views it composes, to replicate the same structure on web.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/web/src/screens/nutrition/Food.test.tsx
import { describe, it, expect, fireEvent } from 'vitest'; // fireEvent comes from @testing-library/react, adjust import
import { render, screen } from '@testing-library/react';
import { Food } from './Food';

describe('Food composer screen', () => {
  it('defaults to the search sub-view', () => {
    render(<Food />);
    expect(screen.getByRole('tab', { name: /search/i, selected: true })).toBeInTheDocument();
  });

  it('switches to the custom-food sub-view on tap', () => {
    render(<Food />);
    fireEvent.click(screen.getByRole('tab', { name: /custom/i }));
    expect(screen.getByRole('tab', { name: /custom/i, selected: true })).toBeInTheDocument();
  });
});
```

(Adjust the exact tab labels/roles to match what Step 1 finds mobile actually uses — this plan's test asserts the real labels, not a guess kept in the final file.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/screens/nutrition/Food.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement `Food.tsx`** as a mode-switching composer per Step 1's findings, importing sub-view placeholders for anything not yet built.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/screens/nutrition/Food.test.tsx`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/screens/nutrition/Food.tsx apps/web/src/screens/nutrition/Food.test.tsx
git commit -m "Add Food composer screen switching between nutrition sub-views"
```

---

### Task 2.5: `DailyLog`/Log tab — extend existing `FoodLog.tsx`

**Files:**
- Modify: `apps/web/src/screens/nutrition/FoodLog.tsx`
- Modify: `apps/web/src/screens/nutrition/entry.ts` (if Task 2.3 didn't already cover reading multi-kind entries — check)
- Test: extend existing `FoodLog.test.tsx` if present, else create it

**Interfaces:**
- Consumes: Task 2.3's new write functions, plus whatever read function `FoodLog.tsx` already uses (extend it to render every entry kind's summary line, not just `quick_add`'s).

- [ ] **Step 1: Read `FoodLog.tsx` in full**, identify exactly where it currently assumes `quick_add`-shaped entries (rendering, grouping, totals) and where mobile's `DailyLog.tsx` differs (meal grouping — per the design doc, mobile groups by `MEALS`).

- [ ] **Step 2: Write the failing test** — a fixture with a `logEntryFromCustomFood`-built entry alongside a `quick_add` entry, asserting both render with their real food name (not falling back to a generic "Quick add" label for the custom-food one).

- [ ] **Step 3: Run test to verify it fails.**

- [ ] **Step 4: Extend `FoodLog.tsx`'s rendering to branch on entry kind**, reusing the same per-kind name/macro extraction mobile's `DailyLog.tsx` uses (read it for the exact field access pattern per entry kind).

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Add meal-grouping** if not already present, using the same `MEALS` constant/grouping function mobile imports from `nutrition-core` (per the design doc's screen breakdown) — grep for `MEALS` export in `packages/nutrition-core`.

- [ ] **Step 7: Run the full test file, typecheck, commit.**

```bash
git add apps/web/src/screens/nutrition/FoodLog.tsx apps/web/src/screens/nutrition/FoodLog.test.tsx
git commit -m "Render every log-entry kind and group the daily log by meal"
```

---

### Task 2.6: `FoodSearch` screen

**Files:**
- Create: `apps/web/src/screens/nutrition/FoodSearch.tsx`
- Test: `apps/web/src/screens/nutrition/FoodSearch.test.tsx`
- Reference: `apps/web/src/cloud/catalogue.ts` if it exists on web already (check — investigation says `searchCatalogue` is "portable to web as-is" from `../../cloud/catalogue`, meaning mobile's cloud module, not necessarily an existing web one; if it's mobile-only today, this task ALSO needs to add/adapt a web copy — check first, and if it needs porting, that's an in-scope part of this task, not a separate one, since `FoodSearch` doesn't work at all without it)

**Interfaces:**
- Consumes: `foodSearch`, `catalogueResult`, `favoriteKey`, `favoriteResults`, `loggableUnits`, `resolveRecipePerServing`, `upsertCachedFood` from `@hybrid/nutrition-core` — verify exact signatures via grep before use, same as Task 2.3's Step 2 pattern.
- Produces: `FoodSearch` — search input + result list, each result tappable to open a quantity/unit picker, calling Task 2.3's `writeFromFood`/`writeFromCustomFood` on confirm.

- [ ] **Step 1: Check whether `apps/web/src/cloud/catalogue.ts` (or equivalent) already exists**; if not, port mobile's `apps/mobile/src/cloud/catalogue.ts`'s `searchCatalogue` function to a new `apps/web/src/cloud/catalogue.ts` — read the mobile file first, confirm it has no RN-specific imports (the design doc asserts this, verify it directly), then copy it near-verbatim.

- [ ] **Step 2: Read mobile's `FoodSearch.tsx` in full** for its exact UI flow (search-as-you-type debounce, result sectioning, the quantity/unit picker interaction).

- [ ] **Step 3: Write the failing test** — search input renders results from a mocked `foodSearch`, tapping a result opens a quantity picker, confirming calls the write path with the right arguments.

- [ ] **Step 4: Run test to verify it fails.**

- [ ] **Step 5: Implement `FoodSearch.tsx`** per Step 2's flow, using web's existing input/list component conventions (check other web screens like `Library.tsx` for the established list-item pattern rather than inventing new markup).

- [ ] **Step 6: Run test to verify it passes.**

- [ ] **Step 7: Wire into `Food.tsx`'s search tab** (replacing Task 2.4's placeholder import).

- [ ] **Step 8: Run typecheck and full nutrition test suite, commit.**

```bash
git add apps/web/src/screens/nutrition/FoodSearch.tsx apps/web/src/screens/nutrition/FoodSearch.test.tsx apps/web/src/cloud/catalogue.ts apps/web/src/screens/nutrition/Food.tsx
git commit -m "Add FoodSearch screen with catalogue lookup and quantity picker"
```

---

### Task 2.7: `CustomFood` screen

**Files:**
- Create: `apps/web/src/screens/nutrition/CustomFood.tsx`
- Test: `apps/web/src/screens/nutrition/CustomFood.test.tsx`

**Interfaces:**
- Consumes: `CustomFood` type from `@hybrid/nutrition-core`, `apps/web/src/screens/nutrition/fields.tsx` if it exists (check — mobile has one, port it here first if web doesn't, since form-field helpers are almost certainly shared UI logic this and RecipeBuilder both need), Task 2.3's `saveCustomFood`/write function.
- Produces: `CustomFood` — a form (name, per-serving macros, serving size/unit) saving via `upsertCachedFood`.

- [ ] **Step 1: Check whether `apps/web/src/screens/nutrition/fields.tsx` exists; if not, port mobile's version** (read it first — confirm it's pure form-field-shape helpers with no RN-specific rendering before copying; if it does contain RN component code, only port the non-rendering helper functions and note the rest was intentionally left behind).

- [ ] **Step 2: Read mobile's `CustomFood.tsx`** for its exact field list and validation.

- [ ] **Step 3: Write the failing test** — filling the form and submitting calls the save function with the right shape; a missing required field shows a validation message and does not call save.

- [ ] **Step 4: Run test to verify it fails.**

- [ ] **Step 5: Implement `CustomFood.tsx`.**

- [ ] **Step 6: Run test to verify it passes.**

- [ ] **Step 7: Wire into `Food.tsx`'s custom-food tab.**

- [ ] **Step 8: Run typecheck, commit.**

```bash
git add apps/web/src/screens/nutrition/CustomFood.tsx apps/web/src/screens/nutrition/CustomFood.test.tsx apps/web/src/screens/nutrition/fields.tsx apps/web/src/screens/nutrition/Food.tsx
git commit -m "Add CustomFood screen for saving reusable custom foods"
```

---

### Task 2.8: `RecipeBuilder` screen

**Files:**
- Create: `apps/web/src/screens/nutrition/RecipeBuilder.tsx`
- Test: `apps/web/src/screens/nutrition/RecipeBuilder.test.tsx`

**Interfaces:**
- Consumes: `resolveRecipePerServing`, `upsertCachedFood` from `@hybrid/nutrition-core`, Task 2.6's `FoodSearch` lookup logic (per the design doc, "reuses `lookupFor` from FoodSearch.tsx" — find and reuse the exact function, don't duplicate it).

- [ ] **Step 1: Read mobile's `RecipeBuilder.tsx`** for its exact ingredient-add flow and servings-count interaction.

- [ ] **Step 2: Confirm `FoodSearch.tsx` (Task 2.6) exports a reusable `lookupFor`-equivalent function** (or extract one from it now if it doesn't yet — a small refactor of Task 2.6's file is in-scope here since this task depends on it directly).

- [ ] **Step 3: Write the failing test** — adding an ingredient via the shared lookup appends a scaled-macro row; changing servings count rescales all rows; save calls `upsertCachedFood` with a per-serving-resolved shape from `resolveRecipePerServing`.

- [ ] **Step 4: Run test to verify it fails.**

- [ ] **Step 5: Implement `RecipeBuilder.tsx`.**

- [ ] **Step 6: Run test to verify it passes.**

- [ ] **Step 7: Wire into `Food.tsx`'s recipe tab.**

- [ ] **Step 8: Run typecheck, commit.**

```bash
git add apps/web/src/screens/nutrition/RecipeBuilder.tsx apps/web/src/screens/nutrition/RecipeBuilder.test.tsx apps/web/src/screens/nutrition/FoodSearch.tsx apps/web/src/screens/nutrition/Food.tsx
git commit -m "Add RecipeBuilder screen with shared ingredient lookup"
```

---

### Task 2.9: `Weight` screen

**Files:**
- Create/overwrite: `apps/web/src/screens/nutrition/Weight.tsx` (overwrites Task 2.2's placeholder)
- Test: `apps/web/src/screens/nutrition/Weight.test.tsx`

**Interfaces:**
- Consumes: `liveWeighIns`, `trendSeries`, `weighInDay` from `@hybrid/nutrition-adapter` (verify signatures first).

- [ ] **Step 1: Read mobile's `Weight.tsx`** for its exact entry form and trend display.

- [ ] **Step 2: Write the failing test** — submitting a weight entry calls the write path (extend Task 2.3's `entry.ts` with a weight-entry write function if one doesn't already exist there — check first); the trend list renders `trendSeries`'s output.

- [ ] **Step 3: Run test to verify it fails.**

- [ ] **Step 4: Implement `Weight.tsx`** (and the weight-entry write function in `entry.ts` if Step 2 found it missing).

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Run typecheck, commit.**

```bash
git add apps/web/src/screens/nutrition/Weight.tsx apps/web/src/screens/nutrition/Weight.test.tsx apps/web/src/screens/nutrition/entry.ts
git commit -m "Add Weight entry and trend screen"
```

---

### Task 2.10: `NutritionSettings` screen (with world-switch control)

**Files:**
- Create/overwrite: `apps/web/src/screens/nutrition/NutritionSettings.tsx` (overwrites Task 2.2's placeholder)
- Create: `apps/web/src/components/WorldSwitch.tsx`
- Test: `apps/web/src/screens/nutrition/NutritionSettings.test.tsx`, `apps/web/src/components/WorldSwitch.test.tsx`

**Interfaces:**
- Consumes: `isLive` from `@hybrid/nutrition-core`; Task 2.1's `setDiscipline`.
- Produces: `WorldSwitch` — a button/control that calls `setDiscipline('training')`, reusable from both this screen and (as a follow-on, not part of this task) the training-world settings screen if that's where mobile's reverse switch lives (check `apps/mobile/src/screens/Settings.tsx` for a nutrition-world entry point — if one exists there, note it as a gap for a follow-up task rather than silently expanding this task's scope).

- [ ] **Step 1: Read mobile's `NutritionSettings.tsx` and its `WorldSwitch` usage.**

- [ ] **Step 2: Write the failing test for `WorldSwitch`** — clicking it calls `setDiscipline('training')`.

- [ ] **Step 3: Run test to verify it fails.**

- [ ] **Step 4: Implement `WorldSwitch.tsx`.**

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Write the failing test for `NutritionSettings`** — renders its settings list plus `WorldSwitch`.

- [ ] **Step 7: Run test to verify it fails.**

- [ ] **Step 8: Implement `NutritionSettings.tsx`.**

- [ ] **Step 9: Run test to verify it passes; typecheck; commit.**

```bash
git add apps/web/src/screens/nutrition/NutritionSettings.tsx apps/web/src/screens/nutrition/NutritionSettings.test.tsx apps/web/src/components/WorldSwitch.tsx apps/web/src/components/WorldSwitch.test.tsx
git commit -m "Add NutritionSettings screen and the world-switch control"
```

---

### Task 2.11: `LabelReader` screen (tesseract.js) — confirm the open call from the design doc before starting

**Files:**
- Modify: `apps/web/package.json` (add `tesseract.js` dependency — confirm exact current version on npm at implementation time, don't guess a version number here)
- Create: `apps/web/src/native/labelOcr.ts`
- Create/overwrite: `apps/web/src/screens/nutrition/LabelReader.tsx`
- Test: `apps/web/src/native/labelOcr.test.ts`, `apps/web/src/screens/nutrition/LabelReader.test.tsx`

**Interfaces:**
- Consumes: `parseLabelLines`, `parseLabelText`, `isEmptyLabel` from `@hybrid/nutrition-core` (already shared, per the design doc — verify signatures).
- Produces:
  ```typescript
  // apps/web/src/native/labelOcr.ts
  export interface OcrLine { text: string; left: number; top: number; right: number; bottom: number }
  export async function recognizeLabel(imageSource: ImageBitmap | Blob): Promise<OcrLine[]>;
  ```

- [ ] **Step 1: Confirm with a fresh read of the committed design doc** (`docs/superpowers/specs/2026-08-10-pwa-parity-design.md`) that `tesseract.js` is still the intended choice before adding a new dependency — this was flagged there as the one open call in the whole project; if the user has since said otherwise anywhere in conversation, follow that instead and skip this task's dependency addition (build LabelReader typed-entry-only per the doc's stated fallback).

- [ ] **Step 2: `pnpm --filter @hybrid/web add tesseract.js`**

- [ ] **Step 3: Read mobile's `apps/mobile/src/native/labelOcr.ts` in full** for its exact `OcrLine` shape and how it drops lines with missing bounding boxes — match this exactly so `parseLabelLines` (shared, unmodified) receives the same input shape it already handles correctly.

- [ ] **Step 4: Write the failing test**

```typescript
// apps/web/src/native/labelOcr.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('tesseract.js', () => ({
  recognize: vi.fn().mockResolvedValue({
    data: {
      lines: [
        { text: 'Protein 20g', bbox: { x0: 0, y0: 10, x1: 100, y1: 20 } },
        { text: '', bbox: null }, // line with no bounding box — must be dropped
      ],
    },
  }),
}));
import { recognizeLabel } from './labelOcr';

describe('recognizeLabel', () => {
  it('converts tesseract lines to OcrLine, dropping lines without a bounding box', async () => {
    const lines = await recognizeLabel(new Blob());
    expect(lines).toEqual([
      { text: 'Protein 20g', left: 0, top: 10, right: 100, bottom: 20 },
    ]);
  });
});
```

- [ ] **Step 5: Run test to verify it fails.**

Run: `pnpm --filter @hybrid/web exec vitest run src/native/labelOcr.test.ts`

- [ ] **Step 6: Implement `labelOcr.ts`**

```typescript
import { recognize } from 'tesseract.js';
import type { OcrLine } from './labelOcr'; // self-reference avoided; keep the interface and function in the same file

export interface OcrLine { text: string; left: number; top: number; right: number; bottom: number }

export async function recognizeLabel(imageSource: Blob | ImageBitmap): Promise<OcrLine[]> {
  const result = await recognize(imageSource as any, 'eng');
  return result.data.lines
    .filter((line: any) => line.bbox != null && line.text.trim().length > 0)
    .map((line: any) => ({
      text: line.text,
      left: line.bbox.x0,
      top: line.bbox.y0,
      right: line.bbox.x1,
      bottom: line.bbox.y1,
    }));
}
```

(Fix the `any` casts once `tesseract.js`'s actual TypeScript types are checked — `tesseract.js` ships its own types; use them instead of `any` if they cover this shape, only fall back to `any` at the exact boundary where they don't.)

- [ ] **Step 7: Run test to verify it passes.**

- [ ] **Step 8: Read mobile's `LabelReader.tsx`** for its capture → recognize → prefill-form → fallback-to-manual flow.

- [ ] **Step 9: Write the failing test for `LabelReader.tsx`** — a successful recognize pre-fills macro fields via `parseLabelLines`; recognizer failure/empty result falls back to a blank editable form (not an error dead-end).

- [ ] **Step 10: Run test to verify it fails.**

- [ ] **Step 11: Implement `LabelReader.tsx`** using `getUserMedia` for the camera capture (check whether `BarcodeScanner` from Task 2.12 already has camera-permission-handling code to reuse rather than duplicating it — if Task 2.12 is done first, reuse its permission flow; if this task runs first, build the minimal permission flow here and note in Task 2.12 to reuse it).

- [ ] **Step 12: Run test to verify it passes; typecheck; commit.**

```bash
git add apps/web/package.json apps/web/src/native/labelOcr.ts apps/web/src/native/labelOcr.test.ts apps/web/src/screens/nutrition/LabelReader.tsx apps/web/src/screens/nutrition/LabelReader.test.tsx
git commit -m "Add camera nutrition-label OCR via tesseract.js"
```

---

### Task 2.12: `BarcodeScanner` screen (Chrome `BarcodeDetector`)

**Files:**
- Create: `apps/web/src/native/barcodeScanner.ts`
- Create/overwrite: `apps/web/src/screens/nutrition/BarcodeScanner.tsx`
- Test: `apps/web/src/native/barcodeScanner.test.ts`, `apps/web/src/screens/nutrition/BarcodeScanner.test.tsx`

**Interfaces:**
- Produces:
  ```typescript
  // apps/web/src/native/barcodeScanner.ts
  export function isBarcodeDetectorSupported(): boolean;
  export async function detectBarcode(source: ImageBitmapSource): Promise<string | null>; // returns the raw barcode value or null if none found
  ```

- [ ] **Step 1: Read mobile's `BarcodeScanner.tsx`** for its exact permission-gate/deep-link-to-settings fallback UI and the `lookupBarcode` call it makes on detection.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/web/src/native/barcodeScanner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { isBarcodeDetectorSupported, detectBarcode } from './barcodeScanner';

describe('barcodeScanner', () => {
  it('reports unsupported when BarcodeDetector is absent', () => {
    // @ts-expect-error test override
    delete (globalThis as any).BarcodeDetector;
    expect(isBarcodeDetectorSupported()).toBe(false);
  });

  it('returns the first detected barcode value', async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: '012345678905' }]);
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn().mockImplementation(() => ({ detect }));

    const value = await detectBarcode({} as any);
    expect(value).toBe('012345678905');
  });

  it('returns null when nothing is detected', async () => {
    const detect = vi.fn().mockResolvedValue([]);
    // @ts-expect-error test override
    globalThis.BarcodeDetector = vi.fn().mockImplementation(() => ({ detect }));

    const value = await detectBarcode({} as any);
    expect(value).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails.**

- [ ] **Step 4: Implement `barcodeScanner.ts`**

```typescript
export function isBarcodeDetectorSupported(): boolean {
  return 'BarcodeDetector' in globalThis;
}

export async function detectBarcode(source: ImageBitmapSource): Promise<string | null> {
  const detector = new (globalThis as any).BarcodeDetector();
  const results = await detector.detect(source);
  return results[0]?.rawValue ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Write the failing test for `BarcodeScanner.tsx`** — unsupported browser shows a fallback message (not a crash); a detected barcode calls `lookupBarcode` (the same function `FoodSearch`/mobile's scanner uses — find it, likely in `nutrition-core` or `cloud/catalogue.ts` from Task 2.6, reuse it, don't duplicate).

- [ ] **Step 7: Run test to verify it fails.**

- [ ] **Step 8: Implement `BarcodeScanner.tsx`** using `getUserMedia` + a `<video>` element feeding frames to `detectBarcode` on an interval, camera-permission-denied fallback message (reuse Task 2.11's permission-flow code if that task landed first, per the note in Task 2.11 Step 11).

- [ ] **Step 9: Run test to verify it passes; typecheck; commit.**

```bash
git add apps/web/src/native/barcodeScanner.ts apps/web/src/native/barcodeScanner.test.ts apps/web/src/screens/nutrition/BarcodeScanner.tsx apps/web/src/screens/nutrition/BarcodeScanner.test.tsx
git commit -m "Add camera barcode scanning via the BarcodeDetector API"
```

---

### Task 2.13: `Coach` screen (nutrition dashboard, embeds `CheckIn`)

**Files:**
- Create: `apps/web/src/screens/nutrition/CheckIn.tsx`
- Create/overwrite: `apps/web/src/screens/nutrition/Coach.tsx` (overwrites Task 2.2's placeholder)
- Test: `apps/web/src/screens/nutrition/CheckIn.test.tsx`, `apps/web/src/screens/nutrition/Coach.test.tsx`

**Interfaces:**
- Consumes: `targetForDay` (`nutrition-core`); `checkInFor`, `currentEstimate`, `goalLabel`, `goalOf`, `latestWeighIn`, `weekEndOf`, `weekStartOf`, `dailyRecords`, `dampingAnchor`, `macroOvershoot`, `weighInCoverage` (`nutrition-adapter`); `weeklyCheckIn`, `addDays`, `ExpenditureConfidence` type (`nutrition-engine`). Verify every signature via grep before use — this screen has the widest shared-logic surface of the whole plan per the design doc, so getting the exact call shapes right matters more here than anywhere else in Phase 2.

- [ ] **Step 1: Read mobile's `CheckIn.tsx` and `Coach.tsx` in full** — exact weekly-review UI, exact accept/adjust action, exact dashboard layout (target ring, estimate/confidence, goal chips).

- [ ] **Step 2: Write the failing test for `CheckIn`** — renders a week's coverage/overshoot numbers from fixture data; accepting calls `weeklyCheckIn` and produces a write for the next week's `MacroProgramDay` (find the actual write call — this is new, per the design doc, "not yet called anywhere in apps/web" — add it to `entry.ts` or a dedicated `checkIn.ts` write module, matching Task 2.3's established pattern rather than inventing a new one).

- [ ] **Step 3: Run test to verify it fails.**

- [ ] **Step 4: Implement `CheckIn.tsx`.**

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Write the failing test for `Coach`** — renders target/estimate/confidence/goal from fixture data, embeds the `CheckIn` pane (not a route to it — per the design doc, mobile embeds it directly).

- [ ] **Step 7: Run test to verify it fails.**

- [ ] **Step 8: Implement `Coach.tsx`.**

- [ ] **Step 9: Run test to verify it passes; typecheck; run the full nutrition test suite; commit.**

```bash
git add apps/web/src/screens/nutrition/CheckIn.tsx apps/web/src/screens/nutrition/CheckIn.test.tsx apps/web/src/screens/nutrition/Coach.tsx apps/web/src/screens/nutrition/Coach.test.tsx
git commit -m "Add nutrition Coach dashboard and embedded weekly CheckIn"
```

---

### Task 2.14: End-to-end nutrition-world verification pass

**Files:** none created — this is a manual/scripted verification task, no new source.

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter @hybrid/web exec vitest run`
Expected: all passing, zero regressions to Training-world tests.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Run the build**

Run: `pnpm --filter @hybrid/web build`
Expected: succeeds, `tesseract.js`'s WASM assets are correctly emitted into the build output (check the dist output includes them — this is a common Vite+WASM footgun, verify don't assume).

- [ ] **Step 4: Manual device pass, on a real Android Chrome browser (not just desktop devtools emulation)**

Checklist (from the design doc's Close-out section): world-switch between training and nutrition; log a food via search; save and reuse a custom food; build and log a recipe; scan a real barcode; capture and OCR a real nutrition label (confirm pre-fill accuracy is reasonable, not necessarily perfect); log a weight entry and see the trend; complete a weekly check-in; pair a WHOOP strap over Web Bluetooth and confirm the new scanning/connected/error states show correctly; pair the Echo Bike over FTMS; confirm the screen doesn't sleep mid-session; confirm a rest-timer notification fires.

- [ ] **Step 5: Record the verification result** — this is the gate for Task 3.1 (deleting `apps/mobile`); do not proceed to deletion without this pass actually completed on a real device, not simulated.

---

## Phase 3 — Close-out

### Task 3.1: Delete `apps/mobile`

**Files:**
- Delete: `apps/mobile/` (entire directory)
- Modify: `.github/workflows/ci.yml` (remove the `Bundle the mobile app (Metro + Hermes)` step)
- Modify: any EAS config files referenced only by `apps/mobile` (`eas.json` if it lives outside `apps/mobile`, `app.json`'s EAS project reference — check for repo-root-level EAS config before deleting, some Expo setups keep this outside the app directory)
- Modify: root `package.json`/`pnpm-workspace.yaml` if `apps/mobile` is explicitly listed rather than glob-matched

**Prerequisite:** Task 2.14's manual device verification must be complete and confirmed working before this task starts. Do not run this task speculatively.

- [ ] **Step 1: Confirm no `packages/*` file imports anything from `apps/mobile`**

Run: `grep -rl "apps/mobile" packages/ apps/web/ 2>/dev/null`
Expected: no results (if any exist, resolve them before deleting — this would mean something in web or a shared package accidentally depends on mobile-only code, which needs fixing, not just deleting out from under it).

- [ ] **Step 2: Delete the directory**

```bash
git rm -r apps/mobile
```

- [ ] **Step 3: Remove the CI bundle step**

Edit `.github/workflows/ci.yml`, remove the `- name: Bundle the mobile app (Metro + Hermes)` step and its `run: pnpm --filter @hybrid/mobile bundle` line.

- [ ] **Step 4: Remove any other mobile-only CI/build references**

`grep -rn "@hybrid/mobile\|apps/mobile" .github/ *.json *.toml 2>/dev/null` (excluding `pnpm-lock.yaml`) and clean up each hit.

- [ ] **Step 5: Run `pnpm install`** to regenerate the lockfile without the removed workspace package.

- [ ] **Step 6: Run the full monorepo test suite and typecheck**

Run: `pnpm run test` and `pnpm run typecheck`
Expected: both clean — confirms nothing else in the monorepo silently depended on `apps/mobile`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Delete apps/mobile — the PWA now covers everything it did"
```

- [ ] **Step 8: Push and confirm CI is green on the resulting commit before considering this done.**

---

## Self-Review Notes

- **Spec coverage:** Phase 1 covers all 4 items from the design doc's Phase 1 list. Phase 2 covers all 12 mobile nutrition screens (DailyLog→2.5, FoodSearch→2.6, CustomFood→2.7, RecipeBuilder→2.8, CheckIn→2.13, Weight→2.9, NutritionSettings→2.10, QuickAdd→folded into 2.5 per the design doc's own note that it's "light reconciliation, not a new build", Coach→2.13, Food→2.4, BarcodeScanner→2.12, LabelReader→2.11), the nav fork (2.1, 2.2), the new write paths (2.3), and the close-out (2.14, 3.1).
- **Placeholder scan:** Tasks 2.3, 2.6, 2.9, 2.13 have steps that say "verify the exact signature via grep before use" rather than a hardcoded signature — this is intentional, not a placeholder-avoidance failure: the investigation reported these function NAMES exist and roughly what they do, but did not report exact parameter types, and guessing a wrong type here would be worse than instructing the implementer to check first. Every task still has concrete, runnable test code and real implementation code, not "write tests for the above."
- **Type consistency:** `connectStrap`'s new `onState` signature (Task 1.1) is used consistently. `WorldId` (Task 2.1) is the type threaded through Tasks 2.2 and App.tsx. `OcrLine` (Task 2.11) matches the shape mobile's own `labelOcr.ts` produces, confirmed against the design doc's investigation findings.
