import { productDefinition, type ProductId } from '@hybrid/product-scope';

const raw = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;

/**
 * Expo inlines EXPO_PUBLIC_* values into each product build. Unset means
 * strength — the long-standing convention every existing build profile and doc
 * relies on (eas.json's `development`/`preview`/`production` profiles set no
 * `env` block at all, only the two `conditioning-*` profiles set this var;
 * app.config.js reads it the same way; docs/ANDROID_BUILD.md documents the
 * strength build with the variable unset). Throwing on `undefined` would crash
 * every strength build and every local `expo start`.
 *
 * This value now also decides which half of an athlete's workouts/sessions this
 * build keeps on device (see restrictToProduct in @hybrid/engine), so a
 * DEFINED-but-wrong value (a typo, a misconfigured profile) must fail loudly
 * rather than silently prune the wrong product's data — that is what the check
 * below guards, not the unset case.
 */
if (raw !== undefined && raw !== 'strength' && raw !== 'conditioning') {
  throw new Error(
    `EXPO_PUBLIC_HYBRID_PRODUCT must be unset, "strength", or "conditioning", got ${JSON.stringify(raw)}. This build cannot start without knowing which product's data to keep on device.`,
  );
}
export const PRODUCT_ID: ProductId = raw === 'conditioning' ? 'conditioning' : 'strength';
export const PRODUCT = productDefinition(PRODUCT_ID);
