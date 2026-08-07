/*
 * product.ts is now only a build-config guard: EXPO_PUBLIC_HYBRID_PRODUCT
 * retired with the standalone apps, and a stale profile resurrecting it must
 * fail the build loudly, not quietly select a flavor that no longer exists.
 * Jest injects describe/it/expect/afterEach as globals.
 */
const PREVIOUS = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
afterEach(() => {
  if (PREVIOUS === undefined) delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  else process.env.EXPO_PUBLIC_HYBRID_PRODUCT = PREVIOUS;
});

it('starts cleanly with the variable unset', () => {
  delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('./product')).not.toThrow();
  });
});

it('refuses to start when the retired variable is set — even to an old valid value', () => {
  for (const stale of ['strength', 'conditioning', 'strenght']) {
    process.env.EXPO_PUBLIC_HYBRID_PRODUCT = stale;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      expect(() => require('./product')).toThrow(/no longer supported/);
    });
  }
});
