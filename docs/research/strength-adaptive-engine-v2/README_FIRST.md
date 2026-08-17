# THE Hybrid Engine — Project Handoff

**Handoff date:** 16 August 2026  
**Purpose:** Final research, design, exercise-library, and prototype handoff.

## Start here

1. Read `01_FINAL_DOSSIER/THE_Hybrid_Engine_Final_Evidence_Dossier.pdf` for the full close-out.
2. Use `01_FINAL_DOSSIER/hybrid-engine-final-evidence-dossier.md` for searchable text.
3. Use `01_FINAL_DOSSIER/build_final_dossier.py` only if the dossier needs to be regenerated.
4. Use the JSON exercise library in `03_EXERCISE_LIBRARY` as the preferred development handoff format.

## Locked implementation decisions

- Default progression target: **2.5%** of the last stable opening load, with equipment-aware rounding.
- If the available equipment jump is too large, use repetition/RPE/execution progression instead of forcing the jump.
- Default reactive reduction: **5%** from the last successful anchor after repeated comparable deterioration.
- A single poor session, low HRV, poor sleep, or feeling flat does not independently force escalation.
- Pain is a separate safety pathway from ordinary fatigue.
- Training gaps enter calibration; missing data lowers certainty.
- The engine must remain transparent, deterministic, auditable, and uncertainty-aware. It does not claim one universal training formula.

## Folder map

| Folder | Contents |
|---|---|
| `01_FINAL_DOSSIER` | Final 120,766-word dossier in Word, PDF, Markdown, plus the generator source. |
| `02_EVIDENCE_AND_DESIGN` | Evidence bundle, design notes, audits, file tree, coach-brain specification, and JARVIS handoff audit. |
| `03_EXERCISE_LIBRARY` | 120-exercise JSON/CSV data, README, HTML browser, and search interface. |
| `04_APP_PROTOTYPES` | Polished sendable prototype and pro dashboard prototype. |

## Important handoff note

This ZIP contains the project artifacts recovered and available for the final handoff. It does not contain a full Git repository checkout or deployment secrets. Environment variables, credentials, and private service configuration must be supplied separately through the relevant deployment system.

