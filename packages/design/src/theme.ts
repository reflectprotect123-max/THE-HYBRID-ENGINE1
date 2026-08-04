import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { ProductId } from '@hybrid/product-scope';
import { conditioningColor, strengthColor, type Palette } from './tokens';

/** Pure so it is testable without mounting anything React. */
export function resolvePalette(productId: ProductId): Palette {
  return (productId === 'conditioning' ? conditioningColor : strengthColor) as Palette;
}

const ThemeContext = createContext<Palette>(strengthColor);

/**
 * Wrap an app root in this, passing the build's `PRODUCT_ID`, and every
 * `useTheme()` below it resolves to that product's palette.
 *
 * Unwrapped consumers — which is every existing test, since none of them
 * know this exists yet — get strength's palette from the context's default
 * value rather than a thrown error. That default is what keeps this change
 * from being a breaking one.
 */
export function ThemeProvider({ productId, children }: { productId: ProductId; children: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: resolvePalette(productId) }, children);
}

export function useTheme(): { color: Palette } {
  return { color: useContext(ThemeContext) };
}
