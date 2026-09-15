/**
 * What to tell someone when calling a server action threw instead of
 * returning. The usual causes are a lost connection, or a tab opened before
 * the app was updated — its buttons point at code that no longer exists, and
 * only a reload fixes that.
 */
export function describeActionFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/Server Action/i.test(message)) return "This page is out of date because the app was updated. Reload the page and try again.";
  return "Couldn't reach the server. Check your connection and try again.";
}
