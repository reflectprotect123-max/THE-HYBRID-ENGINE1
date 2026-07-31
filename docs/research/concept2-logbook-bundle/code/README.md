# Concept2 Starter Client

This is original reference code created for the research handoff. It is not an
official Concept2 SDK and it does not store credentials.

## Contents

- src/concept2-api.mjs — OAuth URL construction, token exchange, API calls,
  result normalization, and safe HTTP errors.
- src/sync.mjs — paginated result sync, detail hydration, and graceful
  handling of missing stroke data.
- src/serverless-shape.mjs — framework-neutral shapes for the three functions
  in the existing app pattern: start, callback, and sync.
- examples/ — sanitized documentation-shaped fixtures, not private workout data
  and not a guarantee of every live response.
- tests/ — Node's built-in test runner checks the contract and failure modes.

## Run the tests

    npm test

No package install is required. The code uses the platform fetch API.

## Before integration

1. Replace the placeholder token persistence with the app's server-side
   database/secrets layer.
2. Add OAuth state storage and validation across the start/callback boundary.
3. Confirm the registered redirect URI exactly.
4. Run the live-account fixture checklist in ../KNOWN_GAPS.md.
5. Preserve raw responses and never log access or refresh tokens.

