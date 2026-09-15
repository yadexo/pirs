import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
const { parseIconFile, loadIconSource, renderAppIcon } = await import("@/lib/app-icon");

describe("clinic app icons", () => {
  it("serves only the sizes the manifest names", () => {
    expect(parseIconFile("192.png")).toEqual({ size: 192, maskable: false });
    expect(parseIconFile("maskable-512.png")).toEqual({ size: 512, maskable: true });
    for (const f of ["100.png", "512.jpg", "../512.png", "maskable-.png"]) expect(parseIconFile(f)).toBeNull();
  });

  it("never fetches an icon from outside our own storage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env = { S3_PUBLIC_URL: "https://cdn.example.com" } as NodeJS.ProcessEnv;
    for (const url of ["http://169.254.169.254/latest/meta-data", "https://evil.example.com/uploads/a.png", "/uploads/../../.env", "https://cdn.example.com/other/a.png", "https://cdn.example.com.evil.com/uploads/a.png"]) {
      expect(await loadIconSource(url, env)).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("resizes the uploaded icon to a square PNG of the requested size", async () => {
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#336699" } }).png().toBuffer();
    for (const variant of [{ size: 180, maskable: false }, { size: 512, maskable: true }] as const) {
      const meta = await sharp(await renderAppIcon(source, variant, { name: "Glow", color: null })).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["png", variant.size, variant.size]);
    }
  });

  it("falls back to a monogram tile for no icon or a broken upload", async () => {
    for (const source of [null, Buffer.from("not an image")]) {
      const png = await renderAppIcon(source, { size: 192, maskable: false }, { name: "Riverside <Clinic>", color: "#0f766e" });
      expect((await sharp(png).metadata()).width).toBe(192);
    }
  });
});
