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
