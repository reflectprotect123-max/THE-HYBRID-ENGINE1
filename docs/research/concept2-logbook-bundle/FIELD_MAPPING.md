# Concept2 Field Mapping

Use a raw-plus-normalized model. The raw response is the source of truth; the
normalized record is a convenience for the training app.

| Concept2 field | Normalized field | Notes |
|---|---|---|
| `id` | `external_id` | Keep as a string in the app if IDs from multiple providers share a table. |
| `user_id` | `provider_user_id` | Prefer the OAuth `me` context over a browser-supplied ID. |
| `type` | `modality` | `rower`, `skierg`, or `bike`; do not rename `bike` to `bikeerg` in the raw record. |
| `date` / `date_utc` | `started_at` | Preserve timezone/nullability; confirm conversion with real fixtures. |
| `time` | `duration_raw` | Keep the API unit in raw data; normalize only after fixture validation. |
| `distance` | `distance_raw` | Preserve raw units and machine type. |
| `time_formatted` | `duration_display` | Display-only convenience field. |
| `workout_type` | `workout_type` | Preserve exact enum/string. Unknown values must be accepted. |
| `source` | `source` | Examples include `Web`; keep the provider value. |
| `verified` | `provider_verified` | Provider status, not app validation. |
| `ranked` | `provider_ranked` | Provider status, not app performance quality. |
| `privacy` | `provider_privacy` | Do not broaden visibility during sync. |
| `workout.splits[]` | `splits[]` | Optional; missing is valid until real-account behaviour is confirmed. |
| `workout.intervals[]` | `intervals[]` | Optional; preserve `rest_time` and `rest_distance`. |
| `stroke_rate` | `rate` | Shared schema name; semantically SPM for row/ski and RPM for BikeErg. |
| stroke `spm` | `rate` | Same semantic caveat as above. |
| stroke `p` | `pace` | Unit is per 500 m for row/ski and per 1000 m for BikeErg. |
| stroke `t` | `stroke_elapsed` | Tenths of a second according to documentation. |
| stroke `d` | `stroke_distance` | Decimeters according to documentation. |
| stroke `hr` | `heart_rate_bpm` | Optional and health data; obtain required user consent. |
| `heart_rate.average/min/max/ending` | split HR summary | Accept number/string variation defensively until live fixtures settle it. |
| HTTP 404 from `/strokes` | `stroke_data_unavailable` | Valid summary-only result, not a sync failure. |

## Pace calculation

The research found no documented observed `workout.splits[].pace` field. If the
app needs split pace, calculate it from split `time` and `distance` only after
normalizing units. Do not confuse `workout.targets.pace` with achieved pace.

## Raw preservation rule

Store the provider payload, provider endpoint/version, sync timestamp, and
normalization version beside normalized fields. Concept2's public documentation
contains shape inconsistencies, including different descriptions of `workout`
and heart-rate value types; a raw payload makes future parser correction
possible.

