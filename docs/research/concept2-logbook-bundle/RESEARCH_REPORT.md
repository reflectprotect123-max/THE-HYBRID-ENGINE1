# Concept2 Logbook API Research Report

Prepared: 31 July 2026

This report is a source-backed implementation handoff. Source IDs such as
`C2-OFFICIAL-DOCS` refer to entries in `SOURCE_REGISTRY.json`.

## High-Level Overview

| Question | Research result |
|---|---|
| Public API | Current Concept2 Logbook API v1 is documented |
| User authentication | OAuth 2.0 Authorization Code plus Refresh Token |
| App registration | `https://log.concept2.com/developers/keys` |
| Result-read scope | `results:read`; add `user:read` for profile data |
| Result list | `GET /api/users/me/results` |
| Result detail | `GET /api/users/me/results/{result_id}` |
| Stroke detail | `GET /api/users/me/results/{result_id}/strokes` |
| Machine identity | Shared API with values including `rower`, `skierg`, and `bike` |
| Live data | No current source found for a public Logbook live stream |
| Numeric rate limit | No published numeric limit found; documentation says the API is not rate limited while warning against abuse |
| PKCE | No current source found |
| Webhooks | Result-added, result-updated, and result-deleted events are documented; exact registration/signing details remain unresolved |

The key engineering caveat is that official list examples are summary-level. The
documentation describes nested `workout.splits` and `workout.intervals`, while
an open-source client models them in a detail response. Hydrate details and
preserve raw JSON instead of assuming every response has identical nesting.

## A. Authentication

### App registration

The developer key portal is:

`https://log.concept2.com/developers/keys`

The official documentation says a developer logs in with a Concept2 Logbook
account, creates or manages an application, and registers the OAuth redirect
URI. The application receives a client ID and secret. Sources:
`C2-OFFICIAL-KEYS` and `C2-OFFICIAL-DOCS`.

For read-only development, the documentation says production can be used. It
describes a development host for write-enabled applications and says live write
access requires Concept2 validation via `ranking@concept2.com`.

No current source found confirming whether a read-only production application is
approved instantly or manually reviewed.

### Authorization endpoint

```http
GET https://log.concept2.com/oauth/authorize
```

Documented parameters:

```text
client_id
scope
response_type=code
redirect_uri
```

The documented scope delimiter is a comma. Example:

```text
https://log.concept2.com/oauth/authorize?client_id=YOUR_CLIENT_ID&scope=user%3Aread%2Cresults%3Aread&response_type=code&redirect_uri=https%3A%2F%2Fyour-app.example%2Fconcept2%2Fcallback
```

The redirect returns an authorization code. The app should generate and
validate an OAuth `state` value even though no Concept2-specific state
requirement was found. Source: `C2-OFFICIAL-DOCS`.

### Token endpoint

```http
POST https://log.concept2.com/oauth/access_token
Content-Type: application/x-www-form-urlencoded
```

Authorization-code body:

```text
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET
grant_type=authorization_code
redirect_uri=YOUR_REGISTERED_REDIRECT_URI
code=AUTHORIZATION_CODE
scope=user:read,results:read
```

Refresh body:

```text
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET
grant_type=refresh_token
refresh_token=YOUR_REFRESH_TOKEN
scope=user:read,results:read
```

The documentation shows form-encoded credentials in the body. No current source
found confirming HTTP Basic authentication as an alternative. Use the exact
registered redirect URI during code exchange.

Documented token response shape:

```json
{
  "access_token": "…",
  "token_type": "Bearer",
  "expires_in": 604800,
  "refresh_token": "…"
}
```

The example uses `604800` seconds, but code must use the returned
`expires_in`. The documentation says refresh tokens currently last one year
and that refresh returns a new refresh token. If a client is unused for more
than a year, the user must authorize again.

Concept2 documents Authorization Code, Refresh, Client Credentials, and
Password grant types. A user-connected app should use Authorization Code and
Refresh only. Source: `C2-OFFICIAL-DOCS`.

### PKCE, scopes, state, rate limits, and commercial use

No current source found documenting `code_challenge`, `code_verifier`, or
PKCE support. Do not claim PKCE support without testing the live flow.

Documented scopes:

| Scope | Meaning |
|---|---|
| `user:read` | Read profile |
| `user:write` | Read/write profile |
| `results:read` | Read results |
| `results:write` | Read/write results and includes read access |

For a read-only integration that also needs profile data:

```text
user:read,results:read
```

`results:read` is the minimum documented scope for workout data. No separate
splits scope was found. Concept2 warns that omitting `scope` currently defaults
to `user:read,results:write` for backwards compatibility and may change; send
the intended scope explicitly.

The documentation says the API is not rate limited, while warning that abuse
may result in rate limiting or removal of access. No numeric request limit was
found.

The Logbook Terms state that APIs and other Logbook Contents may not be used
commercially without Concept2's prior written consent and prohibit unreasonable
or disproportionately large loads. A commercial app should obtain written
confirmation before launch.

Sources: `C2-OFFICIAL-DOCS`, `C2-OFFICIAL-TERMS`.

## B. Results and splits data

### List endpoint and headers

```http
GET https://log.concept2.com/api/users/me/results
Authorization: Bearer ACCESS_TOKEN
Accept: application/vnd.c2logbook.v1+json
```

The API can also address a numeric user ID, but `me` is the safer user-token
form. The documented API version is v1. Source: `C2-OFFICIAL-DOCS`.

### Filters and pagination

Documented query parameters include:

```text
from=YYYY-MM-DD
to=YYYY-MM-DD
type=rower|skierg|bike|...
updated_after=YYYY-MM-DD HH:MM:SS
page=1
number=250
```

Documented machine/type values:

```text
rower
skierg
bike
dynamic
slides
paddle
water
snow
rollerski
multierg
```

The API uses `bike`, not `bikeerg`. `updated_after` is interpreted in GMT.
The documented default page size is 50 and the maximum is 250. Follow
`meta.pagination` rather than assuming one page.

### Official summary example

The official list example is summary-level:

```json
{
  "data": [
    {
      "id": 3,
      "user_id": 1,
      "date": "2013-06-21 00:00:00",
      "timezone": null,
      "date_utc": null,
      "distance": 23000,
      "type": "rower",
      "time": 152350,
      "time_formatted": "4:13:55.0",
      "workout_type": "unknown",
      "source": "Web",
      "weight_class": "H",
      "verified": false,
      "ranked": false,
      "comments": null,
      "privacy": "partners"
    }
  ],
  "meta": {
    "pagination": {
      "total": 9,
      "count": 9,
      "per_page": 50,
      "current_page": 1,
      "total_pages": 1,
      "links": []
    }
  }
}
```

This official example does not include `workout`, `splits`, or `strokes`.
Source: `C2-OFFICIAL-DOCS`.

### Detail and embedded resources

```http
GET https://log.concept2.com/api/users/me/results/{result_id}
```

The documentation describes embedded-resource requests such as:

```text
?include=strokes,metadata,user
```

The published GET example remains summary-shaped, and no explicit
`include=workout` parameter was found. Treat `include` as a request hint, not
proof that nested workout data is always returned.

### Workout, splits, intervals, and workout types

The documented workout-shaped example contains:

```json
{
  "type": "rower",
  "date": "2017-05-15 16:40:00",
  "workout_type": "JustRow",
  "time": 4861,
  "distance": 1217,
  "stroke_rate": 30,
  "stroke_count": 250,
  "calories_total": 60,
  "workout": {
    "splits": [
      {
        "distance": 741,
        "time": 3000,
        "stroke_rate": 32,
        "calories_total": 37,
        "heart_rate": {
          "ending": 140
        }
      }
    ]
  }
}
```

The nested workout shape may contain `splits`, `intervals`, and `targets`.
Split/interval fields include:

```text
distance
time
stroke_rate
calories_total
wattminutes_total
heart_rate
type
rest_time
rest_distance
machine
```

Documented interval `type` values include `time`, `distance`, `calorie`,
and `wattminute`. For MultiErg intervals, `machine` can identify `rower`,
`skierg`, or `bike`.

Documented `workout_type` values include:

```text
unknown
JustRow
FixedDistanceSplits
FixedTimeSplits
FixedCalorie
FixedWattMinute
FixedTimeInterval
FixedDistanceInterval
FixedCalorieInterval
FixedWattMinuteInterval
VariableInterval
VariableIntervalUndefinedRest
```

The research records that interval top-level `time` and `distance` represent
work, with rest represented by `rest_time` and `rest_distance`. Validate this
with real fixtures before treating it as a hard invariant.

Source: `C2-OFFICIAL-DOCS`.

### Strokes, pace, cadence, and heart rate

Stroke endpoint:

```http
GET https://log.concept2.com/api/users/me/results/{result_id}/strokes
```

Documented stroke fields:

| Field | Meaning |
|---|---|
| `t` | Time, tenths of a second |
| `d` | Distance, decimeters |
| `p` | Pace, tenths of a second |
| `spm` | Current strokes/revolutions per minute |
| `hr` | Current heart rate |

Documented pace units are per 500 m for RowErg/SkiErg and per 1000 m for
BikeErg. Stroke time and distance restart at zero for each interval.

Stroke response example:

```json
{
  "data": [
    {
      "t": 0,
      "d": 0,
      "p": 0,
      "spm": 0,
      "hr": 0
    }
  ]
}
```

The documented missing-data behaviour is HTTP 404 with a message that the
workout has no associated stroke data. Treat this as a valid summary-only
result, not a failed sync.

No documented observed `split.pace` field was found. Calculate split pace from
`time` and `distance` if needed. `workout.targets.pace` is a target, not
necessarily achieved pace. Per-stroke `p` is the direct documented pace value.

Source: `C2-OFFICIAL-DOCS`.

### Machine identity

There is one shared result API rather than separate endpoints for RowErg,
SkiErg, and BikeErg. The result's `type` identifies the machine:

```text
rower
skierg
bike
```

MultiErg interval objects may additionally contain `machine`. The schema is
shared, but semantics differ: BikeErg pace uses per-1000-metre units, and
`stroke_rate`/`spm` represents revolutions per minute even when the field
name comes from the shared schema.

Sources: `C2-OFFICIAL-DOCS`, `C2-PM5`.

### Webhooks

The research found documented result events:

```text
result-added
result-updated
result-deleted
```

The event applies to results belonging to users who authorized the client and
is delivered as a POST to a registered endpoint. Published shapes are
summary-level. Safest design: use an event as a sync trigger, then fetch the
result and strokes by ID. Keep `updated_after` polling as recovery.

No current source found for the exact webhook registration API path, webhook
signatures, signing secrets, retry policy, delivery timeout, receiver
authentication requirements, or a guarantee that splits/strokes are embedded
in webhook payloads.

Source: `C2-OFFICIAL-DOCS`.

## C. Real-world implementation evidence

### pyconcept2

`gickowtf/pyconcept2` is a current Python client that models profile reads,
paginated results, result detail, stroke data, CSV/FIT/TCX exports, and derived
time splits. The research records these client paths:

- `/users/me/results`
- `/users/me/results/{id}`
- `/users/me/results/{id}/strokes`
- `/users/me/results/{id}/export/{type}`

It is marked pre-alpha and read-only and does not provide OAuth helpers. Use it
as API-shape and parsing evidence, not as a complete authentication layer.

Sources: `C2-PYCONCEPT2`, `C2-PYCONCEPT2-CLIENT`,
`C2-PYCONCEPT2-MODELS`, and `C2-PYCONCEPT2-TEST`.

### Concept2 MCP server

`aaronarnold2/concept2-mcp-server` exposes result listing, detail, strokes,
exports, and OAuth-related tools. It is low maturity and its README formats
scopes differently from the official comma-delimited documentation. Treat it
as corroborating evidence and follow the official scope format.

Source: `C2-MCP`.

### Intervals.icu

An October 2025 integration discussion reported a working Concept2
authorization flow and requested testers. A November 2025 report described a
successful connection while noting truncated or incomplete workouts. This is
evidence of active real-world use and a warning that incomplete data exists.

Source: `C2-INTERVALS`.

### Browser Erg Analyzer

A published integration discussion reports direct Concept2 Logbook
authentication and workout import. It notes that workouts without stroke data
may be skipped for detailed analysis, reinforcing that stroke availability is
not universal.

Source: `C2-ERG-ANALYZER`.

### OpenRowing Dart wrapper

`OpenRowingCommunity/c2logbook` models OAuth and development/production
domains, but its README still marks result retrieval, stroke data, exports,
pagination, and webhooks as pending. It corroborates the developer-portal and
callback model but is not a complete results client.

Source: `C2-OPENROWING`.

### Current/deprecation status

The official documentation identifies API v1 and remains live in the research
pass. Current 2025–2026 projects continue to use the same OAuth endpoints and
`/api/users/me/results` path.

No current source found for a formal API v2, deprecation notice, migration
guide, replacement API, or recent official API changelog.

## Counterpoints and challenges

1. The Logbook API is not the PM5 live-data API. Concept2 documents PM5
   Bluetooth/ANT+ communication and ErgData real-time workout use separately.
   ErgData synchronizes completed workouts to the Logbook.
2. No current source found for a public Logbook OAuth endpoint that streams
   live pace, watts, cadence, or heart rate during an active workout. Live
   features need a separate direct PM5 integration.
3. Not every Logbook result has stroke-level data. Manual or older summaries
   may contain totals only.
4. Concept2's privacy policy treats heart-rate data as health data; obtain the
   consent required for the app's processing context.
5. A 2024 independent report described a historical profile-access bug that was
   reportedly fixed. It is not evidence of a current vulnerability, but it
   reinforces using `me`, respecting scopes, and not trusting browser-supplied
   user IDs.

Sources: `C2-SOFTWARE`, `C2-ERGDATA`, `C2-PRIVACY`,
`C2-SECURITY-REPORT`.

## Actionable implementation plan

1. Start authorization with explicit `user:read,results:read`,
   `response_type=code`, a registered redirect URI, and an application
   generated `state` value.
2. Exchange the code server-side at `/oauth/access_token`; store the access
   token, refresh token, and returned `expires_in` securely.
3. Refresh server-side when needed. Persist a rotated refresh token.
4. Sync with `/api/users/me/results`, `updated_after`, `number=250`, and
   pagination metadata.
5. Hydrate each result by ID, then call `/strokes` separately. Treat stroke
   HTTP 404 as `stroke_data_unavailable`.
6. Persist raw JSON beside normalized fields: `result_id`, `type`,
   `workout_type`, `date`, `time`, `distance`, `workout`, `strokes`,
   `metadata`, `source`, `verified`, and privacy information where supplied.
7. Use webhooks only after verifying registration, authenticity, and retry
   semantics. Fetch by result ID after an event and retain polling as recovery.
8. Validate real RowErg, SkiErg, and BikeErg fixtures, including Just Row,
   fixed splits, fixed time, distance intervals, variable intervals,
   heart-rate and non-heart-rate sessions, and summary-only results.

## Final verdict

The implementation-ready direction is **OAuth Authorization Code plus Refresh,
`results:read`, `GET /api/users/me/results`, result-detail hydration,
separate stroke retrieval, optional webhook triggering, and no assumption of
Logbook live streaming**. Keep raw responses and the adapter tolerant because
the official documentation and public implementations do not establish one
perfectly uniform response shape for every workout.

