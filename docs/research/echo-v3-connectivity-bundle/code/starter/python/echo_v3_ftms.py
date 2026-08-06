"""Original read-only Rogue Echo Bike V3 FTMS diagnostic client.

The parser has no Bluetooth dependency and can be tested on any machine. The
optional live client imports Bleak only when run as a program.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import struct
from typing import Any

FTMS_SERVICE_UUID = "00001826-0000-1000-8000-00805f9b34fb"
INDOOR_BIKE_DATA_UUID = "00002ad2-0000-1000-8000-00805f9b34fb"
FTMS_STATUS_UUID = "00002ada-0000-1000-8000-00805f9b34fb"
FTMS_CONTROL_POINT_UUID = "00002ad9-0000-1000-8000-00805f9b34fb"


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    def take(self, size: int, field: str) -> bytes:
        end = self.offset + size
        if end > len(self.data):
            raise ValueError(f"Truncated FTMS Indoor Bike Data before {field}")
        value = self.data[self.offset:end]
        self.offset = end
        return value

    def u8(self, field: str) -> int:
        return self.take(1, field)[0]

    def u16(self, field: str) -> int:
        return struct.unpack("<H", self.take(2, field))[0]

    def i16(self, field: str) -> int:
        return struct.unpack("<h", self.take(2, field))[0]

    def u24(self, field: str) -> int:
        raw = self.take(3, field)
        return raw[0] | (raw[1] << 8) | (raw[2] << 16)


def parse_indoor_bike_data(data: bytes) -> dict[str, Any]:
    """Decode one FTMS Indoor Bike Data notification.

    Optional fields are emitted only when their flag is present. Bit 0 is
    inverted: instantaneous speed is present when the bit is clear.
    """

    reader = Reader(bytes(data))
    flags = reader.u16("flags")
    result: dict[str, Any] = {"flags": flags}

    if not (flags & 0x0001):
        result["speed_kmh"] = round(reader.u16("instantaneous speed") * 0.01, 2)
    if flags & 0x0002:
        result["average_speed_kmh"] = round(reader.u16("average speed") * 0.01, 2)
    if flags & 0x0004:
        result["cadence_rpm"] = round(reader.u16("instantaneous cadence") * 0.5, 1)
    if flags & 0x0008:
        result["average_cadence_rpm"] = round(reader.u16("average cadence") * 0.5, 1)
    if flags & 0x0010:
        result["distance_m"] = reader.u24("total distance")
    if flags & 0x0020:
        result["resistance_level"] = reader.i16("resistance level")
    if flags & 0x0040:
        result["power_w"] = reader.i16("instantaneous power")
    if flags & 0x0080:
        result["average_power_w"] = reader.i16("average power")
    if flags & 0x0100:
        result["calories_total"] = reader.u16("total energy")
        result["calories_per_hour"] = reader.u16("energy per hour")
        result["calories_per_minute"] = reader.u8("energy per minute")
    if flags & 0x0200:
        result["heart_rate_bpm"] = reader.u8("heart rate")
    if flags & 0x0400:
        result["metabolic_equivalent"] = round(reader.u8("metabolic equivalent") * 0.1, 1)
    if flags & 0x0800:
        result["elapsed_s"] = reader.u16("elapsed time")
    if flags & 0x1000:
        result["remaining_s"] = reader.u16("remaining time")

    return result


def event_from_notification(data: bytes) -> dict[str, Any]:
    return {
        "received_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "metrics": parse_indoor_bike_data(data),
        "raw_hex": bytes(data).hex(),
    }


async def stream_echo_v3(address: str | None, name_prefix: str = "Echo") -> None:
    """Print live notifications. Requires `pip install bleak`."""

    from bleak import BleakClient, BleakScanner

    if address is None:
        devices = await BleakScanner.discover(timeout=8.0)
        candidates = [d for d in devices if (d.name or "").lower().startswith(name_prefix.lower())]
        if not candidates:
            raise RuntimeError(f"No BLE device with name prefix {name_prefix!r} found")
        device = candidates[0]
        address = device.address
        print(f"Selected {device.name or 'unnamed'} ({address})")

    stop = asyncio.Event()

    def on_data(_: Any, payload: bytearray) -> None:
        try:
            print(event_from_notification(bytes(payload)))
        except ValueError as exc:
            print({"parse_error": str(exc), "raw_hex": bytes(payload).hex()})

    async with BleakClient(address) as client:
        await client.start_notify(INDOOR_BIKE_DATA_UUID, on_data)
        print("Subscribed to Echo V3 Indoor Bike Data. Press Ctrl-C to stop.")
        try:
            await stop.wait()
        except KeyboardInterrupt:
            pass
        finally:
            await client.stop_notify(INDOOR_BIKE_DATA_UUID)


def main() -> None:
    parser = argparse.ArgumentParser(description="Read Rogue Echo Bike V3 FTMS telemetry")
    parser.add_argument("--address", help="BLE address/identifier; otherwise scan")
    parser.add_argument("--name-prefix", default="Echo", help="device-name prefix used during scan")
    args = parser.parse_args()
    asyncio.run(stream_echo_v3(args.address, args.name_prefix))


if __name__ == "__main__":
    main()

