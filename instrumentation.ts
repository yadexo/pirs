import { authUrlWarning } from "@/lib/auth-url-warning";
import { emailConfigWarning } from "@/lib/email-config-warning";
import { buildErrorReport, reportError } from "@/lib/observability";

/** Called by Next.js for unhandled server errors. See lib/observability.ts. */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
) {
  await reportError(buildErrorReport(error, request, context));
}

/**
 * Once at startup. The server and the middleware each start their own
 * runtime; only the Node one speaks, so it is said once rather than twice.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const warning = authUrlWarning();
  if (warning) console.warn(warning);
  // Email that cannot go out otherwise stays silent until someone asks for a
  // password reset and nothing arrives (lib/email-config-warning.ts).
  const email = emailConfigWarning();
  if (email) (email.level === "error" ? console.error : console.warn)(email.message);
}
