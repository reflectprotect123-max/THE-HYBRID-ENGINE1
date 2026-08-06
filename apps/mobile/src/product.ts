/**
 * The merged app has no product flavor. EXPO_PUBLIC_HYBRID_PRODUCT used to
 * select the strength or conditioning build; both retired when the apps
 * merged (see docs/superpowers/specs/2026-08-06-android-app-merge-design.md
 * and the farewell release built from the pre-cleanup history).
 *
 * The guard stays because the variable failing SILENTLY is how a stale CI
 * profile or env file would resurrect a single-product build without anyone
 * noticing. If it is set at all, refuse to start.
 */
const raw = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
if (raw !== undefined && raw !== '') {
  throw new Error(
    `EXPO_PUBLIC_HYBRID_PRODUCT is no longer supported (got ${JSON.stringify(raw)}). ` +
      'The app is merged — both disciplines ship in every build. Remove the variable ' +
      'from the build profile or environment.',
  );
}

export {};
