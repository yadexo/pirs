import { NextResponse } from "next/server";
import { clientBasePath, getPublicClinic, shortAppName } from "@/lib/public-clinic";

/**
 * Each clinic's app installs as its own home-screen app: its name, its scope,
 * and the icon the clinic uploaded.
 */
export async function GET(req: Request, { params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const clinic = await getPublicClinic(merchantSlug);
  if (!clinic) return new NextResponse("Not found", { status: 404 });

  const base = clientBasePath(clinic.slug, req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  const icon = (file: string) => `${base}/app-icon/${file}?v=${clinic.version}`;
  const manifest = {
    id: base,
    name: clinic.name,
    short_name: shortAppName(clinic.name),
    start_url: base,
    scope: `${base}`,
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#f4f5f7",
    icons: [
      { src: icon("192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon("512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon("maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300" },
  });
}
