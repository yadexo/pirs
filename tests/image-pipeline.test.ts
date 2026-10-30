import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage } from "@/lib/image-pipeline";
import { specFor, outputSize } from "@/lib/image-spec";
import type { UploadError } from "@/lib/upload-error";

/**
 * The pipeline's promise is that a clinic's own photo is adjusted rather than
 * refused. These cover the adjustments that are easy to get silently wrong —
 * EXIF orientation, transparency, the app icon's canvas — and the two things
 * that must never regress: location metadata leaving the building, and a
 * decompression bomb being decoded.
 */

const solid = (width: number, height: number, background: string) => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

async function corner(buffer: Buffer): Promise<number[]> {
  const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  return [...data.subarray(0, 3)];
}

describe("processing an uploaded image", () => {
  it("accepts every format we claim to accept", async () => {
    const source = await solid(1600, 1200, "#336699");
    const inputs = {
      png: await sharp(source).png().toBuffer(),
      jpeg: await sharp(source).jpeg().toBuffer(),
      webp: await sharp(source).webp().toBuffer(),
      gif: await sharp(source).gif().toBuffer(),
      avif: await sharp(source).avif({ quality: 50 }).toBuffer(),
    };
    for (const [name, buffer] of Object.entries(inputs)) {
      const out = await processImage(buffer, { purpose: "product-image" });
      expect([name, out.width, out.height, out.mime]).toEqual([name, 1200, 900, "image/webp"]);
    }
  });

  it("applies the orientation an iPhone recorded, instead of serving a sideways photo", async () => {
    // Orientation 6 means "rotate 90° clockwise to display": a 1200×600 file
    // is a 600×1200 photograph, and resizing before rotating gets it wrong.
    const landscape = await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#ff0000" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const out = await processImage(landscape, { purpose: "client-result" });
    expect(out.height).toBeGreaterThan(out.width);

    const meta = await sharp(out.buffer).metadata();
    // The rotation is baked into the pixels, so no viewer has to re-apply it.
    expect(meta.orientation).toBeUndefined();
  });

  it("strips EXIF, including location, by re-encoding", async () => {
    const withGps = await sharp({ create: { width: 900, height: 900, channels: 3, background: "#123456" } })
      // IFD3 is the GPS directory — the one that tells anyone who downloads a
      // clinic's photo where it was taken.
      .withMetadata({ exif: { IFD0: { Copyright: "Clinic" }, IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const out = await processImage(withGps, { purpose: "product-image" });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it("fits a non-square app icon onto the brand colour, and a square one edge to edge", async () => {
    const wide = await solid(900, 300, "#ff0000");
    const wideIcon = await processImage(wide, { purpose: "app-icon", brandColor: "#00ff00" });
    expect([wideIcon.width, wideIcon.height, wideIcon.mime]).toEqual([1024, 1024, "image/png"]);
    // Letterboxed onto the brand colour rather than cropped into something
    // the clinic never uploaded.
    expect(await corner(wideIcon.buffer)).toEqual([0, 255, 0]);

    const square = await solid(1024, 1024, "#ff0000");
    const squareIcon = await processImage(square, { purpose: "app-icon", brandColor: "#00ff00" });
    expect(await corner(squareIcon.buffer)).toEqual([255, 0, 0]);
  });

  it("accepts a small app icon and scales it up, where it used to refuse anything under 512", async () => {
    const small = await solid(250, 250, "#ff8800");
    const out = await processImage(small, { purpose: "app-icon", brandColor: "#000000" });
    expect([out.width, out.height]).toEqual([1024, 1024]);
  });

  it("refuses only what is too small to work with, and says what the minimum is", async () => {
    const tiny = await solid(150, 150, "#ffffff");
    await expect(processImage(tiny, { purpose: "app-icon" })).rejects.toThrow(/at least 200×200/);
    try {
      await processImage(tiny, { purpose: "app-icon" });
    } catch (err) {
      expect((err as UploadError).code).toBe("tooSmall");
      expect((err as UploadError).params).toMatchObject({ minWidth: 200, minHeight: 200 });
    }
  });

  it("keeps a logo's transparency and its proportions", async () => {
    const transparent = await sharp({ create: { width: 2000, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const out = await processImage(transparent, { purpose: "logo" });
    expect(out.mime).toBe("image/png");
    expect([out.width, out.height]).toEqual([1024, 256]);
    expect((await sharp(out.buffer).metadata()).hasAlpha).toBe(true);
  });

  it("uses WebP for a logo with nothing to keep transparent", async () => {
    const out = await processImage(await solid(2000, 500, "#101010"), { purpose: "logo" });
    expect(out.mime).toBe("image/webp");
  });

  it("does not enlarge a photo past its own resolution", async () => {
    const out = await processImage(await solid(400, 300, "#222222"), { purpose: "client-result" });
    expect([out.width, out.height]).toEqual([400, 300]);
  });

  it("crops product photos to the aspect the clinic chose", async () => {
    const source = await solid(2000, 2000, "#445566");
    expect(await processImage(source, { purpose: "product-image", aspect: 1 })).toMatchObject({ width: 1200, height: 1200 });
    expect(await processImage(source, { purpose: "product-image", aspect: 4 / 3 })).toMatchObject({ width: 1200, height: 900 });
  });

  it("resizes an image with no purpose rather than storing it untouched", async () => {
    const out = await processImage(await solid(3000, 3000, "#777777"), {});
    expect([out.width, out.height]).toEqual([1600, 1600]);
  });

  it("refuses a decompression bomb instead of decoding it", async () => {
    // A 12000×12000 PNG of one colour is a few hundred KB on disk and 576MB
    // decoded — the shape of attack limitInputPixels exists to stop.
    const bomb = await sharp({ create: { width: 12000, height: 12000, channels: 3, background: "#000000" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(processImage(bomb, { purpose: "product-image" })).rejects.toMatchObject({ code: "tooComplex" });
  });

  it("reports an unreadable file as something the browser can explain", async () => {
    await expect(processImage(Buffer.from("not an image at all"), { purpose: "logo" })).rejects.toMatchObject({ code: "corrupt" });
  });
});

describe("the per-purpose spec", () => {
  it("gives every purpose used by a form a spec, and everything else the default", () => {
    for (const purpose of ["app-icon", "logo", "product-image", "client-result", "cover-image", "offer-image", "package-image"]) {
      expect(specFor(purpose).label).toBeTruthy();
    }
    expect(specFor("something-new")).toEqual(specFor(undefined));
    expect(specFor(null).output).toEqual({ maxEdge: 1600 });
  });

  it("derives the output size from the chosen aspect", () => {
    expect(outputSize(specFor("product-image"), 1)).toEqual({ width: 1200, height: 1200 });
    expect(outputSize(specFor("cover-image"))).toEqual({ width: 1600, height: 900 });
  });
});
