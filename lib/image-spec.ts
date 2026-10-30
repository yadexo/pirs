/**
 * What each kind of uploaded image should end up as.
 *
 * One table, read by both sides: the browser uses it to crop and downscale
 * before uploading (lib/client-image.ts), the server uses it to produce the
 * final image (lib/image-pipeline.ts). Deliberately free of both `sharp` and
 * `server-only` so it can be imported into a client component.
 *
 * The rule the table encodes: an image is *adjusted*, not refused. A clinic
 * photographs a product on a phone and gets a 4032×3024 JPEG; that is a fine
 * thing to have uploaded, and making it the right size is our job. The only
 * refusal left is an image with too few pixels to make something acceptable
 * from, and that refusal names the minimum.
 */

export const IMAGE_PURPOSES = ["app-icon", "logo", "product-image", "client-result", "cover-image", "offer-image", "package-image"] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

export interface ImageSpec {
  /** For error messages: "Product images", "The app icon". */
  label: string;
  /**
   * Longest edge the browser downscales to before uploading. Well under
   * Vercel's ~4.5MB request-body ceiling once re-encoded, and still more
   * detail than the server output needs, so the final resize has pixels to
   * work with rather than upscaling what the browser threw away.
   */
  clientMaxEdge: number;
  /** Aspect ratios (width/height) this kind of image comes in; the first is the default. */
  aspects: number[];
  /**
   * Whether the clinic is asked to choose what to keep. A photograph is
   * cropped; an app icon or a logo is fitted whole onto its canvas, because
   * cropping a wordmark to a square cuts the name in half.
   */
  crop: boolean;
  /** A fixed output width when cropped to an aspect, or a cap on the longest edge. */
  output: { width: number } | { maxEdge: number };
  /** "alphaAware" keeps PNG when the image has transparency, and uses WebP when it doesn't. */
  format: "png" | "webp" | "alphaAware";
  quality: number;
  /** The one refusal: below this there are not enough pixels to work with. */
  min: { width: number; height: number };
}

const SPECS: Record<ImagePurpose, ImageSpec> = {
  /**
   * Becomes the home-screen icon of the clinic's installable app. Stored as a
   * 1024 square with the brand canvas already painted in, so the sizes served
   * from /app-icon/<n>.png are a plain downscale of it.
   */
  "app-icon": { label: "The app icon", clientMaxEdge: 2048, aspects: [1], crop: false, output: { width: 1024 }, format: "png", quality: 100, min: { width: 200, height: 200 } },
  /** Keeps its proportions and its transparency — a logo on a coloured header must not arrive with a white box around it. */
  logo: { label: "The logo", clientMaxEdge: 2048, aspects: [], crop: false, output: { maxEdge: 1024 }, format: "alphaAware", quality: 85, min: { width: 64, height: 64 } },
  "product-image": { label: "Product images", clientMaxEdge: 2400, aspects: [4 / 3, 1], crop: true, output: { width: 1200 }, format: "webp", quality: 82, min: { width: 300, height: 300 } },
  /** Before and after photos: never cropped, because the framing is the point of the comparison. */
  "client-result": { label: "Before and after photos", clientMaxEdge: 2400, aspects: [], crop: false, output: { maxEdge: 1600 }, format: "webp", quality: 82, min: { width: 300, height: 300 } },
  "cover-image": { label: "The cover photo", clientMaxEdge: 2400, aspects: [16 / 9], crop: true, output: { width: 1600 }, format: "webp", quality: 82, min: { width: 600, height: 338 } },
  "offer-image": { label: "Offer images", clientMaxEdge: 2400, aspects: [4 / 3], crop: true, output: { width: 1200 }, format: "webp", quality: 82, min: { width: 300, height: 300 } },
  "package-image": { label: "Package images", clientMaxEdge: 2400, aspects: [4 / 3], crop: true, output: { width: 1200 }, format: "webp", quality: 82, min: { width: 300, height: 300 } },
};

/**
 * Anything without a purpose of its own still gets resized. An unknown value
 * falling through to "leave it alone" is how offer and package images ended
 * up being served at whatever size the clinic's camera produced.
 */
const DEFAULT_SPEC: ImageSpec = {
  label: "Images",
  clientMaxEdge: 2000,
  aspects: [],
  crop: false,
  output: { maxEdge: 1600 },
  format: "webp",
  quality: 82,
  min: { width: 64, height: 64 },
};

export function isImagePurpose(value: string): value is ImagePurpose {
  return (IMAGE_PURPOSES as readonly string[]).includes(value);
}

export function specFor(purpose: string | null | undefined): ImageSpec {
  return purpose && isImagePurpose(purpose) ? SPECS[purpose] : DEFAULT_SPEC;
}

/** The output size for a spec, given the aspect the clinic cropped to. */
export function outputSize(spec: ImageSpec, aspect?: number): { width: number; height: number } | { maxEdge: number } {
  if ("maxEdge" in spec.output) return { maxEdge: spec.output.maxEdge };
  const ratio = aspect ?? spec.aspects[0] ?? 1;
  return { width: spec.output.width, height: Math.round(spec.output.width / ratio) };
}
