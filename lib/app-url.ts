/** Public base URL of this deployment, without a trailing slash. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * The origin a client's own links belong on: the client host, which is the
 * one the installed app's scope covers. A link to the portal host would open
 * outside that scope, in Safari with an address bar, on a host whose session
 * cookie is not the client's.
 *
 * For the app's shared routes — /set-password, /forgot-password — which are
 * served on every host. A clinic's own app is clientAppUrl(slug) below.
 *
 * `||`, not `??`: CLIENT_APP_URL is set to an empty string in development
 * and in the staging environment, where one host serves everything.
 */
export function clientAppOrigin(): string {
  return process.env.CLIENT_APP_URL?.replace(/\/+$/, "") || appUrl();
}

/**
 * Where the client app lives for clients. CLIENT_APP_URL is the client host
 * (https://login.deza.ai), which serves a clinic at /<slug>. Without it —
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
