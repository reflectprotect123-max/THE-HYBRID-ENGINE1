# TypeScript starter adapter

`echo-v3-ftms.ts` is original code for a read-only Web Bluetooth/FTMS adapter. It is intentionally small and platform-neutral so it can be adapted to the app’s existing BLE layer.

## What it does

- requests an FTMS device from inside the browser/app;
- connects to service `0x1826`;
- subscribes to `0x2AD2` notifications;
- parses conditional Indoor Bike Data fields;
- retains raw notification bytes in the normalised event;
- cleans up notification and disconnect handlers.

## What it does not do

- pair through the operating system’s normal Bluetooth settings;
- write to the FTMS Control Point;
- assume that every optional field is present;
- treat console watts as laboratory-grade power;
- implement ANT+.

The parser test is written for a TypeScript runner such as `tsx`, `ts-node`, or a project Jest/Vitest setup. It is not coupled to a particular app build system.

