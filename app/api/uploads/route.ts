import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getStorageProvider } from "@/lib/providers/storage";
import { rateLimit } from "@/lib/rate-limit";
import { ActionError, requireMerchantAction } from "@/lib/merchant-action";

/**
 * Image upload for clinic-portal forms. The clinic is named in the request so
 * an agency admin working inside a clinic can upload too. Uploading on its own
 * changes nothing a client sees — the form that uses the URL is authorised
 * separately — so any clinic user may upload, rate limited per user.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const merchantId = formData.get("merchantId");
  if (typeof merchantId !== "string" || !merchantId) {
    return NextResponse.json({ error: "Missing clinic." }, { status: 400 });
  }

  let userId: string;
  try {
    ({ user: { id: userId } } = await requireMerchantAction(merchantId, "member"));
  } catch (err) {
    const message = err instanceof ActionError ? err.message : "Not allowed.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const { ok } = await rateLimit(`upload:${userId}`, 30, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many uploads. Wait a minute and try again." }, { status: 429 });

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // An app icon becomes the home-screen icon of the clinic's app, which iOS
  // renders up to 180pt at 3x. It has to be square and sharp at that size.
  if (formData.get("purpose") === "app-icon") {
    const problem = await appIconProblem(buffer);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  try {
    const stored = await getStorageProvider().upload({
      buffer,
      filename: file.name,
      mimeType: file.type,
    });
    return NextResponse.json({ url: stored.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

const MIN_APP_ICON_PX = 512;

async function appIconProblem(buffer: Buffer): Promise<string | null> {
  try {
    const { width, height } = await sharp(buffer).metadata();
    if (!width || !height) return "That file isn't an image we can read.";
    if (width !== height) return `App icons must be square. This one is ${width}×${height}.`;
    if (width < MIN_APP_ICON_PX) return `App icons must be at least ${MIN_APP_ICON_PX}×${MIN_APP_ICON_PX} pixels (1024×1024 is best). This one is ${width}×${height}.`;
    return null;
  } catch {
    return "That file isn't an image we can read.";
  }
}
