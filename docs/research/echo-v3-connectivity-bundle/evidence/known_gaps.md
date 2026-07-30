# Known Gaps and Required Physical-Device Tests

This audit is strong enough for architecture and a first read-only adapter, but it is not a substitute for capturing a real V3 console.

## Not proven by the available sources

- The exact Echo V3 GATT database as returned by every firmware revision.
- The exact V3 firmware version used by each public client.
- The exact notification frequency on every phone, OS, and firmware combination.
- Whether every V3 session emits every optional Indoor Bike Data field.
- Whether the standard V3 exposes the Control Point but rejects, ignores, or accepts particular procedures.
- Whether the standard V3 broadcasts its own watts, RPM, calories, or distance over ANT+.
- Whether a standard V3 console has native long-term workout-history export independent of the app that is connected.
- A complete, official field-by-field Rogue packet capture.
- Cross-device calibration between Echo V3 console watts/calories and laboratory measurements.

## Physical test plan

Record a diagnostic log containing:

1. Console identity and visible firmware/version information.
2. Discovered services, characteristics, properties, and descriptors.
3. The first 30 notifications at rest and during pedalling.
4. A steady effort with speed, cadence, watts, distance, calories, and HR visible on the console.
5. A stop/start transition.
6. A 20/10 or custom interval session.
7. Console reset followed by a new session.
8. Connection loss and reconnect.
9. HR paired and unpaired conditions.
10. A second client attempt after the app disconnects.

## How to record it

Store:

```text
timestamp_utc
phone/tablet model
operating system and app build
console firmware/version
BLE device name and identifier
service/characteristic UUIDs
characteristic properties
raw notification hex
parsed fields
notification interval
connection/disconnection events
user action that caused each event
```

Do not upload private device identifiers or HR data into a public issue. Redact the BLE address and personal identifiers before sharing captures.

## Acceptance criteria for production

The adapter should not be called production-ready until it can:

- connect from inside the app without OS-level pairing;
- discover the FTMS service;
- subscribe to `0x2AD2`;
- parse both minimal and full payloads correctly;
- preserve raw bytes;
- tolerate absent optional fields;
- detect malformed/truncated payloads without corrupting the session;
- reconnect after a dropped link;
- stop cleanly and avoid duplicate notification handlers;
- keep console-derived calories/watts labelled as device metrics;
- keep the training engine from applying conventional cycling FTP zones automatically.

