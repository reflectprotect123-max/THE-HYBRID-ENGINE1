import { describe, expect, it } from 'vitest';
import { allProductDefinitions, parseProductId, productDefinition } from '../src';

describe('product scope', () => {
  it('only accepts the two independently deployable product identities', () => {
    expect(parseProductId('conditioning')).toBe('conditioning');
    expect(parseProductId('anything')).toBe('strength');
    expect(allProductDefinitions()).toHaveLength(2);
  });

  it('keeps domain ownership explicit', () => {
    expect(productDefinition('strength').canWrite).not.toContain('conditioning sessions');
    expect(productDefinition('conditioning').canWrite).not.toContain('strength sessions');
  });
});
