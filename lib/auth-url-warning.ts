/**
 * AUTH_URL / NEXTAUTH_URL pin Auth.js to one origin. Auth.js then ignores the
 * host a request arrived on: every sign-in, redirect and session check is done
 * as if the request had come to that one address.
 *
 * This app answers on several hosts by design — the client app, the clinic
 * portal, the platform admin, staging, and later a clinic's own domain. With
 * either variable set, a sign-in on any host but the pinned one succeeds, sets
 * its cookie on its own host, and is then redirected to the pinned host, which
 * has no cookie: it looks like the sign-in did nothing.
 *
 * Only warns. Nothing is ignored or changed here. No imports, so it is safe
 * anywhere it might be called.
 */
export function authUrlWarning(env: Record<string, string | undefined> = process.env): string | null {
  const set = (["AUTH_URL", "NEXTAUTH_URL"] as const).filter((name) => env[name]?.trim());
  if (set.length === 0) return null;

  const origins = set.map((name) => {
    try {
      return new URL(env[name]!.trim()).origin;
    } catch {
      return "an unreadable value";
    }
  });
  return (
    `[auth][warn] ${set.join(" and ")} ${set.length > 1 ? "are" : "is"} set (${[...new Set(origins)].join(", ")}). ` +
    "Auth.js uses it instead of the host each request arrives on, so a sign-in on any other host " +
    "(admin, a clinic's own domain, staging) is sent back to that one origin and looks like it did nothing. " +
    "Unset it in the environment and redeploy."
  );
}
