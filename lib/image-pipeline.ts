import "server-only";
import sharp from "sharp";
import { UploadError } from "@/lib/upload-error";
import { iconCanvas } from "@/lib/app-icon";
import { outputSize, specFor, type ImageSpec } from "@/lib/image-spec";

/**
 * Turning whatever a clinic uploaded into the image we actually store.
 *
 * Everything here is an adjustment rather than a check: the orientation an
 * iPhone recorded in EXIF is baked into the pixels, the size is brought down
 * to what the screen it appears on needs, and the format becomes WebP (or PNG
 * where transparency matters). The one refusal is an image with too few
 * pixels to make something acceptable from.
 *
 * Location metadata is stripped as a consequence of re-encoding: sharp drops
 * EXIF, GPS, XMP and IPTC unless asked to keep them, so the rule for this
 * file is simply that `.withMetadata()` and `.keepExif()` are never called.
 * tests/image-pipeline.test.ts asserts the output carries none, rather than
 * trusting that rule to survive editing.
 */

/**
 * Roughly a 50 megapixel ceiling — above any real camera, below the point
 * where decoding is a denial of service. sharp's own default is ~268MP, which
 * at 4 bytes a pixel is a gigabyte of working memory per request.
 */
const MAX_INPUT_PIXELS = 50_000_000;

const READ_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "truncated" as const };

export interface ProcessedImage {
  buffer: Buffer;
  ext: string;
  mime: string;
  width: number;
  height: number;
}

export interface ProcessOptions {
  purpose?: string | null;
  /** Which of the spec's aspect ratios the clinic cropped to, if any. */
  aspect?: number;
  /** The clinic's own colour, for the app icon's canvas. */
  brandColor?: string | null;
}

/** The dimensions the image will have once its EXIF orientation is applied. */
function uprightSize(meta: sharp.Metadata): { width: number; height: number } {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  // Orientations 5–8 are the quarter turns; everything else keeps its axes.
  const turned = (meta.orientation ?? 1) >= 5;
  return turned ? { width: height, height: width } : { width, height };
}

function tooSmall(spec: ImageSpec, width: number, height: number): UploadError | null {
  if (width >= spec.min.width && height >= spec.min.height) return null;
  return new UploadError(
    "tooSmall",
    `${spec.label} need to be at least ${spec.min.width}×${spec.min.height} pixels. This one is ${width}×${height}.`,
    { minWidth: spec.min.width, minHeight: spec.min.height, width, height, label: spec.label },
  );
}

/** sharp's failures, as something the browser can translate. */
function asImageError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/pixel|limitInputPixels/i.test(message)) {
    return new UploadError("tooComplex", "That image has too many pixels to process. Export it at a smaller size and try again.");
  }
  return new UploadError("corrupt", "That file isn't an image we can read. It may be damaged or only partly uploaded.");
}

export async function processImage(buffer: Buffer, options: ProcessOptions = {}): Promise<ProcessedImage> {
  const spec = specFor(options.purpose);

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, READ_OPTIONS).metadata();
  } catch (err) {
    throw asImageError(err);
  }

  const { width, height } = uprightSize(meta);
  if (!width || !height) throw new UploadError("corrupt", "That file isn't an image we can read.");

  const problem = tooSmall(spec, width, height);
  if (problem) throw problem;

  try {
    // .rotate() with no argument applies the EXIF Orientation tag and drops
    // it; given an angle it would ignore EXIF instead. It has to come before
    // .resize(), or a portrait photo is resized against swapped axes.
    const pipeline = sharp(buffer, READ_OPTIONS).rotate();

    if (options.purpose === "app-icon") {
      const { fit, background } = iconCanvas(width, height, options.brandColor ?? null);
      const size = "width" in spec.output ? spec.output.width : 1024;
      const out = await pipeline
        .resize(size, size, { fit, background })
        // iOS shows transparency as black, so it is flattened onto the same
        // canvas the artwork was fitted to rather than left to the device.
        .flatten({ background })
        .png()
        .toBuffer({ resolveWithObject: true });
      return { buffer: out.data, ext: ".png", mime: "image/png", width: out.info.width, height: out.info.height };
    }

    const target = outputSize(spec, options.aspect);
    const resized =
      "maxEdge" in target
        ? pipeline.resize(target.maxEdge, target.maxEdge, { fit: "inside", withoutEnlargement: true })
        : pipeline.resize(target.width, target.height, { fit: "cover", position: "centre" });

    // A logo keeps its transparency; a photograph has none to keep, and WebP
    // is a third of the bytes at a quality nobody can tell apart.
    const keepAlpha = spec.format === "png" || (spec.format === "alphaAware" && Boolean(meta.hasAlpha));
    const out = keepAlpha
      ? await resized.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await resized.webp({ quality: spec.quality }).toBuffer({ resolveWithObject: true });

    return {
      buffer: out.data,
      ext: keepAlpha ? ".png" : ".webp",
      mime: keepAlpha ? "image/png" : "image/webp",
      width: out.info.width,
      height: out.info.height,
    };
  } catch (err) {
    throw asImageError(err);
  }
}
