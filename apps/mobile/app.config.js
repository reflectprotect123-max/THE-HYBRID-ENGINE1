const appJson = require('./app.json');

const isConditioning = process.env.EXPO_PUBLIC_HYBRID_PRODUCT === 'conditioning';
const productName = isConditioning ? 'THE Conditioning System' : appJson.expo.name;
const productSlug = isConditioning ? 'conditioning-system' : appJson.expo.slug;
const productScheme = isConditioning ? 'conditioningsystem' : appJson.expo.scheme;
const conditioningEasProjectId = process.env.EXPO_PUBLIC_CONDITIONING_EAS_PROJECT_ID;

/*
 * app.json is plain JSON — it cannot read process.env, so a committed
 * "$GOOGLE_MAPS_API_KEY" placeholder would ship as that literal string, not
 * an actual key. This dynamic config is the one override that needs an
 * environment variable (the EAS secret set via `eas secret:create`); every
 * other field stays exactly as app.json declares it.
 */
module.exports = () => ({
  ...appJson.expo,
  name: productName,
  slug: productSlug,
  scheme: productScheme,
  updates: isConditioning && conditioningEasProjectId
    ? { ...appJson.expo.updates, url: `https://u.expo.dev/${conditioningEasProjectId}` }
    : appJson.expo.updates,
  android: {
    ...appJson.expo.android,
    ...(isConditioning ? { package: 'com.hybridengine.conditioning' } : {}),
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      },
    },
  },
  ios: {
    ...appJson.expo.ios,
    ...(isConditioning ? { bundleIdentifier: 'com.hybridengine.conditioning' } : {}),
  },
  extra: {
    ...appJson.expo.extra,
    eas: isConditioning
      ? (conditioningEasProjectId ? { projectId: conditioningEasProjectId } : undefined)
      : appJson.expo.extra.eas,
    product: isConditioning ? 'conditioning' : 'strength',
  },
});
