import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  getResult,
  getStrokes,
  normalizeResult,
} from "../src/concept2-api.mjs";
import { syncResults } from "../src/sync.mjs";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test("builds an explicit comma-delimited authorization request", () => {
  const url = new URL(buildAuthorizeUrl({
    clientId: "client-123",
    redirectUri: "https://app.example/callback",
    state: "state-456",
  }));
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "user:read,results:read");
  assert.equal(url.searchParams.get("state"), "state-456");
});

test("posts the documented authorization-code form", async () => {
  let request;
  const result = await exchangeAuthorizationCode({
    clientId: "client-123",
    clientSecret: "secret-456",
    code: "code-789",
    redirectUri: "https://app.example/callback",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response(200, { access_token: "access", refresh_token: "refresh", expires_in: 604800 });
    },
  });
  assert.equal(result.access_token, "access");
  assert.equal(request.url, "https://log.concept2.com/oauth/access_token");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["content-type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(request.options.body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("scope"), "user:read,results:read");
});

test("normalizes a result without forcing stroke data", () => {
  const normalized = normalizeResult({
    data: {
      id: 42,
      user_id: 7,
      type: "bike",
      date: "2026-01-07 18:30:00",
      workout_type: "JustRow",
      time: 12000,
      distance: 5000,
    },
  });
  assert.deepEqual(normalized.externalId, "42");
  assert.equal(normalized.modality, "bike");
  assert.equal(normalized.strokeDataAvailable, false);
});

test("treats a stroke 404 as valid summary-only data", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const text = String(url);
    calls.push(text);
    if (text.endsWith("/strokes")) {
      return response(404, { message: "no associated stroke data" });
    }
    if (text.includes("/api/users/me/results/1")) {
      return response(200, {
        data: {
          id: 1,
          type: "rower",
          date: "2026-01-07 18:30:00",
          time: 12000,
          distance: 5000,
        },
      });
    }
    return response(200, {
      data: [{ id: 1, type: "rower" }],
      meta: { pagination: { total_pages: 1 } },
    });
  };
  const result = await syncResults({
    accessToken: "token",
    fetchImpl,
    maxPages: 1,
    syncedAt: "2026-07-31T00:00:00.000Z",
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].strokeDataUnavailable, true);
  assert.equal(result.results[0].normalized.strokeDataAvailable, false);
  assert.equal(calls.length, 3);
});

test("raises the HTTP status for a non-404 stroke failure", async () => {
  await assert.rejects(
    () => getStrokes({
      accessToken: "token",
      resultId: 1,
      fetchImpl: async () => response(500, { message: "server error" }),
    }),
    (error) => error.status === 500,
  );
});

test("gets result detail with the documented include hint", async () => {
  let requested;
  await getResult({
    accessToken: "token",
    resultId: 9,
    include: "strokes,metadata,user",
    fetchImpl: async (url) => {
      requested = new URL(url);
      return response(200, { data: { id: 9 } });
    },
  });
  assert.equal(requested.pathname, "/api/users/me/results/9");
  assert.equal(requested.searchParams.get("include"), "strokes,metadata,user");
});
