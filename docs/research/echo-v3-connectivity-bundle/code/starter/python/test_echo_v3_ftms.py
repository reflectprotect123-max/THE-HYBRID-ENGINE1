import unittest

from echo_v3_ftms import parse_indoor_bike_data


class EchoV3ParserTests(unittest.TestCase):
    def test_full_payload(self):
        payload = bytes.fromhex("540bc409a000d204002c011900f4010a965802")
        self.assertEqual(
            parse_indoor_bike_data(payload),
            {
                "flags": 0x0B54,
                "speed_kmh": 25.0,
                "cadence_rpm": 80.0,
                "distance_m": 1234,
                "power_w": 300,
                "calories_total": 25,
                "calories_per_hour": 500,
                "calories_per_minute": 10,
                "heart_rate_bpm": 150,
                "elapsed_s": 600,
            },
        )

    def test_negative_power_uses_signed_int16(self):
        # Flags: instantaneous speed + instantaneous power.
        payload = bytes.fromhex("4000e803ffff")
        decoded = parse_indoor_bike_data(payload)
        self.assertEqual(decoded["speed_kmh"], 10.0)
        self.assertEqual(decoded["power_w"], -1)

    def test_truncated_payload_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Truncated"):
            parse_indoor_bike_data(bytes.fromhex("4000"))


if __name__ == "__main__":
    unittest.main()

