import { NextResponse } from "next/server";
import { clientAppPathsFor, getPublicClinic, shortAppName } from "@/lib/public-clinic";

/**
 * Each clinic's app installs as its own home-screen app: its name, its scope,
 * and the icon the clinic uploaded.
 */
export async function GET(req: Request, { params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const clinic = await getPublicClinic(merchantSlug);
  if (!clinic) return new NextResponse("Not found", { status: 404 });

  const { base, scope } = clientAppPathsFor(clinic.slug, new Headers(req.headers));
  const icon = (file: string) => `${base}/app-icon/${file}?v=${clinic.version}`;
  // These two are URLs, not prefixes. On the clinic's own domain the base is
  // "" — right for building "/shop", wrong here: an empty start_url resolves
  // to the manifest's own address, so the installed app would open on the
  // manifest instead of the clinic's home.
  const home = base || "/";
  const manifest = {
    id: home,
    name: clinic.name,
    short_name: shortAppName(clinic.name),
    start_url: home,
    scope,
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#f4f5f7",
    icons: [
      { src: icon("192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon("512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon("maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: icon("1024.png"), sizes: "1024x1024", type: "image/png", purpose: "any" },
    ],
  };
  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300" },
  });
}
