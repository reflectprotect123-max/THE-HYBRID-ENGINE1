const appJson = require('./app.json');

/*
 * app.json is plain JSON — it cannot read process.env, so a committed
 * "$GOOGLE_MAPS_API_KEY" placeholder would ship as that literal string, not
 * an actual key. This dynamic config is the one override that needs an
 * environment variable (the EAS secret set via `eas secret:create`); every
 * other field stays exactly as app.json declares it.
 *
 * The per-product identity fork that used to live here (conditioning
 * name/slug/scheme/package/EAS project) retired with the standalone
 * conditioning app — the merged app IS app.json's identity. See
 * docs/superpowers/specs/2026-08-06-android-app-merge-design.md.
 */
module.exports = () => ({
  ...appJson.expo,
  android: {
    ...appJson.expo.android,
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      },
    },
  },
});
