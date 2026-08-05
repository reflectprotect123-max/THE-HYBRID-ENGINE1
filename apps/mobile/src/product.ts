import { productDefinition, type ProductId } from '@hybrid/product-scope';

const raw = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;

/**
 * Expo inlines EXPO_PUBLIC_* values into each product build. This value now
 * decides which half of an athlete's workouts/sessions this build keeps on
 * device (see restrictToProduct in @hybrid/engine) — a silent fallback here
 * would mean a misconfigured build quietly pruning the wrong product's data
 * on the athlete's phone. Fail at launch instead.
 */
if (raw !== 'strength' && raw !== 'conditioning') {
  throw new Error(
    `EXPO_PUBLIC_HYBRID_PRODUCT must be "strength" or "conditioning", got ${JSON.stringify(raw)}. This build cannot start without knowing which product's data to keep on device.`,
  );
}
export const PRODUCT_ID: ProductId = raw;
export const PRODUCT = productDefinition(PRODUCT_ID);
