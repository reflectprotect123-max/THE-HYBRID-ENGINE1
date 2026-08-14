import { describe, expect, it } from 'vitest';
import * as engine from '@hybrid/engine';
import {
  STRENGTH_ENGINE_VERSION,
  liftAdapt,
  nextWorkingWeight,
  prefillPrimary,
} from '.';

/*
 * WHAT THIS PACKAGE IS NOW, and why the file was rewritten.
 *
 * It had one test, and it covered the proposal boundary: `workoutToStrengthProposal`
 * emitting a small versioned proposal for the Coordinator to arbitrate, with an
 * assertion that no logged-set data (`aVal`) leaked into it. The Coordinator was
 * deleted on 14 August 2026 and took the boundary with it — its only consumer was
 * `@hybrid/coordinator-adapter`, deleted in the same cut.
 *
 * That left the package with NO test files at all, which is worse than it sounds:
 * `vitest run` exits 1 on "No test files found", so `pnpm run test` failed at this
 * package and never reached the ones after it. The whole suite was red for a reason
 * that had nothing to do with any code.
 *
 * The fix is not `--passWithNoTests`. CLAUDE.md's rule is that a test which stops
 * being collected does not fail, it silently disappears — and that flag would make
 * exactly that outcome permanent here, so a future package that lost its real tests
 * would go quiet instead of red.
 *
 * So this covers what the package actually still claims. CLAUDE.md says
 * "@hybrid/strength-engine owns lifting progression and Strength proposals"; the
 * proposals half is gone, and what remains is a deliberately thin re-export of the
 * three engine functions that ARE lifting progression. A re-export is worth pinning
 * for one specific reason: it is exactly the kind of line that gets dropped in an
 * unrelated edit, and nothing else would notice until an app failed to import.
 *
 * The assertions are behavioural, not identity-only. `toBe(engine.x)` alone would
 * pass against a re-export of the wrong symbol if the names ever moved, so each one
 * is also CALLED and its answer checked.
 */

describe('@hybrid/strength-engine — the surface it owns', () => {
  it('re-exports the three lifting-progression functions, and they are the engine’s own', () => {
    expect(liftAdapt).toBe(engine.liftAdapt);
    expect(nextWorkingWeight).toBe(engine.nextWorkingWeight);
    expect(prefillPrimary).toBe(engine.prefillPrimary);
  });

  it('nextWorkingWeight answers through this package’s export', () => {
    /* Called rather than merely identity-checked: if the re-export list were ever
       reshuffled onto a same-shaped but different symbol, identity alone could
       still pass. This asserts the behaviour arrives.

       Signature is `(name, settings?, whoop?)` — no bare weight argument. Getting
       that wrong is what this call is here to keep honest. */
    expect(nextWorkingWeight('Back squat')).toBeNull();
    const banked = nextWorkingWeight('Back squat', { liftProgress: { 'back squat': { kg: 100, at: 1 } } });
    expect(banked?.kg).toBe(100);
  });

  it('declares a version, which is the only thing here that is not the engine’s', () => {
    expect(STRENGTH_ENGINE_VERSION).toBe('1.0.0');
  });

  it('does NOT re-export a proposal boundary — the Coordinator is deleted', async () => {
    /* The deleted test's subject, inverted. `workoutToStrengthProposal` and
       `strengthProposals` fed an arbitrator that no longer exists, and a proposal
       type with nothing to read it is a shape that suggests a handoff still
       happens. This fails if either is ever re-added without a decision. */
    const surface = await import('.');
    expect(surface).not.toHaveProperty('workoutToStrengthProposal');
    expect(surface).not.toHaveProperty('strengthProposals');
  });
});
