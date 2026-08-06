/*
 * product.ts reads EXPO_PUBLIC_HYBRID_PRODUCT once, at module eval, so each
 * case re-evaluates the module in an isolated registry with its own binding.
 * Jest injects describe/it/expect/afterEach as globals.
 */
const PREVIOUS = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
afterEach(() => {
  if (PREVIOUS === undefined) delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  else process.env.EXPO_PUBLIC_HYBRID_PRODUCT = PREVIOUS;
});

it('treats an unset product as the merged app', () => {
  delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { IS_MERGED, PRODUCT_ID } = require('../src/product') as typeof import('../src/product');
    expect(IS_MERGED).toBe(true);
    expect(PRODUCT_ID).toBe('strength');
  });
});

it('treats a set product as a legacy single-product build', () => {
  process.env.EXPO_PUBLIC_HYBRID_PRODUCT = 'conditioning';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { IS_MERGED, PRODUCT_ID } = require('../src/product') as typeof import('../src/product');
    expect(IS_MERGED).toBe(false);
    expect(PRODUCT_ID).toBe('conditioning');
  });
});

it('still fails loudly on a garbage value', () => {
  process.env.EXPO_PUBLIC_HYBRID_PRODUCT = 'strenght';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('../src/product')).toThrow(/must be unset/);
  });
});
