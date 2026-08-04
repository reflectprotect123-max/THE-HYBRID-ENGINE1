import { parseProductId, productDefinition, type ProductId } from '@hybrid/product-scope';

/**
 * The same web source can produce two independently deployed products. The
 * build profile is the boundary; the domain packages and shared contracts are
 * still compiled together so the two releases cannot silently disagree about
 * data shapes.
 */
export const PRODUCT_ID: ProductId = parseProductId(import.meta.env.VITE_HYBRID_PRODUCT);
export const PRODUCT = productDefinition(PRODUCT_ID);
