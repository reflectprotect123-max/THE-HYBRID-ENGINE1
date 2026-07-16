export const BASE_URL = (process.env.APP_BASE_URL || process.env.URL || 'https://thehybridengine1.netlify.app').replace(/\/$/, '');
export const config = {
  appBaseUrl: BASE_URL,
  sessionSecret: process.env.APP_SESSION_SECRET || '',
  whoopClientId: process.env.WHOOP_CLIENT_ID || '',
  whoopClientSecret: process.env.WHOOP_CLIENT_SECRET || '',
  stravaClientId: process.env.STRAVA_CLIENT_ID || '',
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET || '',
  stravaWebhookVerifyToken: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || '',
  whoopCallback: `${BASE_URL}/.netlify/functions/whoop-callback`,
  whoopWebhook: `${BASE_URL}/.netlify/functions/whoop-webhook`,
  stravaCallback: `${BASE_URL}/.netlify/functions/strava-callback`,
  stravaWebhook: `${BASE_URL}/.netlify/functions/strava-webhook`,
};

export function requireConfig(...keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new Error(`Missing Netlify environment variables: ${missing.join(', ')}`);
}
