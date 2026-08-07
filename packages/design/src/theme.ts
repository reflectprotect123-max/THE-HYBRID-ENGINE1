import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { ProductId } from '@hybrid/product-scope';
import { conditioningColor, nutritionColor, strengthColor, type Palette } from './tokens';

/**
 * Which WORLD the athlete is in — the thing the app themes, tabs and switches
 * by. A superset of `ProductId` on purpose: `ProductId` is a TRAINING identity
 * that sync partitions, product-scope and the ecosystem contract key off, so
 * admitting `'nutrition'` to it would tell those layers a nutrition world is a
 * kind of training. It is not; it is a third world that happens to share the
 * switch.
 */
export type WorldId = ProductId | 'nutrition';

export const WORLDS: readonly WorldId[] = ['strength', 'conditioning', 'nutrition'];

/** Pure so it is testable without mounting anything React. */
export function resolvePalette(world: WorldId): Palette {
  if (world === 'conditioning') return conditioningColor;
  if (world === 'nutrition') return nutritionColor;
  return strengthColor;
}

/* This package's `react` devDependency must stay pinned to the EXACT version
   apps/mobile/package.json uses, or pnpm can install a second React copy and
   silently reintroduce "Invalid hook call" errors for hooks like this
   context's (see commit 0e06aaa for the original bug). */
const ThemeContext = createContext<Palette>(strengthColor);

/**
 * Wrap an app root in this, passing the world the athlete is in, and every
 * `useTheme()` below it resolves to that world's palette.
 *
 * Unwrapped consumers — which is every existing test, since none of them
 * know this exists yet — get strength's palette from the context's default
 * value rather than a thrown error. That default is what keeps this change
 * from being a breaking one.
 */
export function ThemeProvider({ world, children }: { world: WorldId; children: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: resolvePalette(world) }, children);
}

export function useTheme(): { color: Palette } {
  return { color: useContext(ThemeContext) };
}
