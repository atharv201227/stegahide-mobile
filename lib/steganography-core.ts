const MAGIC = new Uint8Array([83, 84, 69, 71, 65, 72, 73, 68, 69, 0]);
const VERSION = 1;

export type ExtractedPayload = {
  base64: string;
  mimeType: string;
};

function concatBytes(...parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function numberToBytes(value: number) {
  return new Uint8Array([
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]);
}

function bytesToNumber(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 2 ** 24 +
    bytes[offset + 1] * 2 ** 16 +
    bytes[offset + 2] * 2 ** 8 +
    bytes[offset + 3]
  );
}

function base64ToBytes(base64: string) {
  const binary = globalThis.atob(base64);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

function textToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToText(value: Uint8Array) {
  return new TextDecoder().decode(value);
}

export function embedImage(carrierBase64: string, payloadBase64: string, payloadMimeType = "image/png") {
  const carrier = base64ToBytes(carrierBase64);
  const payload = base64ToBytes(payloadBase64);
  const mime = textToBytes(payloadMimeType);
  if (mime.length > 255) throw new Error("Unsupported payload type");

  const header = concatBytes(
    MAGIC,
    new Uint8Array([VERSION, mime.length]),
    mime,
    numberToBytes(payload.length),
    payload,
  );
  return bytesToBase64(concatBytes(carrier, header));
}

export function extractImage(carrierBase64: string): ExtractedPayload {
  const bytes = base64ToBytes(carrierBase64);
  const minimumLength = MAGIC.length + 2 + 4;
  if (bytes.length < minimumLength) throw new Error("No StegaHide payload found");

  for (let index = bytes.length - minimumLength; index >= 0; index -= 1) {
    let matches = true;
    for (let magicIndex = 0; magicIndex < MAGIC.length; magicIndex += 1) {
      if (bytes[index + magicIndex] !== MAGIC[magicIndex]) {
        matches = false;
        break;
      }
    }
    if (!matches || bytes[index + MAGIC.length] !== VERSION) continue;

    const mimeLength = bytes[index + MAGIC.length + 1];
    const mimeStart = index + MAGIC.length + 2;
    const lengthStart = mimeStart + mimeLength;
    if (lengthStart + 4 > bytes.length) continue;
    const payloadLength = bytesToNumber(bytes, lengthStart);
    const payloadStart = lengthStart + 4;
    if (payloadStart + payloadLength !== bytes.length) continue;

    const mimeType = bytesToText(bytes.subarray(mimeStart, lengthStart)) || "image/png";
    const payload = bytes.subarray(payloadStart, payloadStart + payloadLength);
    return { base64: bytesToBase64(payload), mimeType };
  }

  throw new Error("No valid StegaHide payload found in this image");
}
