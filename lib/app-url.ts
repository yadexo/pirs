/** Public base URL of this deployment, without a trailing slash. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Where the client app lives for clients. CLIENT_APP_URL is the short root
 * domain (https://pirs.io), which serves a clinic at /<slug>. Without it —
 * local development — the app is served from this deployment under /app.
 */
export function clientAppUrl(slug: string): string {
  const root = process.env.CLIENT_APP_URL?.replace(/\/+$/, "");
  return root ? `${root}/${encodeURIComponent(slug)}` : `${appUrl()}/app/${encodeURIComponent(slug)}`;
}

/** The link a clinic prints on posters and shares: opens its app and offers sign-up. */
export function clinicJoinUrl(slug: string): string {
  return `${clientAppUrl(slug)}?join=1`;
}
