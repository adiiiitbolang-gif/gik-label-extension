// Direct printing to TSPL label printers (Xprinter XP-4601B and similar) from Chrome,
// without the printer's own app: each label canvas is sent as a TSPL BITMAP.
//   Bluetooth Classic: Web Serial over RFCOMM (Chrome on Android 138+), remembered after the first pick.
//   Bluetooth LE:      Web Bluetooth, for printers that expose a BLE UART service.

const SPP = "00001101-0000-1000-8000-00805f9b34fb";
// BLE UART services used by common thermal printer modules.
const BLE_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
];

const enc = new TextEncoder();

// TSPL BITMAP: 1 bit per dot, rows top to bottom, bit 0 = black.
function bitmapBytes(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(rowBytes * h).fill(0xff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      if (px[i + 3] > 128 && lum < 128) out[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  return { rowBytes, h, out };
}

// One print job for all labels: 50 x 30 mm, 2 mm gap.
export function tsplJob(canvases) {
  const parts = [enc.encode("SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nDENSITY 10\r\nSPEED 4\r\n")];
  for (const c of canvases) {
    const { rowBytes, h, out } = bitmapBytes(c);
    parts.push(enc.encode(`CLS\r\nBITMAP 0,0,${rowBytes},${h},0,`), out, enc.encode("\r\nPRINT 1,1\r\n"));
  }
  const total = parts.reduce((t, p) => t + p.length, 0);
  const job = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { job.set(p, o); o += p.length; }
  return job;
}

export const canSerial = () => Boolean(navigator.serial);
export const canBle = () => Boolean(navigator.bluetooth);

async function sendSerial(port, data) {
  if (!port.readable && !port.writable) await port.open({ baudRate: 115200 });
  const w = port.writable.getWriter();
  try {
    for (let o = 0; o < data.length; o += 4096) await w.write(data.subarray(o, o + 4096));
  } finally {
    w.releaseLock();
  }
}

// Already-granted printer (no chooser), or ask once.
export async function printSerial(data, { pick = false } = {}) {
  let port = pick ? null : (await navigator.serial.getPorts())[0];
  if (!port) port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP], filters: [{ bluetoothServiceClassId: SPP }] });
  await sendSerial(port, data);
  await new Promise((r) => setTimeout(r, 300));
  try { await port.close(); } catch { /* still printing is fine */ }
}

let bleChar = null;
async function bleCharacteristic() {
  if (bleChar?.service?.device?.gatt?.connected) return bleChar;
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  const server = await device.gatt.connect();
  for (const uuid of BLE_SERVICES) {
    let service;
    try { service = await server.getPrimaryService(uuid); } catch { continue; }
    for (const ch of await service.getCharacteristics()) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) return (bleChar = ch);
    }
  }
  device.gatt.disconnect();
  throw new Error("This printer has no Bluetooth LE print service. Use the Bluetooth (classic) option.");
}

export async function printBle(data, onProgress) {
  const ch = await bleCharacteristic();
  let size = 180; // drops to 20 bytes when the link didn't negotiate a bigger packet
  for (let o = 0; o < data.length; ) {
    const chunk = data.subarray(o, o + size);
    try {
      if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(chunk);
      else await ch.writeValue(chunk);
    } catch (e) {
      if (size === 20) throw e;
      size = 20;
      continue;
    }
    o += chunk.length;
    onProgress?.(Math.min(1, o / data.length));
  }
}
