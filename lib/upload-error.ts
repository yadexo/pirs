/**
 * A refusal an upload can report, as a stable code rather than a sentence.
 *
 * Its own module, like lib/action-error.ts, so the storage layer and the
 * image pipeline can refuse something without importing the action layer.
 *
 * The code — not the message — is what crosses the wire. /api/uploads is a
 * plain route handler with no reliable request locale, so translating there
 * would mean threading a locale through and keeping a second copy of the
 * copy. The browser maps the code to a translated key instead
 * (components/merchant/form.tsx), and the English `message` stays for the
 * server log and for anything reading the response without a translator.
 */

/**
 * Every refusal, and the message key the browser shows for it. Kept here
 * rather than only in the component so a new code cannot be added without a
 * sentence for it in both locales — tests/upload-error-messages.test.ts ties
 * the three together.
 */
export const UPLOAD_ERROR_KEYS = {
  imageTooLarge: "errUploadTooLarge",
  heicUnsupported: "errUploadHeic",
  unsupportedType: "errUploadUnsupported",
  corrupt: "errUploadCorrupt",
  tooSmall: "errUploadTooSmall",
  tooComplex: "errUploadTooComplex",
  rateLimited: "errUploadRateLimited",
  notAllowed: "errUploadNotAllowed",
  storageMisconfigured: "errUploadStorage",
  network: "errUploadNetwork",
  unknown: "errUploadUnknown",
} as const satisfies Record<UploadErrorCode, string>;

export type UploadErrorCode =
  /** Bigger than we accept, before or after the browser's own downscale. */
  | "imageTooLarge"
  /** An iPhone HEIC this browser could not convert — see lib/client-image.ts. */
  | "heicUnsupported"
  /** Not one of the image types we accept (or an SVG, which we never accept). */
  | "unsupportedType"
  /** Empty, truncated, or not decodable as the type its bytes claim. */
  | "corrupt"
  /** Below the minimum this kind of image needs to look acceptable. */
  | "tooSmall"
  /** So many pixels that decoding it would be a denial of service. */
  | "tooComplex"
  | "rateLimited"
  | "notAllowed"
  /** Our side: storage is misconfigured or refused the write. */
  | "storageMisconfigured"
  /** Browser-side only: the request never completed. */
  | "network"
  | "unknown";

/**
 * What each code means as an HTTP status. `storageMisconfigured` is a 500 on
 * purpose: it is our deployment being wrong, and reporting it as a 400 made a
 * platform misconfiguration look like the clinic uploading a bad file.
 */
const STATUS: Record<UploadErrorCode, number> = {
  imageTooLarge: 413,
  heicUnsupported: 400,
  unsupportedType: 400,
  corrupt: 400,
  tooSmall: 400,
  tooComplex: 400,
  rateLimited: 429,
  notAllowed: 403,
  storageMisconfigured: 500,
  network: 400,
  unknown: 400,
};

export class UploadError extends Error {
  readonly code: UploadErrorCode;
  /** Values the translated message interpolates, e.g. the minimum size. */
  readonly params?: Record<string, string | number>;

  constructor(code: UploadErrorCode, message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.params = params;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** Anything thrown during an upload, as something the browser can translate. */
export function asUploadError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;
  return new UploadError("unknown", err instanceof Error ? err.message : "Upload failed.");
}
