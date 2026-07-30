# Echo Bike V3.0 Connectivity Research

Version: 1.0  
Date: 31 July 2026  
Target: Rogue Echo Bike V3.0 standard connected console  
Population/product context: a local-first training app that needs live workout telemetry.

## High-Level Overview

The practical answer is **yes**: the standard Rogue Echo Bike V3.0 console is usable as a live data source over Bluetooth Low Energy. The implementation path is the Bluetooth Fitness Machine Service (FTMS), specifically the Indoor Bike Data characteristic.

### Short verdict

| Capability | Verdict | Evidence level |
|---|---|---|
| Built-in Bluetooth LE | Yes | Rogue product and console pages; independent apps |
| Built-in ANT+ | Yes | Rogue product and console pages |
| Bike metrics outward over BLE | Yes, through FTMS | Rogue says FTMS two-way communication; multiple working clients read `0x2AD2` |
| Live power / watts | Supported by direct client implementations | Independent code; verify field presence on the physical console |
| Live cadence / RPM | Supported by direct client implementations | Independent code and FTMS parser |
| Live speed | Supported by direct client implementations | Independent code and FTMS parser |
| Live distance | Supported by direct client implementations | Independent code and FTMS parser |
| Live energy/calorie fields | Supported by FTMS clients; exact field presence is firmware/session-dependent | Independent code; verify on device |
| Heart rate | The console can receive HR; HR may be present in the FTMS stream when configured | Rogue console page and client implementations |
| ANT+ bike-metric export | **No direct packet-level source found** | Keep out of the first implementation |
| Direct Rogue App support on standard V3 | Do not assume it | Rogue distinguishes standard V3 from M2; M2 is explicitly advertised for direct Rogue App connectivity |
| Read-only telemetry integration | Strong first release target | Lowest-risk product decision |
| Sending targets/control commands | Protocol capability exists, but Echo-specific acceptance is not proven | Treat as experimental and disabled by default |

The strongest architecture is therefore:

```text
discover FTMS device
  → connect inside the app
  → subscribe to Indoor Bike Data notifications
  → parse flags and ordered fields
  → normalise to an Echo-specific event
  → store raw bytes plus parsed values
  → derive session summaries and progression inputs
```

## Deep Dive Analysis

### 1. What Rogue officially documents

Rogue’s V3 console firmware guide states that the Echo Bike Connected console uses the industry-standard FTMS protocol for communication with apps and warns that the connection must be initiated inside the app, not through the phone’s ordinary Bluetooth settings:

- Android guide: <https://guides.roguefitness.com/Guide/Firmware+update+for+V3+Console+(Android)/24>
- iOS guide: <https://guides.roguefitness.com/Guide/Firmware+update+for+V3+Console+(iOS)/29>

Rogue’s current Echo Bike product page says the standard V3.0 console has Bluetooth and ANT+ compatibility and connects to popular cycling apps. It also describes the optional M2 monitor as the part that adds direct Rogue App connectivity, automatic workout logging, expanded performance data, and OTA updates:

- Product page: <https://www.roguefitness.com/rogue-echo-bike>
- Locally saved copy: `sources/official/rogue/echo_bike_v3_product_page.html`

Rogue’s V3 console product page is more explicit: it says the connected console can receive heart-rate input over ANT+ or BLE and uses FTMS for two-way communication between apps and the console/bike:

- Console page: <https://www.roguefitness.com/echo-bike-connected-console-eu>
- Locally saved copy: `sources/official/rogue/echo_bike_v3_console_product_page.html`

This gives us an important distinction:

```text
Bluetooth/ANT+ radio present       = confirmed
HR reception by the console        = confirmed
FTMS app ↔ console/bike             = confirmed
ANT+ bike-metric broadcast          = not directly confirmed
```

### 2. What independent working clients demonstrate

#### Direct Echo V3 tracker

`richiebolger/Rogue_Echo_Bike_v3` is a native macOS tracker that connects directly to the Echo V3 using Bleak. Its README lists live power, cadence, speed, heart rate, calories, distance, and elapsed time. Its `tracker.py` defines:

```text
FTMS service:          00001826-0000-1000-8000-00805f9b34fb
Indoor Bike Data:      00002ad2-0000-1000-8000-00805f9b34fb
FTMS status:           00002ada-0000-1000-8000-00805f9b34fb
FTMS control point:    00002ad9-0000-1000-8000-00805f9b34fb
Heart Rate:            00002a37-0000-1000-8000-00805f9b34fb
```

Repository: <https://github.com/richiebolger/Rogue_Echo_Bike_v3>  
Retrieved commit: `e4a30cafb33bbefb22beb50beefb3f4283b63d4a`  
Local snapshot: `code/direct/Rogue_Echo_Bike_v3/`

The repository states MIT in its README, but the retrieved commit did not contain a `LICENSE` file and includes an all-rights-reserved copyright string in its build metadata. The snapshot is retained for attribution and technical comparison; confirm permission before copying its application code into a distributed product.

#### Rogue Garmin Bridge

`Douglas-Christian/rogue_garmin_bridge` connects Rogue Echo equipment through FTMS using `pyftms`, displays live metrics, records workouts, and converts sessions into FIT files. It includes a device simulator and broad tests, making it useful for studying data flow, reconnect behaviour, and session persistence.

Repository: <https://github.com/Douglas-Christian/rogue_garmin_bridge>  
Retrieved commit: `b3efe73a1a304bb3ea67125ca879ce4053890b3f`  
Local snapshot: `code/direct/rogue_garmin_bridge/`

The README claims MIT licensing, but no `LICENSE` file was present in the retrieved commit. Runtime artefacts such as databases, logs, FIT files, `.env` files, coverage data, and user-profile data were excluded from this bundle.

#### Track My Indoor Workout

`TrackMyIndoorWorkout` is an Apache-2.0 Flutter application that lists Rogue Echo Bike V3.0 as a supported machine. It is a useful cross-platform reference for FTMS discovery, device abstraction, metric descriptors, export, and long-running workout tracking.

Repository: <https://github.com/TrackMyIndoorWorkout/TrackMyIndoorWorkout>  
Retrieved commit: `9dc159c7f6674c2a10eef173d47a94fc2df3a3c4`  
Local snapshot: `code/direct/TrackMyIndoorWorkout/`

#### PyFTMS

`dudanov/python-pyftms` is an Apache-2.0 Python FTMS client library. Its indoor-bike model independently confirms the main field formats used in the starter parser: unsigned speed/cadence/distance/energy/time fields and signed resistance/power fields.

Repository: <https://github.com/dudanov/python-pyftms>  
Retrieved commit: `2d60298fb8869f833c8a9c7f16f246b93d2f50a0`  
Local snapshot: `code/reference/python-pyftms/`

#### Browser/Capacitor FTMS parser

`mishannn/cycling-app` contains a small TypeScript BLE lifecycle and Indoor Bike Data decoder. It demonstrates the mobile shape of a service/characteristic subscription. The bundle includes the selected parser/lifecycle files as reference material under `code/reference/cycling-app-selected/`; the retrieved repository had no root licence file, so do not treat the files as automatically reusable.

Repository: <https://github.com/mishannn/cycling-app>  
Retrieved commit: `b9a3f812f889e1062a20ff237a32a502b7646cd7`

### 3. FTMS data path for the app

#### Service and characteristics

| UUID | Name | Expected direction | App use |
|---|---|---|---|
| `0x1826` | Fitness Machine Service | Bike/server exposes service | Discover and connect |
| `0x2AD2` | Indoor Bike Data | Bike → app, notifications | Primary live telemetry |
| `0x2AD9` | Fitness Machine Control Point | App → bike, writes/indications | Experimental; do not require for read-only tracking |
| `0x2ADA` | Fitness Machine Status | Bike → app, notifications | Optional status events |
| `0x2A37` | Heart Rate Measurement | HR sensor → client or console stream | Optional fallback/secondary HR path |

The official profile reference is the Bluetooth SIG Fitness Machine Service page:

<https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/>

The repository `code/starter/` contains a compact field reference and parser. Raw bytes should be retained beside the parsed event so any firmware-specific discrepancy can be diagnosed later.

#### Expected live event fields

The app should expose nullable values rather than filling absent fields with zero:

```json
{
  "received_at": "2026-07-31T00:00:00.000Z",
  "device": {
    "manufacturer": "Rogue",
    "model": "Echo Bike",
    "generation": "V3.0",
    "console_generation": "V3",
    "protocol": "ble_ftms",
    "service_uuid": "00001826-0000-1000-8000-00805f9b34fb",
    "characteristic_uuid": "00002ad2-0000-1000-8000-00805f9b34fb"
  },
  "metrics": {
    "speed_kmh": null,
    "cadence_rpm": null,
    "distance_m": null,
    "power_w": null,
    "average_power_w": null,
    "calories_total": null,
    "calories_per_hour": null,
    "calories_per_minute": null,
    "heart_rate_bpm": null,
    "elapsed_s": null,
    "remaining_s": null
  },
  "raw": {
    "hex": "",
    "flags": null
  }
}
```

### 4. Connection lifecycle

Rogue’s guidance and the independent ErgZone instructions support this operational sequence:

1. Turn on the console.
2. Hold the V3 Bluetooth/connect control until the Bluetooth indicator is active.
3. Request/connect to the device from inside the training app.
4. Discover the FTMS service and subscribe to `0x2AD2` notifications.
5. Start pedalling if the console is waiting for activity.
6. Record raw notifications and parsed values at the notification cadence.
7. Reset/close the session explicitly and disconnect cleanly.

ErgZone reports that the V3 sends Bluetooth signals approximately once per second, may show small distance discrepancies at interval boundaries, and can retain/carry data unless the console is reset before a new session. Those are product-integration observations, not universal FTMS guarantees:

<https://help.erg.zone/article/351-echo-bike-how-to-connect>

### 5. Read-only first; control later

The FTMS profile contains a Control Point and the direct Echo tracker includes code that attempts target writes. That does not prove the standard Echo V3 firmware accepts every control procedure. The first production slice should be:

```text
connect → subscribe → parse → record → disconnect
```

Do not make the session depend on:

- setting target power;
- setting target cadence;
- setting target heart rate;
- starting/resuming the machine through the FTMS Control Point;
- ANT+ bike-metric ingestion.

If control is added later, gate it by discovered feature bits, log the request/result pair, and provide a manual fallback.

### 6. Field-format cross-reference

The strongest cross-check is the agreement between the direct Echo tracker and PyFTMS:

| Field | FTMS representation used by the starter | Resolution | Notes |
|---|---|---:|---|
| Flags | `uint16` little-endian | bit mask | Bit 0 changes whether speed is present |
| Instantaneous speed | `uint16` | `0.01 km/h` | Present when bit 0 is clear |
| Average speed | `uint16` | `0.01 km/h` | Bit 1 |
| Instantaneous cadence | `uint16` | `0.5 rpm` | Bit 2 |
| Average cadence | `uint16` | `0.5 rpm` | Bit 3 |
| Total distance | `uint24` | `1 m` | Bit 4 |
| Resistance level | `int16` | `1` | Bit 5; may be absent on the Echo |
| Instantaneous power | `int16` | `1 W` | Bit 6 |
| Average power | `int16` | `1 W` | Bit 7 |
| Total energy | `uint16` | `1 kcal` | Bit 8; followed by per-hour and per-minute values |
| Energy per hour | `uint16` | `1 kcal/h` | Bit 8 |
| Energy per minute | `uint8` | `1 kcal/min` | Bit 8 |
| Heart rate | `uint8` | `1 bpm` | Bit 9 |
| Metabolic equivalent | `uint8` | `0.1 MET` | Bit 10 |
| Elapsed time | `uint16` | `1 s` | Bit 11 |
| Remaining time | `uint16` | `1 s` | Bit 12 |

Some public parsers use unsigned types for power or signed types for energy. The cross-check against PyFTMS and the direct Python Echo tracker supports using signed `int16` power and unsigned energy. The parser in this bundle deliberately uses the cross-checked representation and keeps raw bytes for later device validation.

### 7. Data quality and training-engine implications

The earlier conditioning evidence handoff remains binding for the training engine:

- Echo V3 console watts are a device/console-derived metric, not automatically a laboratory power-meter value.
- Calories, watts, RPM, speed, and distance should be compared longitudinally on the same device and protocol.
- Do not import conventional cycling FTP zones into the combined arm-and-leg air-bike modality automatically.
- Store device model, console generation, firmware if available, metric source, protocol, warm-up, familiarisation count, and raw output trace with benchmarks.
- Use completed work, RPE, technique/local-fatigue status, and recovery as completion signals for short intervals; heart rate is supporting data because it lags short work bouts.

Supporting files:

- `research/previous_conditioning_handoff/conditioning_evidence_handoff.md`
- `research/previous_conditioning_handoff/conditioning_source_model_manifest.json`
- `research/previous_conditioning_handoff/modality_progression_regression_trees.json`

## Counterpoints / Challenges

### “Bluetooth means the app can read everything”

Not necessarily. Bluetooth may be used for HR reception, app connectivity, or metric broadcast. For the V3, FTMS bike-data transmission is supported by Rogue’s FTMS statement and independent clients, but the app must still handle missing fields and firmware differences.

### “ANT+ will be a second equivalent integration”

No source in this audit proves that the standard V3 broadcasts its own watts/RPM/calories/distance over ANT+. Keep ANT+ as a future investigation, not a current feature claim.

### “The Rogue App is the official path for V3”

That is a weak assumption. Current Rogue material presents direct Rogue App connectivity as an M2 feature, while the standard V3 is described in terms of Bluetooth/ANT+ and third-party cycling apps. Preserve the V3/M2 distinction in the capability registry.

### “The public parser is automatically correct”

No. The public code is valuable evidence, but there are implementation differences. For example, a browser parser in the reference repository treats power as unsigned; the direct Echo tracker and PyFTMS use signed power. The bundle’s parser uses the cross-checked form and includes tests, but a real-device capture is still required.

### “The FTMS Control Point should be enabled immediately”

No. The service may expose a control point while the specific console firmware supports only a subset of procedures. Make telemetry read-only first.

## Actionable Next Steps

1. Add an Echo V3 device profile using `evidence/echo_v3_capability_registry.json`.
2. Implement the starter parser or adapt the platform BLE layer to emit the same normalised event shape.
3. Connect inside the app, never through the operating system’s ordinary Bluetooth-pairing screen.
4. Store raw notification bytes, flags, parsed fields, timestamp, device identifier, console generation, and firmware when discoverable.
5. Build a physical-device diagnostic screen that shows discovered services, characteristic properties, notification rate, and fields present.
6. Capture at least one real session containing steady work, intervals, stop/start, console reset, reconnect, and HR paired/unpaired conditions.
7. Compare the physical capture with the test fixture in `code/starter/` and the direct clients in `code/direct/`.
8. Keep the first release read-only. Treat control-point writes and ANT+ metric ingestion as research features.
9. Feed the resulting events into the existing air-bike progression tree without converting watts to cycling FTP automatically.

