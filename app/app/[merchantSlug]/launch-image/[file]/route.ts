import { NextResponse } from "next/server";
import { getPublicClinic } from "@/lib/public-clinic";
import { loadIconSource, renderLaunchImage } from "@/lib/app-icon";
import { parseLaunchImageFile } from "@/lib/launch-image-sizes";

export async function GET(_req: Request, { params }: { params: Promise<{ merchantSlug: string; file: string }> }) {
  const { merchantSlug, file } = await params;
  const size = parseLaunchImageFile(file);
  const clinic = size ? await getPublicClinic(merchantSlug) : null;
  if (!size || !clinic) return new NextResponse("Not found", { status: 404 });

  // The launch screen shows the clinic's logo, the same mark as the app's
  // own Home — falling back to the icon only when there is no logo, which is
  // what it used to use for everyone.
  const source = (await loadIconSource(clinic.logoUrl)) ?? (await loadIconSource(clinic.appIconUrl));
  const png = await renderLaunchImage(source, size, { name: clinic.name, color: clinic.color, background: clinic.launchBackground });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // URLs carry ?v=<branding version>, so a changed logo gets a new one.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
