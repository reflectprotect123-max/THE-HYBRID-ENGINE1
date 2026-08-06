const configuredBaseUrl = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(configuredBaseUrl)) {
  throw new Error('APP_BASE_URL must be configured as an explicit HTTPS URL');
}
export const BASE_URL = configuredBaseUrl;
/*
 * The native app's URL scheme, from apps/mobile/app.json ("expo.scheme").
 *
 * WHOOP's consent screen runs in the system browser, which cannot be handed
 * back to the app by any means except a redirect it recognises. This is a fixed
 * constant and is never taken from the request: a redirect target chosen by the
 * caller is an open redirect, and this one is reached with an authorization
 * code in flight.
 */
export const NATIVE_RETURN_URL = 'hybridengine://whoop';

export const config = {
  appBaseUrl: BASE_URL,
  sessionSecret: process.env.APP_SESSION_SECRET || '',
  whoopClientId: process.env.WHOOP_CLIENT_ID || '',
  whoopClientSecret: process.env.WHOOP_CLIENT_SECRET || '',
  whoopCallback: `${BASE_URL}/.netlify/functions/whoop-callback`,
  whoopWebhook: `${BASE_URL}/.netlify/functions/whoop-webhook`,
  concept2ClientId: process.env.CONCEPT2_CLIENT_ID || '',
  concept2ClientSecret: process.env.CONCEPT2_CLIENT_SECRET || '',
  concept2Callback: `${BASE_URL}/.netlify/functions/concept2-callback`,
  /*
   * Supabase. Both are OPTIONAL for the browser, which identifies itself with
   * the signed session cookie and never needs them, and REQUIRED for the native
   * app, which has no usable cookie and authenticates with its Supabase access
   * token instead. Absent, a bearer-authenticated request fails loudly with
   * `supabase_auth_unconfigured` rather than falling back to anything — see
   * _lib/supabase.mjs. SUPABASE_URL is public (it is the same project URL that
   * ships in the client bundle); SUPABASE_JWT_SECRET is not, and is only needed
   * while the project signs tokens with the legacy HS256 secret.
   */
  supabaseUrl: String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, ''),
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || '',
};

export function requireConfig(...keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new Error(`Missing Netlify environment variables: ${missing.join(', ')}`);
}
