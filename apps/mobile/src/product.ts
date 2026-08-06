import { productDefinition, type ProductId } from '@hybrid/product-scope';

const raw = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;

/**
 * Expo inlines EXPO_PUBLIC_* values into each product build. Unset means the
 * MERGED app (see IS_MERGED below) — historically it meant strength, and
 * eas.json's `development`/`preview`/`production` profiles still set no `env`
 * block, which is exactly how existing strength installs become the merged
 * app on update. Only the two `conditioning-*` profiles set this var, for the
 * farewell release. Throwing on `undefined` would crash every merged build
 * and every local `expo start`.
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
/**
 * Unset now means the MERGED app — both worlds in one install. That is what
 * the existing strength `preview`/`production` EAS profiles produce (they set
 * no env block), so the strength app updates in place into the merged app. A
 * SET value builds a legacy single-product app; that path exists for the
 * conditioning farewell release and is removed with it (see the Android app
 * merge plan, Task 9). The empty string counts as unset because some CI and
 * test layers coerce a deleted variable to ''.
 */
export const IS_MERGED = raw === undefined || raw === '';
export const PRODUCT_ID: ProductId = raw === 'conditioning' ? 'conditioning' : 'strength';
export const PRODUCT = productDefinition(PRODUCT_ID);
