import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseIndoorBikeData, toEchoV3Event } from "./echoV3";

const fullPayload = Uint8Array.from([
  0x54, 0x0b, // speed, cadence, distance, power, energy, HR, elapsed
  0xc4, 0x09, // 25.00 km/h
  0xa0, 0x00, // 80 rpm
  0xd2, 0x04, 0x00, // 1234 m
  0x2c, 0x01, // 300 W
  0x19, 0x00, // 25 kcal
  0xf4, 0x01, // 500 kcal/h
  0x0a, // 10 kcal/min
  0x96, // 150 bpm
  0x58, 0x02, // 600 s
]);

describe("Echo V3 FTMS Indoor Bike Data parser", () => {
  it("decodes the hand-verified full payload", () => {
    const decoded = parseIndoorBikeData(fullPayload);
    assert.equal(decoded.flags, 0x0b54);
    assert.equal(decoded.speed_kmh, 25);
    assert.equal(decoded.cadence_rpm, 80);
    assert.equal(decoded.distance_m, 1234);
    assert.equal(decoded.power_w, 300);
    assert.equal(decoded.calories_total, 25);
    assert.equal(decoded.calories_per_hour, 500);
    assert.equal(decoded.calories_per_minute, 10);
    assert.equal(decoded.heart_rate_bpm, 150);
    assert.equal(decoded.elapsed_s, 600);
  });

  it("wraps a notification into an event with raw hex and timestamp", () => {
    const event = toEchoV3Event(fullPayload, new Date("2026-07-31T00:00:00.000Z"));
    assert.equal(event.raw_hex, "540bc409a000d204002c011900f4010a965802");
    assert.equal(event.received_at, "2026-07-31T00:00:00.000Z");
  });

  it("rejects a truncated payload", () => {
    assert.throws(() => parseIndoorBikeData(Uint8Array.from([0x40, 0x00])), /Truncated/);
  });
});
