import { describe, it, expect } from "vitest";
import { validateUpload } from "@/lib/providers/storage";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = Buffer.from("GIF89a\x01\x00", "binary");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

describe("upload validation", () => {
  it("identifies each accepted image type from its bytes", () => {
    expect(validateUpload({ buffer: PNG })).toEqual({ mime: "image/png", ext: ".png" });
    expect(validateUpload({ buffer: JPEG })).toEqual({ mime: "image/jpeg", ext: ".jpg" });
    expect(validateUpload({ buffer: GIF })).toEqual({ mime: "image/gif", ext: ".gif" });
    expect(validateUpload({ buffer: WEBP })).toEqual({ mime: "image/webp", ext: ".webp" });
  });

  it("rejects SVG, which can carry script and would be served from our origin", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(() => validateUpload({ buffer: svg, mimeType: "image/svg+xml" })).toThrow(/Unsupported file type/);
  });

  it("ignores a lying Content-Type: HTML declared as PNG is refused", () => {
    const html = Buffer.from("<html><script>steal()</script></html>");
    expect(() => validateUpload({ buffer: html, mimeType: "image/png" })).toThrow(/Unsupported file type/);
  });

  it("trusts the bytes over the declared type: a real PNG declared as GIF is a PNG", () => {
    expect(validateUpload({ buffer: PNG, mimeType: "image/gif" }).ext).toBe(".png");
  });

  it("rejects empty and oversized files", () => {
    expect(() => validateUpload({ buffer: Buffer.alloc(0) })).toThrow(/empty/);
    const huge = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect(() => validateUpload({ buffer: huge })).toThrow(/5MB/);
  });
});
