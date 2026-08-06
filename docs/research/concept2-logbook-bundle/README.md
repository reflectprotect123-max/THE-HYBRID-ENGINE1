# Concept2 Logbook API Handoff

This folder contains the current Concept2 Logbook research for the training
app. It covers completed PM5 workouts uploaded to the Logbook from Concept2
RowErg, SkiErg, and BikeErg workflows. It is separate from the Rogue Echo V3
live Bluetooth branch.

## Quick conclusion

The research supports this implementation shape:

```text
OAuth Authorization Code + Refresh Token
        ↓
Concept2 Logbook result list
        ↓
result detail hydration
        ↓
optional stroke retrieval
        ↓
raw response + normalized training record
```

Core paths recorded in the report:

```text
GET  https://log.concept2.com/oauth/authorize
POST https://log.concept2.com/oauth/access_token
GET  https://log.concept2.com/api/users/me/results
GET  https://log.concept2.com/api/users/me/results/{result_id}
GET  https://log.concept2.com/api/users/me/results/{result_id}/strokes
```

Use `user:read,results:read` for a read-only user-connected integration. The
report says the result type field distinguishes `rower`, `skierg`, and `bike`.
Do not treat this API as live PM5 telemetry.

## Files

- `RESEARCH_REPORT.md` — the full A/B/C answer, with explicit source IDs and
  `no current source found` labels.
- `RESEARCH_REQUEST.md` — standalone context for why the API contract matters.
- `API_CONTRACT.json` — machine-readable endpoints, fields, units, and gaps.
- `SOURCE_REGISTRY.json` — official documentation, implementation evidence, and
  community sources.
- `FIELD_MAPPING.md` — raw-to-normalized field guidance for the app.
- `KNOWN_GAPS.md` — unresolved claims and a real-account validation checklist.
- `PROVENANCE.md` — evidence boundaries and reuse notes.
- `code/` — original dependency-free starter modules and tests.

## Critical caution

The official examples distinguish summary results from nested workout/stroke
data. A robust sync should fetch detail, call the stroke endpoint separately,
preserve raw JSON, and accept HTTP 404 for missing stroke data. Validate nested
`workout.splits` and `workout.intervals` against a real account before making
them mandatory in the database.

