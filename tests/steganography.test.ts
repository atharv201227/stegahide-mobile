import { describe, expect, it } from "vitest";

import {
  calculateMaxPayloadBytes,
  decryptPayload,
  embedImage,
  encryptPayload,
  extractImage,
  validatePayloadCapacity,
} from "../lib/steganography-core";

describe("steganography payload", () => {
  it("round trips a hidden image payload without changing carrier bytes", () => {
    const carrier = btoa("carrier-image-bytes");
    const payload = btoa("secret-image-bytes");
    const encoded = embedImage(carrier, payload, "image/png");
    const extracted = extractImage(encoded);

    expect(extracted.mimeType).toBe("image/png");
    expect(atob(extracted.base64)).toBe("secret-image-bytes");
    expect(atob(encoded).startsWith("carrier-image-bytes")).toBe(true);
  });

  it("rejects images without a valid StegaHide footer", () => {
    expect(() => extractImage(btoa("ordinary-image"))).toThrow(/payload/i);
  });

  it("calculates a conservative carrier payload budget", () => {
    expect(calculateMaxPayloadBytes(100, 80)).toBe(4000);
  });

  it("rejects a payload that exceeds carrier bytes or dimensions", () => {
    const payload = btoa("x".repeat(80));
    const result = validatePayloadCapacity({
      carrierWidth: 10,
      carrierHeight: 10,
      payloadWidth: 12,
      payloadHeight: 8,
      payloadBase64: payload,
    });

    expect(result.payloadFits).toBe(false);
    expect(result.dimensionsFit).toBe(false);
    expect(result.fits).toBe(false);
  });

  it("accepts a payload that fits both checks", () => {
    const result = validatePayloadCapacity({
      carrierWidth: 100,
      carrierHeight: 100,
      payloadWidth: 80,
      payloadHeight: 70,
      payloadBase64: btoa("small-secret"),
    });

    expect(result.fits).toBe(true);
    expect(result.remainingBytes).toBeGreaterThan(0);
  });

  it("encrypts and decrypts a secret payload with a password", () => {
    const encrypted = encryptPayload(btoa("secret-image"), "image/jpeg", "correct horse");
    expect(encrypted).not.toContain("secret-image");
    expect(decryptPayload(encrypted, "correct horse")).toEqual({ base64: btoa("secret-image"), mimeType: "image/jpeg" });
  });

  it("rejects an incorrect password", () => {
    const encrypted = encryptPayload(btoa("secret-image"), "image/jpeg", "correct horse");
    expect(() => decryptPayload(encrypted, "wrong password")).toThrow(/password/i);
  });
});
