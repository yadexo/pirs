import "server-only";
import { clinicHostForSlug } from "@/lib/clinic-hosts";
import { isClientHost, normaliseHost } from "@/lib/portal-hosts";

/**
 * Where a clinic's app sits on the origin a device subscribed from.
 *
 * A push payload carries a path, and the service worker resolves it against
 * its own origin — so "/shop" is the whole answer on the clinic's own domain,
 * "/riverside/shop" on the shared client host, and "/app/riverside/shop"
 * where no client host is configured. One payload for every device would be
 * right for at most one of them.
 *
 * A null origin is every subscription made before clinics had domains of
 * their own. They were all on the shared host, and that is exactly what a
 * null is read as — no backfill needed.
 */
export async function pushBasePath(origin: string | null | undefined, slug: string): Promise<string> {
  const host = hostOf(origin);

  if (host) {
    // The clinic's own domain: the app is the whole host, so no prefix.
    if ((await clinicHostForSlug(slug)) === host) return "";
    if (isClientHost(host)) return `/${encodeURIComponent(slug)}`;
    // Some other host this deployment answers on — a preview URL, localhost,
    // or the portal host. All of them serve the app under /app.
    return `/app/${encodeURIComponent(slug)}`;
  }

  // No origin recorded. The shared address, by the same rule the rest of the
  // codebase uses when there is no request to read a host from.
  const short = Boolean(process.env.CLIENT_APP_URL);
  return `${short ? "" : "/app"}/${encodeURIComponent(slug)}`;
}

function hostOf(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    return normaliseHost(new URL(origin).hostname) || null;
  } catch {
    return null;
  }
}
