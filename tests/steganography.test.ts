import { describe, expect, it } from "vitest";

import { embedImage, extractImage } from "../lib/steganography-core";

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
});
