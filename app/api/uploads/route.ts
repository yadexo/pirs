import { NextRequest, NextResponse } from "next/server";
import { getStorageProvider, sniffImage, MAX_FILE_BYTES } from "@/lib/providers/storage";
import { processImage } from "@/lib/image-pipeline";
import { specFor } from "@/lib/image-spec";
import { rateLimit } from "@/lib/rate-limit";
import { UploadError, asUploadError } from "@/lib/upload-error";
import { ActionError, requireMerchantAction } from "@/lib/merchant-action";

/**
 * Image upload for clinic-portal forms. The clinic is named in the request so
 * an agency admin working inside a clinic can upload too. Uploading on its own
 * changes nothing a client sees — the form that uses the URL is authorised
 * separately — so any clinic user may upload, rate limited per user.
 *
 * The browser has already cropped and downscaled whatever was picked
 * (lib/client-image.ts), both to stay under the platform's request-body
 * ceiling and to convert an iPhone's HEIC. None of that is trusted here: the
 * bytes are sniffed, decoded and resized again, and the dimensions reported
 * back are the ones sharp produced, never the ones the browser claimed.
 */

export const runtime = "nodejs"; // sharp is a native module, not an edge one
export const dynamic = "force-dynamic";
// A 50 megapixel source resized on a cold function is slow but not minutes slow.
export const maxDuration = 30;

/** Headroom over the storage limit for multipart overhead, checked before buffering. */
const MAX_REQUEST_FILE_BYTES = MAX_FILE_BYTES + 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const merchantId = formData.get("merchantId");
    if (typeof merchantId !== "string" || !merchantId) {
      throw new UploadError("notAllowed", "Missing clinic.");
    }

    let userId: string;
    let db: Awaited<ReturnType<typeof requireMerchantAction>>["db"];
    try {
      ({ user: { id: userId }, db } = await requireMerchantAction(merchantId, "member"));
    } catch (err) {
      throw new UploadError("notAllowed", err instanceof ActionError ? err.message : "Not allowed.");
    }

    const { ok } = await rateLimit(`upload:${userId}`, 30, 60 * 1000);
    if (!ok) throw new UploadError("rateLimited", "Too many uploads. Wait a minute and try again.");

    const file = formData.get("file");
    if (!(file instanceof File)) throw new UploadError("corrupt", "No file provided.");
    // Checked before reading the body into memory, so an oversized upload
    // costs us the headers rather than the whole file.
    if (file.size > MAX_REQUEST_FILE_BYTES) {
      throw new UploadError("imageTooLarge", `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // What the bytes are, not what the browser said they are.
    const sniffed = sniffImage(buffer);
    if (!sniffed) throw new UploadError("unsupportedType", "Unsupported file type. Upload a PNG, JPEG, WebP, GIF or AVIF image.");
    if (!sniffed.accepted) {
      throw new UploadError("heicUnsupported", "iPhone HEIC photos can't be converted here. Open this page on your iPhone, or export the photo as JPEG and try again.");
    }

    const purpose = String(formData.get("purpose") ?? "") || null;
    const spec = specFor(purpose);

    // The crop the clinic chose, accepted only if it is one this kind of
    // image actually offers — the output size is ours to decide, not the
    // browser's to ask for.
    const requested = Number(formData.get("aspect"));
    const aspect = spec.aspects.find((a) => Math.abs(a - requested) < 0.01);

    const brandColor =
      purpose === "app-icon" ? (await db.tenantBranding.findFirst({ select: { primaryColor: true } }))?.primaryColor ?? null : null;

    const processed = await processImage(buffer, { purpose, aspect, brandColor });

    const stored = await getStorageProvider().upload({
      buffer: processed.buffer,
      filename: file.name,
      mimeType: processed.mime,
    });

    return NextResponse.json({ url: stored.url, width: processed.width, height: processed.height });
  } catch (err) {
    const error = asUploadError(err);
    // Our own misconfiguration is worth a log line; a clinic picking the
    // wrong file is not.
    if (error.code === "storageMisconfigured" || error.code === "unknown") {
      console.error("[uploads]", error.code, error.message);
    }
    return NextResponse.json({ code: error.code, error: error.message, params: error.params }, { status: error.status });
  }
}
