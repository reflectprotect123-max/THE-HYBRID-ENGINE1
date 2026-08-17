# THE HYBRID ENGINE — 120-exercise library

This package contains a curated, canonical library of exactly 120 movements for THE HYBRID ENGINE.

## Files

- `hybrid-engine-exercise-library-120.json` — canonical app-ready records with metadata.
- `hybrid-engine-exercise-library-120.csv` — flat version for spreadsheets, review, or import tooling.
- `THE-HYBRID-ENGINE-120-exercise-library.html` — standalone app copy seeded with all 120 movements.

## Coverage

| Category | Count |
|---|---:|
| Arms | 7 |
| Cardio | 7 |
| Core | 8 |
| Loaded Carry / Conditioning | 7 |
| Machine / Isolation | 8 |
| Power & Athletic | 12 |
| Prep / Mobility | 2 |
| Shoulders / Isolation | 3 |
| Strength — Hinge | 12 |
| Strength — Horizontal Pull | 11 |
| Strength — Horizontal Push | 13 |
| Strength — Squat | 10 |
| Strength — Unilateral | 8 |
| Strength — Vertical Pull | 6 |
| Strength — Vertical Push | 6 |

## Curation rules

- Canonical names are kept stable for programming and history matching.
- Common source aliases and raw-export spellings are retained as `source_aliases`.
- Cosmetic load, tempo, explanation, and duplicate spellings were not promoted to separate canonical exercises.
- The 25 additions close practical gaps in assisted pulling, rows, pressing, unilateral work, trunk training, adductors/hamstrings, power, and SkiErg conditioning.
- Coaching cues are concise programming guidance, not medical advice or a substitute for qualified instruction.

## App use

Open the standalone HTML file. It uses a separate storage key and starts with the 120-exercise seed, while preserving the existing five RE:BUILT templates. The JSON and CSV are the better handoff formats for future app development.

## Validation

The build checks exact count, unique canonical names, unique IDs, category counts, and successful embedding into the HTML seed.
