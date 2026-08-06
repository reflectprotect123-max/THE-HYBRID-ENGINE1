/*
 * The FTMS Indoor Bike Data parser, pinned against the same hand-verified
 * payload the web adapter's suite uses (apps/web/test/echoV3.test.ts, from
 * docs/research/echo-v3-connectivity-bundle/code/starter/sample_payloads.json).
 * The mobile parser is a port of the web one onto a plain number[] — this file
 * is what proves the port decodes to the identical field values, because every
 * offset in an FTMS frame depends on every preceding flag being walked in
 * order: one misread flag and every field after it is silently wrong.
 */
import { parseIndoorBikeData } from '../src/native/capabilities';

const hexBytes = (hex: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
};

// flags 0x0b54: speed (bit 0 clear), cadence, distance, power, energy, HR, elapsed
const fullPayload = hexBytes('540bc409a000d204002c011900f4010a965802');

describe('FTMS Indoor Bike Data parser', () => {
  test('decodes the hand-verified full payload to the same values as web', () => {
    const decoded = parseIndoorBikeData(fullPayload);
    expect(decoded.flags).toBe(0x0b54);
    expect(decoded.speed_kmh).toBe(25);
    expect(decoded.cadence_rpm).toBe(80);
    expect(decoded.distance_m).toBe(1234);
    expect(decoded.power_w).toBe(300);
    expect(decoded.calories_total).toBe(25);
    expect(decoded.calories_per_hour).toBe(500);
    expect(decoded.calories_per_minute).toBe(10);
    expect(decoded.heart_rate_bpm).toBe(150);
    expect(decoded.elapsed_s).toBe(600);
    // Fields whose flags are off must be absent, not zero — the screen keeps
    // last-known values and an invented 0 would wipe them.
    expect(decoded.average_speed_kmh).toBeUndefined();
    expect(decoded.average_power_w).toBeUndefined();
    expect(decoded.remaining_s).toBeUndefined();
  });

  test('a flag-gated frame carries only what its flags say', () => {
    // flags 0x0041: bit 0 SET (speed absent — the inverted bit), power only.
    const decoded = parseIndoorBikeData(hexBytes('41002c01'));
    expect(decoded.power_w).toBe(300);
    expect(decoded.speed_kmh).toBeUndefined();
    expect(decoded.cadence_rpm).toBeUndefined();
    expect(decoded.distance_m).toBeUndefined();
  });

  test('power is sign-extended sint16', () => {
    expect(parseIndoorBikeData(hexBytes('4100ffff')).power_w).toBe(-1);
  });

  test('rejects a truncated payload', () => {
    // flags claim more fields than the frame actually carries.
    expect(() => parseIndoorBikeData(hexBytes('4000'))).toThrow(/Truncated/);
    expect(() => parseIndoorBikeData([0x54])).toThrow(/Truncated/);
  });
});
