# Research Request Captured

## Project context

The training app already has a three-function OAuth pattern for another
wearable: one function starts authorization, one handles the callback and code
exchange, and one periodically syncs data. The goal is to build the equivalent
Concept2 integration only after the current API contract is verified.

The target is the Concept2 Logbook at `log.concept2.com`, populated by PM5
monitors on RowErg, SkiErg, and BikeErg machines through workflows such as
ErgData, EXR, or a Wi-Fi-enabled PM5. The required output was a source-backed
answer in sections A/B/C rather than a plausible guessed API.

## Questions the research had to answer

### A. Authentication

- Is the public integration OAuth 2.0, and which grant types are documented?
- What are the real authorization and token URLs?
- Are refresh tokens supported, and what is their expiry behaviour?
- Where does a developer register a client ID and secret?
- Which scopes are available, and which one reads results and splits?
- Are PKCE, rate limits, commercial-use restrictions, or approval requirements
  documented?

### B. Results and splits

- What endpoint lists a user's results?
- What does the summary response actually look like?
- Is there a detail endpoint and a separate stroke endpoint?
- What are the exact field names for time, distance, pace, stroke rate/RPM,
  calories, heart rate, splits, and intervals?
- How are RowErg, SkiErg, and BikeErg results distinguished?
- Are workout types and interval contents represented in the same response?
- Are webhooks available, and if so, what do they deliver?
- Is there any public live-data stream distinct from the completed-result API?

### C. Real implementation evidence

- Which current open-source clients call the API?
- Do they confirm the endpoint and response shape?
- Is the API still current, or is there a documented v2, deprecation, or
  replacement?

## Required discipline

Every endpoint, URL, field name, and numeric value in the report must have a
source ID tied to `SOURCE_REGISTRY.json`. If the research did not find a current
verifiable source, the report must say `no current source found` instead of
turning an inference into a fact.

