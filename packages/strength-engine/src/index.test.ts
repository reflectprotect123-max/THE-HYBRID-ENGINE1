import { describe, it, expect } from 'vitest';
import * as engine from './index';

describe('package barrel', () => {
  it('exports the full public surface', () => {
    expect(typeof engine.resolveTarget).toBe('function');
    expect(typeof engine.roundToIncrement).toBe('function');
    expect(typeof engine.e1rm).toBe('function');
    expect(typeof engine.currentWorkingMax).toBe('function');
    expect(typeof engine.detectPr).toBe('function');
    expect(typeof engine.sessionLoad).toBe('function');
    expect(typeof engine.resolveSessionForPublish).toBe('function');
  });
});
