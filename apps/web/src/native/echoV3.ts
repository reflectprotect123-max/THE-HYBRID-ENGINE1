/**
 * Original starter adapter for a Rogue Echo Bike V3.0 standard console.
 *
 * Scope: read-only BLE/FTMS telemetry. Control Point writes are intentionally
 * not included in the first adapter because Echo-specific acceptance of target
 * procedures has not been packet-validated.
 */

export const ECHO_V3 = {
  service: "00001826-0000-1000-8000-00805f9b34fb",
  indoorBikeData: "00002ad2-0000-1000-8000-00805f9b34fb",
  controlPoint: "00002ad9-0000-1000-8000-00805f9b34fb",
  machineStatus: "00002ada-0000-1000-8000-00805f9b34fb",
  heartRateService: "0000180d-0000-1000-8000-00805f9b34fb",
  heartRateMeasurement: "00002a37-0000-1000-8000-00805f9b34fb",
} as const;

export interface EchoV3Metrics {
  flags: number;
  speed_kmh?: number;
  average_speed_kmh?: number;
  cadence_rpm?: number;
  average_cadence_rpm?: number;
  distance_m?: number;
  resistance_level?: number;
  power_w?: number;
  average_power_w?: number;
  calories_total?: number;
  calories_per_hour?: number;
  calories_per_minute?: number;
  heart_rate_bpm?: number;
  metabolic_equivalent?: number;
  elapsed_s?: number;
  remaining_s?: number;
}

export interface EchoV3Event extends EchoV3Metrics {
  received_at: string;
  raw_hex: string;
}

type ByteSource = ArrayBuffer | ArrayBufferView;

function asDataView(source: ByteSource): DataView {
  if (source instanceof ArrayBuffer) return new DataView(source);
  const view = source as ArrayBufferView;
  return new DataView(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
}

function requireBytes(view: DataView, offset: number, size: number, field: string): void {
  if (offset + size > view.byteLength) {
    throw new RangeError(`Truncated FTMS Indoor Bike Data before ${field}`);
  }
}

function readU8(view: DataView, offset: number, field: string): number {
  requireBytes(view, offset, 1, field);
  return view.getUint8(offset);
}

function readU16(view: DataView, offset: number, field: string): number {
  requireBytes(view, offset, 2, field);
  return view.getUint16(offset, true);
}

function readI16(view: DataView, offset: number, field: string): number {
  requireBytes(view, offset, 2, field);
  return view.getInt16(offset, true);
}

function readU24(view: DataView, offset: number, field: string): number {
  requireBytes(view, offset, 3, field);
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
}

/** Decode one FTMS Indoor Bike Data notification. */
export function parseIndoorBikeData(source: ByteSource): EchoV3Metrics {
  const view = asDataView(source);
  requireBytes(view, 0, 2, "flags");

  const flags = view.getUint16(0, true);
  let offset = 2;
  const result: EchoV3Metrics = { flags };

  // Bit 0 is inverted: instantaneous speed is present when the bit is clear.
  if ((flags & 0x0001) === 0) {
    result.speed_kmh = readU16(view, offset, "instantaneous speed") * 0.01;
    offset += 2;
  }
  if (flags & 0x0002) {
    result.average_speed_kmh = readU16(view, offset, "average speed") * 0.01;
    offset += 2;
  }
  if (flags & 0x0004) {
    result.cadence_rpm = readU16(view, offset, "instantaneous cadence") * 0.5;
    offset += 2;
  }
  if (flags & 0x0008) {
    result.average_cadence_rpm = readU16(view, offset, "average cadence") * 0.5;
    offset += 2;
  }
  if (flags & 0x0010) {
    result.distance_m = readU24(view, offset, "total distance");
    offset += 3;
  }
  if (flags & 0x0020) {
    result.resistance_level = readI16(view, offset, "resistance level");
    offset += 2;
  }
  if (flags & 0x0040) {
    result.power_w = readI16(view, offset, "instantaneous power");
    offset += 2;
  }
  if (flags & 0x0080) {
    result.average_power_w = readI16(view, offset, "average power");
    offset += 2;
  }
  if (flags & 0x0100) {
    result.calories_total = readU16(view, offset, "total energy");
    offset += 2;
    result.calories_per_hour = readU16(view, offset, "energy per hour");
    offset += 2;
    result.calories_per_minute = readU8(view, offset, "energy per minute");
    offset += 1;
  }
  if (flags & 0x0200) {
    result.heart_rate_bpm = readU8(view, offset, "heart rate");
    offset += 1;
  }
  if (flags & 0x0400) {
    result.metabolic_equivalent = readU8(view, offset, "metabolic equivalent") * 0.1;
    offset += 1;
  }
  if (flags & 0x0800) {
    result.elapsed_s = readU16(view, offset, "elapsed time");
    offset += 2;
  }
  if (flags & 0x1000) {
    result.remaining_s = readU16(view, offset, "remaining time");
  }

  return result;
}

export function toEchoV3Event(source: ByteSource, receivedAt = new Date()): EchoV3Event {
  const bytes = source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer as ArrayBuffer, source.byteOffset, source.byteLength);

  return {
    ...parseIndoorBikeData(source),
    received_at: receivedAt.toISOString(),
    raw_hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

interface EchoBluetoothCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications: () => Promise<EchoBluetoothCharacteristic>;
}

interface EchoBluetoothService {
  getCharacteristic: (uuid: string) => Promise<EchoBluetoothCharacteristic>;
}

interface EchoBluetoothServer {
  getPrimaryService: (uuid: string) => Promise<EchoBluetoothService>;
}

interface EchoBluetoothDevice extends EventTarget {
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<EchoBluetoothServer>;
    disconnect: () => void;
  };
}

interface EchoBluetooth {
  requestDevice: (options: {
    filters: Array<{ services: string[] }>;
    optionalServices: string[];
  }) => Promise<EchoBluetoothDevice>;
}

export interface EchoV3Connection {
  device: EchoBluetoothDevice;
  disconnect: () => void;
}

export async function connectEchoV3(
  onEvent: (event: EchoV3Event) => void,
  onDisconnected?: () => void,
): Promise<EchoV3Connection> {
  const bluetooth = (navigator as Navigator & { bluetooth?: EchoBluetooth }).bluetooth;
  if (!bluetooth) {
    throw new Error("Web Bluetooth is unavailable in this browser or context");
  }

  const device = await bluetooth.requestDevice({
    filters: [{ services: [ECHO_V3.service] }],
    optionalServices: [ECHO_V3.heartRateService],
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error("Could not connect to the Echo V3 GATT server");

  const service = await server.getPrimaryService(ECHO_V3.service);
  const characteristic = await service.getCharacteristic(ECHO_V3.indoorBikeData);

  const onValue = (event: Event) => {
    const source = (event.target as EchoBluetoothCharacteristic).value;
    if (source) onEvent(toEchoV3Event(source));
  };
  const onLinkLoss = () => onDisconnected?.();

  characteristic.addEventListener("characteristicvaluechanged", onValue);
  device.addEventListener("gattserverdisconnected", onLinkLoss);
  await characteristic.startNotifications();

  let closed = false;
  return {
    device,
    disconnect: () => {
      if (closed) return;
      closed = true;
      characteristic.removeEventListener("characteristicvaluechanged", onValue);
      device.removeEventListener("gattserverdisconnected", onLinkLoss);
      if (device.gatt?.connected) device.gatt.disconnect();
    },
  };
}
