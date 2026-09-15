import { NextResponse } from "next/server";
import sharp from "sharp";
import { rawDb } from "@/lib/db";
import { requireMerchantAction } from "@/lib/merchant-action";
import { clinicJoinUrl } from "@/lib/app-url";
import { qrSvg } from "@/lib/qr";

/** Print-quality PNG of the clinic's app QR code, for posters and the desk. */
export async function GET(_req: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  try {
    await requireMerchantAction(merchantId, "member");
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const tenant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { slug: true } });
  if (!tenant) return new NextResponse("Not found", { status: 404 });

  const png = await sharp(Buffer.from(qrSvg(clinicJoinUrl(tenant.slug))), { density: 600 })
    .resize(1200, 1200, { kernel: "nearest" })
    .png()
    .toBuffer();
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${tenant.slug}-app-qr.png"`,
      "Cache-Control": "private, no-store",
    },
  });
}
