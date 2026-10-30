import { describe, it, expect } from "vitest";
import { validateUpload, sniffImage, getStorageProvider, S3StorageProvider, MAX_FILE_BYTES } from "@/lib/providers/storage";
import { UploadError } from "@/lib/upload-error";

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
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_BYTES)]);
    expect(() => validateUpload({ buffer: huge })).toThrow(/15MB/);
    // A phone photo that would once have been refused outright is now fine:
    // the browser downscales before uploading, and the server resizes again.
    expect(() => validateUpload({ buffer: Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]) })).not.toThrow();
  });

  it("recognises AVIF, and names HEIC rather than calling it unsupported", () => {
    const iso = (brand: string) => Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(8)]);

    expect(sniffImage(iso("avif"))).toMatchObject({ kind: "avif", accepted: true });
    expect(validateUpload({ buffer: iso("avif") })).toEqual({ mime: "image/avif", ext: ".avif" });

    for (const brand of ["heic", "heix", "hevc", "mif1"]) {
      expect(sniffImage(iso(brand))).toMatchObject({ kind: "heic", accepted: false });
      // The deployed sharp has libheif for AVIF only, so this cannot be
      // decoded server-side — the message has to tell the clinic what to do.
      try {
        validateUpload({ buffer: iso(brand) });
        throw new Error(`expected ${brand} to be refused`);
      } catch (err) {
        expect((err as UploadError).code).toBe("heicUnsupported");
        expect((err as UploadError).message).toMatch(/iPhone/);
      }
    }
  });
});

/**
 * The bug this guards: STORAGE_PROVIDER used to be compared with === "s3" and
 * anything else silently meant "write to local disk", which on Vercel is a
 * read-only filesystem. Every clinic's upload failed with an EROFS reported as
 * if they had sent a bad file. A value that isn't a provider must say so.
 */
describe("choosing a storage provider", () => {
  const s3Env = {
    STORAGE_PROVIDER: "s3",
    S3_BUCKET: "b",
    S3_ACCESS_KEY_ID: "k",
    S3_SECRET_ACCESS_KEY: "s",
    S3_PUBLIC_URL: "https://cdn.example.com",
  } as unknown as NodeJS.ProcessEnv;

  it("uses S3 when it is configured", () => {
    expect(getStorageProvider(s3Env)).toBeInstanceOf(S3StorageProvider);
  });

  it("names the S3 settings that are missing instead of failing later", () => {
    const partial = { ...s3Env, S3_PUBLIC_URL: "" } as NodeJS.ProcessEnv;
    expect(() => getStorageProvider(partial)).toThrow(/Missing: S3_PUBLIC_URL/);
    try {
      getStorageProvider(partial);
    } catch (err) {
      expect((err as UploadError).code).toBe("storageMisconfigured");
    }
  });

  it("refuses a value that is not a provider, rather than guessing", () => {
    for (const value of ["S3", "disk", "aws", "s3 "]) {
      const env = { STORAGE_PROVIDER: value } as unknown as NodeJS.ProcessEnv;
      // "s3 " is only whitespace away and is forgiven; the rest are reported.
      if (value.trim() === "s3") continue;
      expect(() => getStorageProvider(env)).toThrow(/not a storage provider/);
    }
    expect(getStorageProvider({ STORAGE_PROVIDER: " s3 ", ...s3Env } as unknown as NodeJS.ProcessEnv)).toBeInstanceOf(S3StorageProvider);
  });

  it("refuses local disk on a host that cannot be written to", () => {
    for (const env of [
      { STORAGE_PROVIDER: "local", VERCEL: "1" },
      { VERCEL: "1" },
      { STORAGE_PROVIDER: "local", VERCEL_ENV: "production" },
      { APP_ENV: "production" },
    ] as unknown as NodeJS.ProcessEnv[]) {
      expect(() => getStorageProvider(env)).toThrow(/cannot write to/);
    }
  });

  it("still uses local disk in development", () => {
    expect(getStorageProvider({ STORAGE_PROVIDER: "local" } as unknown as NodeJS.ProcessEnv)).toBeTruthy();
    expect(getStorageProvider({} as NodeJS.ProcessEnv)).toBeTruthy();
  });
});
