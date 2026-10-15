import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
const { renderLaunchImage } = await import("@/lib/app-icon");
const { allLaunchImagePixelSizes, launchImageMedia, parseLaunchImageFile } = await import("@/lib/launch-image-sizes");

describe("iOS launch images", () => {
  it("parses only the exact sizes this app generates", () => {
    const [first] = allLaunchImagePixelSizes();
    expect(first).toBeDefined();
    expect(parseLaunchImageFile(`${first!.width}x${first!.height}.png`)).toEqual(first);
    for (const f of ["100x100.png", "750x1334.jpg", "../750x1334.png", "abcxdef.png"]) {
      expect(parseLaunchImageFile(f)).toBeNull();
    }
  });

  it("writes a media query Safari can match a real device against", () => {
    const media = launchImageMedia({ cssWidth: 390, cssHeight: 844, dpr: 3 });
    expect(media).toBe("(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)");
  });

  it("renders the exact pixel size requested, logo centred on the chosen background", async () => {
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#ff0000" } }).png().toBuffer();

    const brand = await sharp(await renderLaunchImage(source, { width: 200, height: 400 }, { name: "Glow", color: "#00ff00", background: "brand" }))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([brand.info.width, brand.info.height]).toEqual([200, 400]);
    // The corner is background, not the logo — the logo only covers the centre.
    expect([...brand.data.subarray(0, 3)]).toEqual([0, 255, 0]);

    const white = await sharp(await renderLaunchImage(source, { width: 200, height: 400 }, { name: "Glow", color: "#00ff00", background: "white" }))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...white.data.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  it("falls back to a monogram on a broken or missing upload", async () => {
    for (const source of [null, Buffer.from("not an image")]) {
      const png = await renderLaunchImage(source, { width: 100, height: 200 }, { name: "Riverside Clinic", color: "#0f766e", background: "brand" });
      expect((await sharp(png).metadata()).width).toBe(100);
    }
  });
});
