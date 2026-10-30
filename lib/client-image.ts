import { specFor } from "@/lib/image-spec";
import type { UploadErrorCode } from "@/lib/upload-error";

/**
 * Preparing a picked file in the browser, before it is uploaded.
 *
 * This exists for two reasons that happen to have one answer.
 *
 * The platform refuses a request body over about 4.5MB before our route ever
 * runs, which is how a perfectly ordinary 12 megapixel photo used to fail
 * with nothing but "Upload failed." And the sharp build we deploy has libheif
 * compiled for AVIF only, so it cannot decode an iPhone's HEIC at all.
 *
 * Decoding and re-encoding here solves both: a 15MB HEIC becomes a ~1MB WebP
 * that the server can read. Safari on iOS and macOS decodes HEIC natively,
 * which is exactly where HEIC comes from, so the conversion costs nothing on
 * the devices that need it.
 *
 * None of this is trusted by the server, which sniffs, decodes and resizes
 * again — this is about getting the bytes there, not about being believed.
 */

/** Stay under the platform ceiling with room for the multipart envelope. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
/** Decoding more than this would hang the tab before it ever reached us. */
const MAX_SOURCE_PIXELS = 80_000_000;

const QUALITY_STEPS = [0.85, 0.75, 0.65];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreparedImage {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

export class ClientImageError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    readonly params?: Record<string, string | number>,
  ) {
    super(code);
    this.name = "ClientImageError";
  }
}

const isHeic = (file: File) => /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type);

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/**
 * `createImageBitmap` is the only decode that is explicit about EXIF
 * orientation. Where it is missing or refuses the type, an <img> still
 * applies orientation itself (`image-orientation: from-image` is the CSS
 * initial value), and the server re-applies it regardless — so a sideways
 * photo would have to get past both to reach a client.
 */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through: Safari before 16.4 has no options argument, and no
      // browser but Safari can decode HEIC at all.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    // A HEIC here means a browser that cannot decode one — tell the clinic
    // what to do about it rather than calling their photo unsupported.
    throw new ClientImageError(isHeic(file) ? "heicUnsupported" : "corrupt");
  }
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ClientImageError("unknown");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

/**
 * Drawing a 4032px photo straight down to 1200 drops three pixels in four and
 * aliases visibly, so anything under half size is halved repeatedly first.
 */
function drawDownscaled(decoded: Decoded, crop: CropRect, targetWidth: number, targetHeight: number): HTMLCanvasElement {
  let { canvas, ctx } = canvasOf(crop.width, crop.height);
  ctx.drawImage(decoded.source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);

  while (canvas.width / 2 > targetWidth) {
    const next = canvasOf(canvas.width / 2, canvas.height / 2);
    next.ctx.drawImage(canvas, 0, 0, next.canvas.width, next.canvas.height);
    canvas = next.canvas;
    ctx = next.ctx;
  }

  if (canvas.width === targetWidth && canvas.height === targetHeight) return canvas;
  const out = canvasOf(targetWidth, targetHeight);
  out.ctx.drawImage(canvas, 0, 0, out.canvas.width, out.canvas.height);
  return out.canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Whether any pixel is see-through, sampled rather than scanned. */
function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 32));
  try {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        if (data[(y * canvas.width + x) * 4 + 3]! < 255) return true;
      }
    }
  } catch {
    // A tainted canvas can't be read; assume opaque rather than failing.
  }
  return false;
}

/**
 * Encodes small enough to send. Quality comes down first, because a slightly
 * softer photo is a better outcome than a refusal, and only then does the
 * image get smaller.
 */
async function encodeUnderLimit(canvas: HTMLCanvasElement, keepAlpha: boolean): Promise<{ blob: Blob; ext: string }> {
  const attempt = async (c: HTMLCanvasElement): Promise<{ blob: Blob; ext: string } | null> => {
    for (const quality of QUALITY_STEPS) {
      const webp = await toBlob(c, "image/webp", quality);
      // Safari used to answer a WebP request with a PNG, silently.
      if (webp && webp.type === "image/webp" && webp.size <= MAX_UPLOAD_BYTES) return { blob: webp, ext: ".webp" };

      const fallbackType = keepAlpha ? "image/png" : "image/jpeg";
      const other = await toBlob(c, fallbackType, quality);
      if (other && other.size <= MAX_UPLOAD_BYTES) return { blob: other, ext: keepAlpha ? ".png" : ".jpg" };
    }
    return null;
  };

  const first = await attempt(canvas);
  if (first) return first;

  const smaller = canvasOf(canvas.width / 2, canvas.height / 2);
  smaller.ctx.drawImage(canvas, 0, 0, smaller.canvas.width, smaller.canvas.height);
  const second = await attempt(smaller.canvas);
  if (second) return second;

  throw new ClientImageError("imageTooLarge");
}

/**
 * The crop a purpose wants, centred, when the clinic has not chosen one.
 */
export function defaultCrop(width: number, height: number, aspect?: number): CropRect {
  if (!aspect) return { x: 0, y: 0, width, height };
  const current = width / height;
  if (Math.abs(current - aspect) < 0.001) return { x: 0, y: 0, width, height };
  if (current > aspect) {
    const w = Math.round(height * aspect);
    return { x: Math.round((width - w) / 2), y: 0, width: w, height };
  }
  const h = Math.round(width / aspect);
  return { x: 0, y: Math.round((height - h) / 2), width, height: h };
}

export async function prepareForUpload(file: File, purpose?: string | null, options: { crop?: CropRect; aspect?: number } = {}): Promise<PreparedImage> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ClientImageError("imageTooLarge", { max: MAX_SOURCE_BYTES / 1024 / 1024, size: Math.round(file.size / 1024 / 1024) });
  }

  const spec = specFor(purpose);
  const decoded = await decode(file);

  try {
    if (decoded.width * decoded.height > MAX_SOURCE_PIXELS) throw new ClientImageError("tooComplex");
    if (!decoded.width || !decoded.height) throw new ClientImageError("corrupt");

    const aspect = options.aspect ?? spec.aspects[0];
    const crop = options.crop ?? defaultCrop(decoded.width, decoded.height, aspect);

    // Never upscale here: the server has the spec and can do it once, from
    // the best pixels available, rather than twice from invented ones.
    const scale = Math.min(1, spec.clientMaxEdge / Math.max(crop.width, crop.height));
    const canvas = drawDownscaled(decoded, crop, Math.round(crop.width * scale), Math.round(crop.height * scale));

    const keepAlpha = spec.format !== "webp" && hasTransparency(canvas);
    const { blob, ext } = await encodeUnderLimit(canvas, keepAlpha);

    return {
      blob,
      filename: file.name.replace(/\.[^.]+$/, "") + ext,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    decoded.release();
  }
}
