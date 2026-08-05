# Web Dashboard Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live web app's visible identity (PWA manifest name/short_name, one `aria-label`) says "THE Hybrid System — Dashboard" instead of "THE Strength System" — zero data/functional change, zero effect on mobile.

**Architecture:** Two display-string edits in already-existing conditionals — `apps/web/vite.config.ts`'s manifest name/short_name/description ternaries, and a new default-case override in `apps/web/src/product.ts`. No new files, no new packages.

**Tech Stack:** Vite, vite-plugin-pwa, TypeScript.

## Global Constraints

- `packages/product-scope`'s shared `DEFINITIONS` are not modified — `apps/mobile` depends on them for its real strength/conditioning identities.
- `PRODUCT_ID`'s value and the `data-product` attribute's value are unchanged — only display strings (`PRODUCT.name`, `PRODUCT.shortName`, the PWA manifest fields) change.
- `apps/web/vite.config.ts`'s `conditioningBuild` (true) branch is not modified — only the default/strength branch's strings change.
- Confirmed via `grep -rn "PRODUCT\.\|data-product" apps/web/src` (all `*.tsx`/`*.css`): the only consumer of `PRODUCT.name` on web is `apps/web/src/App.tsx:88`'s `aria-label={PRODUCT.name}`. No other consumer, no CSS keyed on `data-product`.

---

### Task 1: Rebrand the manifest and the aria-label

**Files:**
- Modify: `apps/web/vite.config.ts:7-8,35-37`
- Modify: `apps/web/src/product.ts` (whole file, 9 lines)

**Interfaces:** None — this task is display strings only, no new exports, no signature changes.

- [ ] **Step 1: Change the manifest name/short_name in `apps/web/vite.config.ts`**

Current (lines 7-8):

```ts
const productName = conditioningBuild ? 'THE Conditioning System' : 'THE Strength System';
const productShortName = conditioningBuild ? 'Conditioning' : 'Strength';
```

Change to:

```ts
const productName = conditioningBuild ? 'THE Conditioning System' : 'THE Hybrid System — Dashboard';
const productShortName = conditioningBuild ? 'Conditioning' : 'Dashboard';
```

- [ ] **Step 2: Change the manifest description**

Current (lines 35-37):

```ts
        description: conditioningBuild
          ? 'Conditioning training — run, ride, row, recover.'
          : 'Strength training — lift, progress, recover.',
```

Change to:

```ts
        description: conditioningBuild
          ? 'Conditioning training — run, ride, row, recover.'
          : 'Train, program, and track — strength and conditioning in one place.',
```

- [ ] **Step 3: Override the display name in `apps/web/src/product.ts`**

Current (full file):

```ts
import { parseProductId, productDefinition, type ProductId } from '@hybrid/product-scope';

/**
 * The same web source can produce two independently deployed products. The
 * build profile is the boundary; the domain packages and shared contracts are
 * still compiled together so the two releases cannot silently disagree about
 * data shapes.
 */
export const PRODUCT_ID: ProductId = parseProductId(import.meta.env.VITE_HYBRID_PRODUCT);
export const PRODUCT = productDefinition(PRODUCT_ID);
```

Change to:

```ts
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
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: no errors.

- [ ] **Step 5: Build and spot-check the manifest**

Run: `pnpm --filter @hybrid/web build`
Then: `grep -A2 '"name"' apps/web/dist/manifest.webmanifest`
Expected: `"name":"THE Hybrid System — Dashboard"` and `"short_name":"Dashboard"`.

- [ ] **Step 6: Confirm mobile is unaffected**

Run: `pnpm --filter @hybrid/mobile typecheck && pnpm --filter @hybrid/mobile test`
Expected: unchanged pass (mobile's `PRODUCT` comes from `apps/mobile/src/product.ts`, a separate file, not touched by this task).

- [ ] **Step 7: Commit**

```bash
git add apps/web/vite.config.ts apps/web/src/product.ts
git commit -m "web: rebrand the live deployment's display identity to the dashboard"
```

---

## Self-Review

- **Spec coverage:** manifest name/short_name/description → Steps 1-2. `aria-label` (via `PRODUCT.name`) → Step 3. "Zero effect on mobile" → Step 6. "Zero effect on `PRODUCT_ID`/`data-product`" → Step 3's override touches only `name`/`shortName`, `PRODUCT_ID` itself is unchanged.
- **Placeholder scan:** none.
- **Type consistency:** `PRODUCT`'s shape (`{ ...ProductDefinition, name, shortName }`) is a strict superset of `ProductDefinition` in both branches of Step 3's ternary — no type narrowing issue, `PRODUCT.name`/`PRODUCT.shortName` remain `string` either way.
