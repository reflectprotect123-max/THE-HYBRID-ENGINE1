# FTMS Indoor Bike Data (`0x2AD2`) Reference

This is a compact implementation reference for the Rogue Echo Bike V3 handoff. The authoritative profile is the Bluetooth SIG Fitness Machine Service specification:

<https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/>

The local parser was cross-checked against:

- `code/direct/Rogue_Echo_Bike_v3/tracker.py`
- `code/reference/python-pyftms/src/pyftms/models/realtime_data/indoor_bike.py`
- `code/reference/cycling-app-selected/indoorBikeData.ts`

## UUIDs

| Name | Short UUID | Full UUID |
|---|---|---|
| Fitness Machine Service | `0x1826` | `00001826-0000-1000-8000-00805f9b34fb` |
| Indoor Bike Data | `0x2AD2` | `00002ad2-0000-1000-8000-00805f9b34fb` |
| Fitness Machine Control Point | `0x2AD9` | `00002ad9-0000-1000-8000-00805f9b34fb` |
| Fitness Machine Status | `0x2ADA` | `00002ada-0000-1000-8000-00805f9b34fb` |
| Heart Rate Measurement | `0x2A37` | `00002a37-0000-1000-8000-00805f9b34fb` |

## Flag mask

The first two bytes are a little-endian `uint16` flags value. Fields follow in the order below, with absent fields omitted.

| Bit | Mask | Field present when | Data type | Resolution |
|---:|---:|---|---|---:|
| 0 | `0x0001` | bit is **clear** | — | `0` means instantaneous speed follows |
| 1 | `0x0002` | set | `uint16` | average speed `0.01 km/h` |
| 2 | `0x0004` | set | `uint16` | instantaneous cadence `0.5 rpm` |
| 3 | `0x0008` | set | `uint16` | average cadence `0.5 rpm` |
| 4 | `0x0010` | set | `uint24` | total distance `1 m` |
| 5 | `0x0020` | set | `int16` | resistance level, unitless |
| 6 | `0x0040` | set | `int16` | instantaneous power `1 W` |
| 7 | `0x0080` | set | `int16` | average power `1 W` |
| 8 | `0x0100` | set | `uint16 + uint16 + uint8` | total energy, per-hour energy, per-minute energy |
| 9 | `0x0200` | set | `uint8` | heart rate `1 bpm` |
| 10 | `0x0400` | set | `uint8` | metabolic equivalent `0.1 MET` |
| 11 | `0x0800` | set | `uint16` | elapsed time `1 s` |
| 12 | `0x1000` | set | `uint16` | remaining time `1 s` |

Bits 13–15 are not parsed by the starter and should be preserved in `flags` for diagnostics.

## Ordered payload layout

```text
offset 0..1       flags, uint16 little-endian
if bit 0 = 0     instantaneous speed, uint16, 0.01 km/h
if bit 1         average speed, uint16, 0.01 km/h
if bit 2         instantaneous cadence, uint16, 0.5 rpm
if bit 3         average cadence, uint16, 0.5 rpm
if bit 4         total distance, uint24, metres
if bit 5         resistance level, int16
if bit 6         instantaneous power, int16, watts
if bit 7         average power, int16, watts
if bit 8         total energy, uint16, kcal
                 energy per hour, uint16, kcal/h
                 energy per minute, uint8, kcal/min
if bit 9         heart rate, uint8, bpm
if bit 10        metabolic equivalent, uint8, 0.1 MET
if bit 11        elapsed time, uint16, seconds
if bit 12        remaining time, uint16, seconds
```

## Sample payload

The starter test uses this synthetic payload:

```text
54 0B C4 09 A0 00 D2 04 00 2C 01 19 00 F4 01 0A 96 58 02
```

Decoded:

```json
{
  "flags": 2900,
  "speed_kmh": 25,
  "cadence_rpm": 80,
  "distance_m": 1234,
  "power_w": 300,
  "calories_total": 25,
  "calories_per_hour": 500,
  "calories_per_minute": 10,
  "heart_rate_bpm": 150,
  "elapsed_s": 600
}
```

## Implementation traps

1. **Bit 0 is inverted.** Instantaneous speed is present when `flags & 1 === 0`.
2. **The payload is conditional.** Do not use fixed offsets for cadence, power, calories, or heart rate.
3. **Distance is 3 bytes.** JavaScript needs an explicit `uint24` helper.
4. **Power is signed.** Use little-endian `int16`, not `uint16`, even if the Echo normally reports non-negative values.
5. **Energy is unsigned.** Total and per-hour energy use `uint16`; per-minute energy uses `uint8`.
6. **Values may be absent.** Represent absence as `undefined`/`null`, not a false zero.
7. **The console can retain state.** Record the raw stream and reset the console between benchmark sessions when exact interval boundaries matter.
8. **The profile does not guarantee Echo-specific field presence.** The physical V3 console must be tested and the observed field set stored with the device record.

