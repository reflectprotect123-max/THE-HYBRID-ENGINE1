import { parseProductId, productDefinition, type ProductId } from '@hybrid/product-scope';

/** Expo inlines EXPO_PUBLIC_* values into each product build. */
export const PRODUCT_ID: ProductId = parseProductId(process.env.EXPO_PUBLIC_HYBRID_PRODUCT);
export const PRODUCT = productDefinition(PRODUCT_ID);
