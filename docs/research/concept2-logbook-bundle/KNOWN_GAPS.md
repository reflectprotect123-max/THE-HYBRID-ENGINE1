# Known Gaps and Required Validation

These are deliberate gaps, not omissions.

## No current source found

- Whether Concept2 supports PKCE (`code_challenge`/`code_verifier`).
- Whether read-only production app registration is instant or manually approved.
- Whether HTTP Basic authentication is accepted at the token endpoint.
- A formal numeric requests-per-minute or requests-per-day rate limit.
- The exact webhook registration API path.
- Webhook signatures, signing secrets, retry policy, delivery timeout, and
  receiver-authentication requirements.
- A guarantee that webhook payloads include nested `workout.splits` or strokes.
- A guarantee that every GET detail response includes nested `workout` data.
- A public Concept2 Logbook API for live pace, watts, cadence, or heart rate.
- A formal API v2, deprecation notice, migration guide, replacement API, or
  recent official changelog.

## Required live-account tests

Before production code is approved, capture sanitized responses for:

1. RowErg Just Row.
2. RowErg fixed-distance splits.
3. RowErg fixed-time splits.
4. RowErg distance and variable intervals.
5. SkiErg workout with and without heart rate.
6. BikeErg workout, verifying pace units and whether the shared rate fields are
   represented as RPM.
7. MultiErg or mixed-machine intervals if the product will support them.
8. A manually entered or summary-only result with no stroke data.
9. A result updated after initial sync.
10. A deleted result and the webhook/polling recovery behaviour.

For every fixture, record the endpoint, request headers without tokens, API
version, HTTP status, raw response shape, and normalization output. Never put
access tokens, refresh tokens, or personal workout data in this archive.

