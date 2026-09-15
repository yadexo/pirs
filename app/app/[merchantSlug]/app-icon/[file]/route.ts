import { NextResponse } from "next/server";
import { getPublicClinic } from "@/lib/public-clinic";
import { loadIconSource, parseIconFile, renderAppIcon } from "@/lib/app-icon";

export async function GET(_req: Request, { params }: { params: Promise<{ merchantSlug: string; file: string }> }) {
  const { merchantSlug, file } = await params;
  const variant = parseIconFile(file);
  const clinic = variant ? await getPublicClinic(merchantSlug) : null;
  if (!variant || !clinic) return new NextResponse("Not found", { status: 404 });

  const source = await loadIconSource(clinic.appIconUrl);
  const png = await renderAppIcon(source, variant, { name: clinic.name, color: clinic.color });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // URLs carry ?v=<branding version>, so a changed icon gets a new URL.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
