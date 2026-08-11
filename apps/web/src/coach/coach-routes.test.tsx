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
 */
describe('coach pillar routes', () => {
  const src = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');

  it.each(['readiness', 'strength', 'conditioning', 'nutrition'])(
    'wraps /coach/%s in ClientDetailGate',
    (path) => {
      const re = new RegExp(`path="${path}"[^>]*element=\\{<ClientDetailGate\\b`);
      expect(src).toMatch(re);
    },
  );

  /* AMENDED 11 August 2026 — see "Task 7 amendment" below. The route is NOT a
     redirect: it survives as the roster decision surface, so it must still be
     gated with `layer3Ready` exactly as it is today. */
  it('keeps /coach/progression as a layer3Ready roster route, not a redirect', () => {
    expect(src).toMatch(/path="progression"[^>]*element=\{<ClientDetailGate tool="Decisions" layer3Ready>/);
    expect(src).not.toMatch(/path="progression"[^>]*<Navigate/);
  });
});
