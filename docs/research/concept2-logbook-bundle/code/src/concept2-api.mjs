export const CONCEPT2 = Object.freeze({
  baseUrl: "https://log.concept2.com",
  authorizeUrl: "https://log.concept2.com/oauth/authorize",
  tokenUrl: "https://log.concept2.com/oauth/access_token",
  apiPrefix: "/api",
  accept: "application/vnd.c2logbook.v1+json",
});

function requireValue(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(name + " is required");
  }
  return value;
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : String(scopes || "").split(",");
  const cleaned = values.map((scope) => String(scope).trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new TypeError("at least one OAuth scope is required");
  }
  return [...new Set(cleaned)];
}

export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scopes = ["user:read", "results:read"],
} = {}) {
  const url = new URL(CONCEPT2.authorizeUrl);
  url.searchParams.set("client_id", requireValue(clientId, "clientId"));
  url.searchParams.set("scope", normalizeScopes(scopes).join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", requireValue(redirectUri, "redirectUri"));
  url.searchParams.set("state", requireValue(state, "state"));
  return url.toString();
}

async function readResponse(response) {
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON error bodies available to the caller.
  }
  if (!response.ok) {
    const error = new Error("Concept2 request failed with HTTP " + response.status);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function postForm(url, values, fetchImpl) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return readResponse(response);
}

export function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  scopes = ["user:read", "results:read"],
  fetchImpl = globalThis.fetch,
} = {}) {
  requireValue(clientId, "clientId");
  requireValue(clientSecret, "clientSecret");
  requireValue(code, "code");
  requireValue(redirectUri, "redirectUri");
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  return postForm(CONCEPT2.tokenUrl, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
    scope: normalizeScopes(scopes).join(","),
  }, fetchImpl);
}

export function refreshAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  scopes = ["user:read", "results:read"],
  fetchImpl = globalThis.fetch,
} = {}) {
  requireValue(clientId, "clientId");
  requireValue(clientSecret, "clientSecret");
  requireValue(refreshToken, "refreshToken");
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  return postForm(CONCEPT2.tokenUrl, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: normalizeScopes(scopes).join(","),
  }, fetchImpl);
}

async function apiGet(path, {
  accessToken,
  params,
  fetchImpl = globalThis.fetch,
} = {}) {
  requireValue(accessToken, "accessToken");
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  const url = new URL(CONCEPT2.baseUrl + path);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      authorization: "Bearer " + accessToken,
      accept: CONCEPT2.accept,
    },
  });
  return readResponse(response);
}

export function listResults({
  accessToken,
  page = 1,
  number = 250,
  from,
  to,
  type,
  updatedAfter,
  fetchImpl = globalThis.fetch,
} = {}) {
  return apiGet(CONCEPT2.apiPrefix + "/users/me/results", {
    accessToken,
    fetchImpl,
    params: {
      page,
      number,
      from,
      to,
      type,
      updated_after: updatedAfter,
    },
  });
}

export function getResult({ accessToken, resultId, include, fetchImpl = globalThis.fetch } = {}) {
  requireValue(String(resultId || ""), "resultId");
  return apiGet(
    CONCEPT2.apiPrefix + "/users/me/results/" + encodeURIComponent(resultId),
    { accessToken, fetchImpl, params: { include } },
  );
}

export function getStrokes({ accessToken, resultId, fetchImpl = globalThis.fetch } = {}) {
  requireValue(String(resultId || ""), "resultId");
  return apiGet(
    CONCEPT2.apiPrefix + "/users/me/results/" + encodeURIComponent(resultId) + "/strokes",
    { accessToken, fetchImpl },
  );
}

export function normalizeResult(result, { strokes = null, syncedAt = new Date().toISOString() } = {}) {
  const source = result && result.data ? result.data : (result || {});
  return {
    provider: "concept2_logbook",
    externalId: source.id == null ? null : String(source.id),
    providerUserId: source.user_id == null ? null : String(source.user_id),
    modality: source.type || null,
    startedAt: source.date_utc || source.date || null,
    durationRaw: source.time == null ? null : source.time,
    distanceRaw: source.distance == null ? null : source.distance,
    durationDisplay: source.time_formatted || null,
    workoutType: source.workout_type || "unknown",
    source: source.source || null,
    verified: source.verified == null ? null : source.verified,
    ranked: source.ranked == null ? null : source.ranked,
    privacy: source.privacy || null,
    workout: source.workout || null,
    metadata: source.metadata || null,
    strokes,
    strokeDataAvailable: strokes !== null,
    syncedAt,
  };
}

export { readResponse };
