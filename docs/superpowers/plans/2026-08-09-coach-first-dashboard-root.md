# Coach-First Dashboard Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the unscoped "Dashboard" web build only, `/` redirects straight into the ARC coach workspace instead of the athlete Home screen, and being denied entry to `/coach` shows a real sign-in form instead of silently bouncing back to a now-hidden Home.

**Architecture:** Two independent, small changes: a one-line conditional on the `/` route in `App.tsx` (gated on the existing `IS_SCOPED_BUILD` flag so the branded `build:strength`/`build:conditioning` products are untouched), and a new `CoachSignIn` component that replaces `CoachAccess`'s current `<Navigate to="/" replace />` fallback — using the exact `signIn()` function `Settings.tsx`'s existing login form already calls, so it's the same account, not a new one.

**Tech Stack:** React 19, react-router-dom, existing `@hybrid/product-scope`/`useSync()` (Supabase auth) — no new dependencies.

## Global Constraints

- `build:strength` and `build:conditioning` (`IS_SCOPED_BUILD === true`) must render `/` exactly as today — this only changes the unscoped dashboard build's behavior.
- Every other athlete route (`/training`, `/library`, `/progress`, `/settings`, `/calendar`, `/day/:date`, `/recap/:id`, `/nutrition`) stays reachable by direct URL on every build, unchanged.
- The new sign-in screen must not itself navigate/redirect — `CoachAccess` re-evaluates automatically once `useSync()`'s `user` changes, and an extra `Navigate` here would risk exactly the redirect loop this plan exists to avoid.
- No `signUp` control on the new screen — account creation stays Settings-only.
- Interactive `<button>`/`<input>` elements get comfortable padding (`py-2`), not an explicit `h-11`/`min-h-11` — `packages/design/src/tokens.css`'s global `@media (pointer: coarse)` rule already floors `button`/`input` at 44px on touch; adding an explicit height here would just redundantly inflate desktop density, the exact regression this session's coach-mobile work already fixed once.
- Tests are colocated (`Foo.tsx` → `Foo.test.tsx`, same directory).
- `useSync()`/`useConcept2()` throw outside their real providers, and the real `SyncProvider` opens live Supabase network calls in a test environment (`SUPABASE.url` falls back to a real project URL when no env var is set) — every coach test that needs `useSync()` mocks it with `vi.mock('../cloud/sync', () => ({ useSync: () => ({...}) }))` rather than mounting the real provider (established pattern, see `AthleteStatus.test.tsx:39-46`).

---

### Task 1: Scoped root redirect in App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx:29` (import), `apps/web/src/App.tsx:78` (route)
- Test: none new — this ternary is covered by the existing `IS_SCOPED_BUILD` unit coverage in `apps/web/src/components/BottomNav.test.tsx` and `apps/web/src/screens/Home.test.tsx`, and by Task 2's `CoachShell.test.tsx` extension exercising the coach side. A route-level redirect with no independent branching logic doesn't warrant its own render test on top of those.

**Interfaces:**
- Consumes: `IS_SCOPED_BUILD` (boolean, already exported from `apps/web/src/product.ts`).
- Produces: nothing consumed by Task 2 — the two tasks are independent.

- [ ] **Step 1: Add `IS_SCOPED_BUILD` to the existing product import**

In `apps/web/src/App.tsx`, change:

```tsx
import { PRODUCT, PRODUCT_ID } from './product';
```

to:

```tsx
import { IS_SCOPED_BUILD, PRODUCT, PRODUCT_ID } from './product';
```

- [ ] **Step 2: Make the root route conditional**

Change:

```tsx
                  <Route path="/" element={<Home />} />
```

to:

```tsx
                  <Route path="/" element={IS_SCOPED_BUILD ? <Home /> : <Navigate to="/coach" replace />} />
```

`Navigate` is already imported in this file (used by the catch-all route two lines below it) — no new import needed.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors

- [ ] **Step 4: Run the full web test suite to confirm nothing broke**

Run: `pnpm --filter @hybrid/web test`
Expected: all tests pass (this change touches no test-covered logic directly, but confirms no accidental regression — e.g. no existing test renders `<App />` at `/` expecting `<Home />` unconditionally)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "Redirect / to /coach on the unscoped dashboard build only"
```

---

### Task 2: Real sign-in screen replaces CoachAccess's silent bounce

**Files:**
- Create: `apps/web/src/coach/CoachSignIn.tsx`
- Create: `apps/web/src/coach/CoachSignIn.test.tsx`
- Modify: `apps/web/src/coach/CoachShell.tsx:1` (imports), `apps/web/src/coach/CoachShell.tsx:135-143` (`CoachAccess`)
- Test: extend `apps/web/src/coach/CoachShell.tsx`'s existing test coverage — check whether a `CoachShell.test.tsx` file already exists before creating one (if none exists, create it colocated as shown below).

**Interfaces:**
- Consumes: `useSync()` from `../cloud/sync` — `{ signIn: (email: string, password: string) => Promise<string | null> }` (returns an error message string on failure, `null` on success; exact signature at `apps/web/src/cloud/sync.tsx:50`).
- Produces: `CoachSignIn` (default export: named export `CoachSignIn`, a React component taking no props) — consumed only by `CoachAccess` in this same file, in this same task.

- [ ] **Step 1: Write the failing test for `CoachSignIn`**

Create `apps/web/src/coach/CoachSignIn.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CoachSignIn } from './CoachSignIn';

const signIn = vi.fn();

vi.mock('../cloud/sync', () => ({
  useSync: () => ({ signIn }),
}));

describe('CoachSignIn', () => {
  it('calls signIn with the entered email and password on submit', async () => {
    signIn.mockResolvedValueOnce(null);
    render(<CoachSignIn />);
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await Promise.resolve();
    expect(signIn).toHaveBeenCalledWith('coach@example.com', 'hunter2');
  });

  it('shows the error message signIn returns, on a failed attempt', async () => {
    signIn.mockResolvedValueOnce('Invalid email or password.');
    render(<CoachSignIn />);
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });

  it('has no sign-up control — account creation stays on Settings', () => {
    render(<CoachSignIn />);
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachSignIn.test.tsx`
Expected: FAIL — `Failed to resolve import "./CoachSignIn"` (the component doesn't exist yet)

- [ ] **Step 3: Create `CoachSignIn.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { useSync } from '../cloud/sync';

/*
 * Replaces CoachAccess's old `<Navigate to="/" replace />` fallback. Signing
 * in here uses the exact same signIn() Settings.tsx's CloudCard already
 * calls — one account, one door in a second place, not a second account.
 * No signUp control: account creation stays Settings-only.
 */
export function CoachSignIn() {
  const { signIn } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setMsg((await signIn(email, password)) || '');
    setWorking(false);
  };

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-3 text-text">
      <form onSubmit={submit} className="w-full max-w-[320px] rounded-lg border border-line2 bg-panel3 p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-gold-line/70 bg-gold-wash text-sm font-black text-gold2">A</div>
          <div>
            <p className="text-[9px] uppercase tracking-[.2em] text-gold">ARC</p>
            <p className="text-sm font-semibold leading-tight">Coach workspace</p>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">Sign in with your account to continue.</p>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          autoComplete="email"
          placeholder="email"
          aria-label="email"
          className="mb-2 w-full rounded-md border border-line2 bg-well px-2 py-2 text-sm text-text outline-none focus:border-gold-line"
        />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          autoComplete="current-password"
          placeholder="password"
          aria-label="password"
          className="mb-2 w-full rounded-md border border-line2 bg-well px-2 py-2 text-sm text-text outline-none focus:border-gold-line"
        />
        {msg ? <p className="mb-2 text-xs text-warn" role="alert">{msg}</p> : null}
        <button
          type="submit"
          disabled={working}
          className="w-full rounded-md border border-gold-line bg-gold-wash px-2 py-2 text-sm font-semibold text-gold2 disabled:opacity-50"
        >
          {working ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachSignIn.test.tsx`
Expected: PASS (3/3)

- [ ] **Step 5: Write the failing test for `CoachAccess`'s new fallback**

No test file exists yet for `CoachShell.tsx` (confirmed — there's no colocated `CoachShell.test.tsx` in `apps/web/src/coach/`). Create `apps/web/src/coach/CoachShell.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoachAccess } from './CoachShell';

let mockUserId: string | null = null;

vi.mock('../cloud/sync', () => ({
  useSync: () => ({ user: mockUserId ? { id: mockUserId } : null, signIn: vi.fn() }),
}));

vi.mock('./guard', () => ({
  coachAllowed: (userId: string | null | undefined) => userId === 'allowed-id',
}));

describe('CoachAccess', () => {
  it('renders the sign-in screen, not a redirect, when denied', () => {
    mockUserId = null;
    render(<CoachAccess><p>Coach content</p></CoachAccess>);
    expect(screen.queryByText('Coach content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders children when allowed', () => {
    mockUserId = 'allowed-id';
    render(<CoachAccess><p>Coach content</p></CoachAccess>);
    expect(screen.getByText('Coach content')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachShell.test.tsx`
Expected: FAIL — the sign-in-screen test fails because `CoachAccess` still renders `<Navigate to="/" replace />` (which `@testing-library/react`'s `render` renders as nothing without a `MemoryRouter`, so neither "Coach content" nor a "sign in" button exist yet — the first assertion passes for the wrong reason, the second fails)

- [ ] **Step 7: Update `CoachAccess` in `CoachShell.tsx`**

Change the import line:

```tsx
import { Link, Navigate } from 'react-router-dom';
```

to:

```tsx
import { Link } from 'react-router-dom';
```

(`Navigate` becomes unused in this file once `CoachAccess` no longer references it — confirmed by grep it has no other use in `CoachShell.tsx`.)

Add the new import alongside the existing ones (after the `coachAllowed` import):

```tsx
import { CoachSignIn } from './CoachSignIn';
```

Change `CoachAccess`'s body:

```tsx
  return allowed ? children : <Navigate to="/" replace />;
```

to:

```tsx
  return allowed ? children : <CoachSignIn />;
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachShell.test.tsx`
Expected: PASS (2/2)

- [ ] **Step 9: Run both new test files together, plus typecheck**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachSignIn.test.tsx src/coach/CoachShell.test.tsx`
Expected: PASS (5/5 total)

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/coach/CoachSignIn.tsx apps/web/src/coach/CoachSignIn.test.tsx apps/web/src/coach/CoachShell.tsx apps/web/src/coach/CoachShell.test.tsx
git commit -m "CoachAccess shows a real sign-in screen instead of a silent redirect"
```

---

### Task 3: Full verification and build check

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: the completed state of Tasks 1–2.
- Produces: nothing (terminal task).

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter @hybrid/web test`
Expected: all test files pass, including the new/extended files from Tasks 1–2 and every pre-existing test.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors

- [ ] **Step 3: Run the ecosystem check**

Run: `pnpm run check:ecosystem`
Expected: `All ecosystem-contract static checks passed.` (unaffected by this work, run per CLAUDE.md's Safe Workflow)

- [ ] **Step 4: Build all three profiles and confirm the redirect only applies to the unscoped one**

Run:
```bash
pnpm --filter @hybrid/web build          # unscoped dashboard — this is what thehybridengine1.netlify.app deploys
pnpm --filter @hybrid/web build:strength
pnpm --filter @hybrid/web build:conditioning
```
Expected: all three build cleanly.

Then confirm the conditional actually took effect, behaviorally: start a local preview of the unscoped build (`pnpm --filter @hybrid/web exec vite preview --outDir dist`), open the printed local URL's `/` in a browser, and confirm it immediately redirects to `/coach` (landing on the sign-in screen, since no session is authenticated locally). Stop that preview (Ctrl-C), then preview the scoped build the same way (`pnpm --filter @hybrid/web exec vite preview --outDir dist-strength`) and confirm `/` loads the athlete Home screen unchanged, no redirect. Stop that preview too.

- [ ] **Step 5: Clean up build output**

```bash
rm -rf apps/web/dist apps/web/dist-strength apps/web/dist-conditioning
```

- [ ] **Step 6: Push**

```bash
git push origin main
```
