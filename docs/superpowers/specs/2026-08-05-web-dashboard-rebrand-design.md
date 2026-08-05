# Web dashboard rebrand

## Problem

The live web app (`https://thehybridengine1.netlify.app`) has no data-layer product filtering — it already shows and lets you program both strength and conditioning, unfiltered, functioning as the shared dashboard. But it's branded "THE Strength System" by default, which makes it look like one of the two athlete-facing apps rather than the distinct dashboard surface it actually is.

Explicitly not in scope: reviving the codebase's earlier "coach" feature (a second human coaching an athlete via invite code — deliberately removed twice, per `git log --oneline --all | grep -i coach`). This is a personal rebrand for the single existing user, not a multi-user feature.

## Goal

The live web app's visible identity — PWA install name, home-screen icon label, and the one internal `aria-label` that reads it — says "THE Hybrid System — Dashboard" instead of "THE Strength System", with zero functional/data change to any screen, and zero effect on `apps/mobile`'s real strength/conditioning identities.

## Scope, confirmed narrow

- The browser tab title (`apps/web/index.html`'s `<title>`) already says "THE Hybrid System" — not touched, already correct.
- The actual leak is `apps/web/vite.config.ts`'s manifest `productName`/`productShortName`/description, used by the PWA install prompt and home-screen icon, and `apps/web/src/product.ts`'s `PRODUCT.name`, whose only consumer is one `aria-label` in `apps/web/src/App.tsx:88` (confirmed via `grep -rn "PRODUCT\.\|data-product" apps/web/src` — no other consumer, no CSS keyed on `data-product`).
- `packages/product-scope`'s shared `DEFINITIONS` (the source of `productDefinition('strength').name`) are NOT touched — `apps/mobile` depends on those for its real, deployed strength/conditioning identities.
- `PRODUCT_ID`'s value, the `data-product` attribute's value, and `build:conditioning`'s branch of `vite.config.ts` are NOT touched — only the default (non-conditioning) branch's display strings change.

## Design

**`apps/web/vite.config.ts`:** in the existing ternary (`conditioningBuild ? 'THE Conditioning System' : 'THE Strength System'`), change only the `: 'THE Strength System'` branch to `: 'THE Hybrid System — Dashboard'`, and the parallel `productShortName` ternary's strength branch from `'Strength'` to `'Dashboard'`. Update the manifest `description` string's non-conditioning branch similarly (currently "Strength training — lift, progress, recover." — becomes something naming both disciplines, e.g. "Train, program, and track — strength and conditioning in one place.").

**`apps/web/src/product.ts`:** currently re-exports `PRODUCT = productDefinition(PRODUCT_ID)` directly. Add a display override for the default case only: when `import.meta.env.VITE_HYBRID_PRODUCT` is not explicitly `'strength'` or `'conditioning'` (i.e., the actual live, unset case), `PRODUCT.name`/`PRODUCT.shortName` become `'THE Hybrid System — Dashboard'`/`'Dashboard'` instead of inheriting strength's. `PRODUCT_ID` itself, and every other field on `PRODUCT` (`owns`/`canRead`/`canWrite`/`primaryAction`), stay exactly as `productDefinition('strength')` provides — none of them render anywhere on web today, so overriding them would be scope creep with no visible effect.

## Testing

No new automated test — this is display-string-only, and `apps/web` has no existing test that asserts on `vite.config.ts`'s manifest strings or `PRODUCT.name`. Verification is: `pnpm --filter @hybrid/web typecheck` stays clean, `pnpm --filter @hybrid/web build` still produces a valid manifest (spot-check `dist/manifest.webmanifest`'s `name`/`short_name` fields after a local build), and a visual check that `apps/mobile`'s own strength/conditioning builds are unaffected (their `PRODUCT.name` comes from `apps/mobile/src/product.ts`, a separate file, untouched by this change).
