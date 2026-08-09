# Coach-first root on the unscoped dashboard deploy, with a real sign-in gate

## Problem

`thehybridengine1.netlify.app` is the live, unscoped "Dashboard" build
(`VITE_HYBRID_PRODUCT` unset — `IS_SCOPED_BUILD` false, per
`apps/web/src/product.ts`). Its root route (`/`) renders the athlete `Home`
screen. The user (who uses this deploy as both the coach and the
self-coached athlete) wants that flipped: opening the deploy should land
directly in the ARC coach workspace, with the athlete app still present and
fully functional, but no longer the front door and never linked to from
anywhere inside the coach UI.

This must NOT touch `build:strength` or `build:conditioning` — those are
the real branded athlete products (`IS_SCOPED_BUILD` true) and stay exactly
as they are.

## Current state (verified against the code)

- `apps/web/src/App.tsx:78` — `<Route path="/" element={<Home />} />`,
  unconditional.
- `apps/web/src/App.tsx:91` — the catch-all (`path="*"`) already redirects
  to `/`, so once `/` itself redirects to `/coach` on the unscoped build,
  every unmatched athlete path chains through `/` and lands on `/coach`
  too. No separate change needed there.
- `apps/web/src/coach/CoachShell.tsx:135-143` — `CoachAccess` gates every
  route in the lazy `coach` chunk on `coachAllowed(user?.id,
  VITE_COACH_USER_IDS, import.meta.env.DEV, VITE_COACH_DEMO_MODE ===
  'true')` (`apps/web/src/coach/guard.ts`). When denied, it currently
  renders `<Navigate to="/" replace />` — silent, unbranded, and would
  become an infinite redirect loop once `/` itself redirects to `/coach`
  on this build.
- Confirmed by grep: no other file under `apps/web/src/coach/` links back
  to `/` or any athlete route. The `CoachAccess` fallback above is the only
  spot the athlete app "shows through" from the coach side.
- `apps/web/src/screens/Settings.tsx:309-399` (`CloudCard`) is the existing
  sign-in form, using `useSync()`'s `signIn(email, password)` — the same
  Supabase account the user already uses for WHOOP/Concept2 sync and all
  their training data. There is exactly one account in this app; a coach
  sign-in screen is a second door to the same room, not a second account.

## Design

**1. Scoped root redirect.** In `App.tsx`, the `/` route becomes:

```tsx
<Route path="/" element={IS_SCOPED_BUILD ? <Home /> : <Navigate to="/coach" replace />} />
```

`IS_SCOPED_BUILD` (already exported from `./product`) is false only on the
unscoped dashboard build this deploy runs — `build:strength` and
`build:conditioning` keep rendering `Home` at `/` exactly as today, since
`IS_SCOPED_BUILD` is true for both. No other route changes: `/training`,
`/library`, `/progress`, `/settings`, `/calendar`, `/day/:date`,
`/recap/:id`, `/nutrition` all stay reachable by direct URL on every build,
unlinked from the coach UI, same as verified above.

**2. Real sign-in instead of a silent bounce.** A new colocated component,
`apps/web/src/coach/CoachSignIn.tsx`, replaces `CoachAccess`'s
`<Navigate to="/" replace />` fallback:

```tsx
export function CoachAccess({ children }: { children: ReactNode }) {
  const { user } = useSync();
  const allowed = coachAllowed(/* unchanged */);
  return allowed ? children : <CoachSignIn />;
}
```

`CoachSignIn` is a minimal, ARC-styled (near-black background, gold
accents, inline Tailwind — matching `ArcCoachFrame`'s existing style, not
the athlete `Card`/`Button` components) email/password form. It calls
`useSync()`'s `signIn(email, password)` — the exact function `Settings.tsx`'s
`CloudCard` already calls (`Settings.tsx:389`) — so successful sign-in uses
the same account, same session, same sync. No `signUp` control on this
screen: account creation stays Settings-only, since account creation isn't
this screen's job and the user already has an account.

Once `signIn` succeeds, `useSync()`'s `user` updates, `CoachAccess`
re-renders, `coachAllowed` re-evaluates, and `children` (the real coach
route) renders — no further navigation needed, no redirect loop, because
`CoachSignIn` never itself navigates anywhere.

The form shows `useSync()`'s existing `error` state on a failed attempt
(wrong password, etc.) — same pattern as `CloudCard`, not reinvented.

**3. Demo mode is out of scope for this spec, flagged for a decision
after.** `VITE_COACH_DEMO_MODE=true` is currently set on the live deploy as
a temporary bypass. Once real sign-in works, it's an open door with no
purpose — every legitimate user (the account owner) can now sign in
directly. Turning it off is a one-line Netlify env var change plus a
redeploy, identical to how it was turned on; it is NOT part of this
implementation plan, because it's a deployment/security decision for the
user to make explicitly once they've confirmed sign-in works, not a code
change to bundle in silently.

## Testing

Colocated, per convention:

- `App.test.tsx` does not currently exist — this spec does not create one
  solely for a two-branch route conditional; `IS_SCOPED_BUILD`'s own
  branching is already covered by existing tests
  (`components/BottomNav.test.tsx`, `screens/Home.test.tsx`) established
  earlier this session. The routing conditional itself is a one-line
  ternary with no independent logic to unit-test in isolation from a full
  router render, which the existing `ArcCoachFrame.test.tsx` /
  `CoachCommandCenter.test.tsx` harnesses already exercise for the coach
  side.
- `CoachSignIn.test.tsx` (new, colocated with the new component): asserts
  the form renders when `coachAllowed` is false, calls `signIn` with the
  entered email/password on submit, and that a returned error string
  renders. Uses the same `FakeCoachWorkspaceRepository`/`renderCoachScreen`
  harness pattern already established in `coach-test-harness.tsx`.
- `CoachShell.test.tsx` — extend or add a test asserting `CoachAccess`
  renders `CoachSignIn` (not a redirect) when denied, and renders
  `children` when `coachAllowed` is true.

## Non-goals

- No changes to `build:strength` / `build:conditioning` routing.
- No account-creation UI on the new sign-in screen.
- No change to `VITE_COACH_DEMO_MODE`'s current value — flagged as a
  follow-up decision, not executed here.
- No changes to any athlete route's content or reachability — only the
  root's default destination changes, and only on the unscoped build.
