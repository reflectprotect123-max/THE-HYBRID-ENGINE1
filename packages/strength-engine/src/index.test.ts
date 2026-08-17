import { describe, it, expect } from 'vitest';
import { STRENGTH_ENGINE_PACKAGE } from './index';

describe('package scaffold', () => {
  it('exports a package marker', () => {
    expect(STRENGTH_ENGINE_PACKAGE).toBe('@hybrid/strength-engine');
  });
});
