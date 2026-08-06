import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
} from "./concept2-api.mjs";
import { syncResults } from "./sync.mjs";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Function 1: start OAuth. Persist state in the app's server-side/session layer.
export function startConcept2OAuth({ clientId, redirectUri, state, scopes } = {}) {
  const location = buildAuthorizeUrl({ clientId, redirectUri, state, scopes });
  return { statusCode: 302, headers: { location }, body: "" };
}

// Function 2: callback. The caller must persist the token response securely.
// This example intentionally does not implement storage.
export async function handleConcept2Callback({
  query = {},
  clientId,
  clientSecret,
  redirectUri,
  scopes,
  fetchImpl,
} = {}) {
  if (query.error) {
    return json(400, {
      error: query.error,
      description: query.error_description || null,
    });
  }
  if (!query.code) {
    return json(400, { error: "missing_code" });
  }
  const tokens = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    code: query.code,
    redirectUri,
    scopes,
    fetchImpl,
  });
  return json(200, { tokens });
}

// Function 3: periodic sync. Supply a server-side token, not a browser token.
export function syncConcept2Account(options = {}) {
  return syncResults(options);
}
