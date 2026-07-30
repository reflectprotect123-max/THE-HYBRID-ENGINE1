# Rogue Echo Bike V3.0 Connectivity Handoff

Prepared: 31 July 2026  
Target: **Rogue Echo Bike V3.0 standard connected console**  
Purpose: implementation and research handoff for the training app and Claude.

## Executive verdict

The standard Echo Bike V3.0 console is a real Bluetooth Low Energy fitness-machine data source. Rogue documents FTMS, and independent applications demonstrate live reads from the FTMS Indoor Bike Data characteristic. The primary integration path is:

```text
Echo Bike V3 console
        │ BLE / FTMS
        ▼
Fitness Machine Service 0x1826
        │ notifications
        ▼
Indoor Bike Data 0x2AD2
        │
        ├─ speed
        ├─ cadence / RPM
        ├─ distance
        ├─ instantaneous and average power
        ├─ energy / calories fields
        ├─ heart rate when present
        └─ elapsed / remaining time when present
```

Use **Bluetooth FTMS** for the app. Treat ANT+ as an available console radio, but do not implement ANT+ bike-metric ingestion until a separate packet-level validation proves which bike metrics the V3 broadcasts over ANT+.

## Contents

- `evidence/echo_v3_connectivity_research.md` — source-audited findings, device-generation distinction, integration behaviour, caveats, and implementation decisions.
- `evidence/source_registry.json` — every source used, its role, URL, local copy where applicable, and confidence/licence notes.
- `evidence/repo_manifest.json` — exact cloned repository commits and sanitisation decisions.
- `evidence/ftms_indoor_bike_data_reference.md` — field order, flag meanings, units, and implementation traps.
- `evidence/echo_v3_capability_registry.json` — app-ready device capability record.
- `evidence/echo_v3_data_contract.json` — recommended event/session schema.
- `evidence/known_gaps.md` — what was not proven and what must be tested with the physical console.
- `code/starter/typescript/` — original starter adapter for a browser/Web Bluetooth implementation, with a parser test.
- `code/starter/python/` — original Bleak-based diagnostic client and parser test fixture.
- `code/direct/` — complete source snapshots of direct Echo/FTMS implementations, with public repository provenance.
- `code/reference/` — generic FTMS implementations useful for comparison.
- `sources/official/rogue/` — locally saved Rogue product/guidance pages and the official V3 assembly/customer-instructions PDF.
- `research/previous_conditioning_handoff/` — the earlier five-modality evidence/model/tree handoff, including its original ZIP.
- `provenance/` — retrieval notes and checksums.

## Important scope boundary

This archive is intentionally **Echo V3-specific** for connectivity. The earlier five-modality research is included as supporting conditioning context, but AssaultBike Classic/Elite and Schwinn Airdyne integration layers are not part of the app target.

The standard V3 console is not the same device as the newer M2 Monitor Upgrade Kit. The M2 adds direct Rogue App connectivity and onboard workout-memory features. Do not silently merge M2 behaviour into the V3 capability record.

## Legal and reuse note

The cloned repositories remain attributed to their original authors and retain their repository documentation where available. The manifest records whether an explicit licence file was present. Two direct repositories state MIT licensing in their README but did not contain a licence file in the retrieved commit; treat those snapshots as **reference material until the author’s licence is confirmed**, not as automatically reusable code. The original starter code in `code/starter/` is new work produced for this handoff.

The Bluetooth SIG specification is linked, not redistributed. The bundle contains a compact implementation reference derived from the public profile identifiers and the open-source implementations listed in the registry.

## Validation status

The parser tests in `code/starter/` run without a physical Echo Bike. They validate byte ordering, flags, field alignment, scaling, malformed payload handling, and a complete sample payload. A real-device test is still required for console discovery, notification frequency, field presence, reset/carry-over behaviour, disconnect/reconnect, and firmware-specific quirks.

## Primary sources

- Rogue V3 FTMS guide: <https://guides.roguefitness.com/Guide/Firmware+update+for+V3+Console+(Android)/24>
- Rogue Echo Bike V3.0 product page: <https://www.roguefitness.com/rogue-echo-bike>
- Rogue V3 console product page: <https://www.roguefitness.com/echo-bike-connected-console-eu>
- Bluetooth SIG Fitness Machine Service: <https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/>
- ErgZone V3 connection notes: <https://help.erg.zone/article/351-echo-bike-how-to-connect>
- Direct Echo V3 tracker: <https://github.com/richiebolger/Rogue_Echo_Bike_v3>
- Rogue Garmin bridge: <https://github.com/Douglas-Christian/rogue_garmin_bridge>
- Track My Indoor Workout: <https://github.com/TrackMyIndoorWorkout/TrackMyIndoorWorkout>
- PyFTMS: <https://github.com/dudanov/python-pyftms>

