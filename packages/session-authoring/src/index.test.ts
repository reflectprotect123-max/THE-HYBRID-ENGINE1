import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SESSION_AUTHORING_VERSION } from './index';

describe('@hybrid/session-authoring', () => {
  it('is wired into the workspace', () => {
    expect(SESSION_AUTHORING_VERSION).toBe('1.0.0');
  });

  it('declares react as a peer, never a dependency — the apps own their renderer', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.peerDependencies.react).toBeDefined();
    expect(pkg.dependencies.react).toBeUndefined();
  });

  it('depends on nothing that resolves to a renderer', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
    expect(names).not.toContain('react-dom');
    expect(names).not.toContain('react-native');
  });
});
