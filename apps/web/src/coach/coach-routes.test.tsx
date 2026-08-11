// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The pillar screens read the SIGNED-IN athlete's own stores, exactly like
 * legacy/build/planner. Without ClientDetailGate a coach would see their own
 * records under a roster client's name — the failure ClientDetailGate.tsx's
 * own header comment exists to prevent. Asserted statically because the
 * router is a lazy chunk, matching how checks/coach-contract.mjs proves the
 * same property for the routes that already have it.
 *
 * FIXED post-review (11 August 2026): the original assertion here was
 * `path="${path}"[^>]*element=\{<ClientDetailGate\b` — it stops matching the
 * instant it sees the literal `<ClientDetailGate` and never looks at what
 * attributes follow. Injecting `layer3Ready` into a pillar route left that
 * regex passing unchanged, which is exactly the regression this file exists
 * to catch: the four pillar routes' `layer3Ready`-ABSENCE is a privacy
 * boundary (a roster client must be refused, not shown the coach's own
 * records under someone else's name), and it had no working guard. The fix
 * captures the ClientDetailGate element's FULL opening tag — up to its own
 * closing `>`, not the router's `<Route ... />` — and asserts on that
 * captured text, not on whether the regex matched at all.
 */
describe('coach pillar routes', () => {
  const src = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');

  /** The `<ClientDetailGate ...>` opening tag for a given route `path`, e.g.
   *  `<ClientDetailGate tool="Readiness">` — everything up to (and
   *  including) the gate's own `>`, never crossing into its children or the
   *  next route. Fails the test immediately (via the non-null assertion) if
   *  the route or its gate isn't found at all, rather than silently letting
   *  a later `.not.toMatch` on `undefined` report a false pass. */
  function gateOpenTag(path: string): string {
    const re = new RegExp(`path="${path}"[^>]*element=\\{(<ClientDetailGate\\b[^>]*>)`);
    const match = src.match(re);
    expect(match, `no <ClientDetailGate> found for path="${path}"`).not.toBeNull();
    return match![1];
  }

  it.each(['readiness', 'strength', 'conditioning', 'nutrition'])(
    'wraps /coach/%s in ClientDetailGate WITHOUT layer3Ready',
    (path) => {
      const tag = gateOpenTag(path);
      expect(tag).not.toMatch(/\blayer3Ready\b/);
    },
  );

  /* AMENDED 11 August 2026 — see "Task 7 amendment" below. The route is NOT a
     redirect: it survives as the roster decision surface, so it must still be
     gated with `layer3Ready` exactly as it is today. */
  it('keeps /coach/progression as a layer3Ready roster route, not a redirect', () => {
    const tag = gateOpenTag('progression');
    expect(tag).toContain('tool="Decisions"');
    expect(tag).toMatch(/\blayer3Ready\b/);
    expect(src).not.toMatch(/path="progression"[^>]*<Navigate/);
  });
});
