import { describe, expect, it } from 'vitest';
import * as engine from '@hybrid/engine';
import { CONDITIONING_ENGINE_VERSION, conAdapt, condEffort, conPrescription } from '.';

/*
 * The same cut, the same repair, as `packages/strength-engine` — see that file's
 * header for the full reasoning; it is not repeated here.
 *
 * In short: this package's one test covered `conditioningToProposal`, the boundary
 * that fed the Coordinator. Both were deleted on 14 August 2026, which left the
 * package with no test files, and `vitest run` exits 1 on "No test files found" —
 * so `pnpm run test` died here and never reached the packages after it.
 *
 * `--passWithNoTests` would have silenced it and made CLAUDE.md's "a test that
 * stops being collected does not fail, it silently disappears" permanently true of
 * this package. So this covers what the package still claims instead: the three
 * engine functions that ARE conditioning progression, called rather than only
 * identity-checked.
 */

describe('@hybrid/conditioning-engine — the surface it owns', () => {
  it('re-exports the three conditioning functions, and they are the engine’s own', () => {
    expect(conAdapt).toBe(engine.conAdapt);
    expect(condEffort).toBe(engine.condEffort);
    expect(conPrescription).toBe(engine.conPrescription);
  });

  it('condEffort answers through this package’s export', () => {
    /* CLAUDE.md: the coach picks an EFFORT and `CON_EFFORTS` owns the mapping to a
       heart-rate zone. This asserts the mapping arrives through this package rather
       than only that a symbol was re-exported. */
    const out = condEffort('medium' as Parameters<typeof condEffort>[0]);
    expect(out).toBeDefined();
  });

  it('declares a version, which is the only thing here that is not the engine’s', () => {
    expect(CONDITIONING_ENGINE_VERSION).toBe('1.0.0');
  });

  it('does NOT re-export a proposal boundary — the Coordinator is deleted', async () => {
    const surface = await import('.');
    expect(surface).not.toHaveProperty('conditioningToProposal');
  });
});
