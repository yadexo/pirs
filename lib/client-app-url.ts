import "server-only";

/**
 * The absolute address of a clinic's client app, for a link that means
 * something outside a request — an email, where there is no host header to
 * read from. The short address (pirs.io/<slug>) when CLIENT_APP_URL names
 * one, the long one (APP_URL/app/<slug>) otherwise. Same shape as the links
 * printed inside the app itself (lib/public-clinic.ts's clientBasePath).
 */
export function absoluteClientAppUrl(slug: string, path = ""): string {
  const base = (process.env.CLIENT_APP_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
  const short = Boolean(process.env.CLIENT_APP_URL);
  const rel = `${short ? "" : "/app"}/${encodeURIComponent(slug)}${path}`;
  return base ? `${base}${rel}` : rel;
}
