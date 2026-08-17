import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { METRICS } from './metric';

// packages/strength-engine/src -> repo root is three levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const metricTsPath = resolve(repoRoot, 'packages/strength-engine/src/metric.ts');
const generatorPath = resolve(repoRoot, 'scripts/gen-metric-registry.mjs');

describe('metric registry', () => {
  it('every MetricKey has a METRICS entry', () => {
    const keys: (keyof typeof METRICS)[] = [
      'load', 'reps', 'rpe', 'rir', 'tempo', 'rest',
      'distance', 'duration', 'calories', 'watts', 'height',
    ];
    for (const k of keys) expect(METRICS[k]).toBeDefined();
  });

  it('regenerating from the current migration produces byte-identical output', () => {
    const before = readFileSync(metricTsPath, 'utf8');
    execSync(`node ${JSON.stringify(generatorPath)}`, { cwd: repoRoot });
    const after = readFileSync(metricTsPath, 'utf8');
    expect(after).toBe(before);
  });

  it('tempo has no higher/lower direction', () => {
    expect(METRICS.tempo.higherIsBetter).toBeNull();
  });

  it('load is the only load-bearing metric', () => {
    const loadBearing = Object.values(METRICS).filter(m => m.isLoadBearing);
    expect(loadBearing).toHaveLength(1);
    expect(loadBearing[0].key).toBe('load');
  });
});
