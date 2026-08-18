import { describe, it, expect } from 'vitest';
import * as engine from './index';

describe('package barrel', () => {
  it('exports the full public surface', () => {
    expect(typeof engine.resolveTarget).toBe('function');
    expect(typeof engine.roundLoadToEquipment).toBe('function');
    expect(typeof engine.e1rm).toBe('function');
    expect(typeof engine.currentWorkingMax).toBe('function');
    expect(typeof engine.detectPr).toBe('function');
    expect(typeof engine.sessionLoad).toBe('function');
    expect(typeof engine.resolveSessionForPublish).toBe('function');
    expect(typeof engine.strengthExposuresFor).toBe('function');
    expect(typeof engine.calibrationStateFor).toBe('function');
    expect(typeof engine.decideProgression).toBe('function');
    expect(typeof engine.anchorKgFor).toBe('function');
  });
});
