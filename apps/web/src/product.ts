import { parseProductId, productDefinition, type ProductId } from '@hybrid/product-scope';

/**
 * The same web source can produce two independently deployed products. The
 * build profile is the boundary; the domain packages and shared contracts are
 * still compiled together so the two releases cannot silently disagree about
 * data shapes.
 */
export const PRODUCT_ID: ProductId = parseProductId(import.meta.env.VITE_HYBRID_PRODUCT);

const rawProduct = import.meta.env.VITE_HYBRID_PRODUCT;

/*
 * The live deployment never sets VITE_HYBRID_PRODUCT — it's a single,
 * unfiltered dashboard, not one of the two branded athlete builds. Borrowing
 * strength's display name for that default case was a latent mislabeling:
 * only the display name is overridden here, everything else about `PRODUCT`
 * (owns/canRead/canWrite/primaryAction) stays whatever productDefinition
 * gives strength, since nothing on web renders those fields today.
 */
export const PRODUCT = rawProduct === 'strength' || rawProduct === 'conditioning'
  ? productDefinition(PRODUCT_ID)
  : { ...productDefinition(PRODUCT_ID), name: 'THE Hybrid System — Dashboard', shortName: 'Dashboard' };

/*
 * True only for the two branded, single-purpose builds. The live dashboard
 * build sets no VITE_HYBRID_PRODUCT at all and stays unfiltered on purpose —
 * gating nav or screen content on PRODUCT_ID alone would wrongly narrow that
 * build too, since PRODUCT_ID silently falls back to 'strength'.
 */
export const IS_SCOPED_BUILD = rawProduct === 'strength' || rawProduct === 'conditioning';

/*
 * Where the athlete app's Home actually lives on this build.
 *
 * `/` is Home on a branded build and the COACH BENCH on the unscoped dashboard
 * one, so anything that means "send the athlete home" has to ask rather than
 * assume. Three callers need it and had been deriving it separately — the Home
 * nav tab, the training route tree's catch-all, and the way back out of the
 * nutrition world — and the two that got it wrong both ejected the athlete into
 * the coach workspace, which is the one place the athlete app must never send
 * them. One function so they cannot disagree again.
 *
 * Takes the flag rather than reading the constant so it stays testable against
 * both builds from a single test run.
 */
export function athleteHomePath(isScopedBuild: boolean) {
  return isScopedBuild ? '/' : '/home';
}

export const ATHLETE_HOME = athleteHomePath(IS_SCOPED_BUILD);
