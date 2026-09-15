/** Public base URL of this deployment, without a trailing slash. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** The link a clinic prints on posters and shares: opens its app and offers sign-up. */
export function clinicJoinUrl(slug: string): string {
  return `${appUrl()}/app/${encodeURIComponent(slug)}?join=1`;
}
