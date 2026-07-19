const configuredBaseUrl = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(configuredBaseUrl)) {
  throw new Error('APP_BASE_URL must be configured as an explicit HTTPS URL');
}
export const BASE_URL = configuredBaseUrl;
export const config = {
  appBaseUrl: BASE_URL,
  sessionSecret: process.env.APP_SESSION_SECRET || '',
  whoopClientId: process.env.WHOOP_CLIENT_ID || '',
  whoopClientSecret: process.env.WHOOP_CLIENT_SECRET || '',
  whoopCallback: `${BASE_URL}/.netlify/functions/whoop-callback`,
  whoopWebhook: `${BASE_URL}/.netlify/functions/whoop-webhook`,
};

export function requireConfig(...keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new Error(`Missing Netlify environment variables: ${missing.join(', ')}`);
}
