/**
 * Server error reporting with no SDK. Next.js calls `onRequestError` (see
 * instrumentation.ts) for every unhandled error in a route, page, action or
 * middleware; this turns it into one structured log line and, if
 * ERROR_WEBHOOK_URL is set, forwards the same JSON to an alerting service.
 *
 * Why not the Sentry SDK: bundling it for the Edge runtime took production
 * builds from under a minute to over ten on this project. Any log drain or
 * incident tool that accepts JSON (Better Stack, Axiom, Slack, a Sentry
 * webhook relay) can consume this instead.
 *
 * This platform holds clinic and client data, so a report carries only what
 * is needed to fix a bug — error, stack, route, method. Never headers,
 * cookies, bodies, query strings or user identity.
 */

export interface ErrorReport {
  level: "error";
  message: string;
  name: string;
  stack?: string;
  digest?: string;
  method: string;
  path: string;
  routePath?: string;
  routeType?: string;
  environment: string;
  timestamp: string;
}

interface RequestInfo {
  path: string;
  method: string;
}

interface RequestContext {
  routePath?: string;
  routeType?: string;
}

export function buildErrorReport(error: unknown, request: RequestInfo, context: RequestContext = {}, now = new Date()): ErrorReport {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    level: "error",
    message: err.message,
    name: err.name,
    stack: err.stack,
    digest: (err as Error & { digest?: string }).digest,
    method: request.method,
    // The query string can carry tokens and search terms; drop it.
    path: request.path.split("?")[0] ?? request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    timestamp: now.toISOString(),
  };
}

export async function reportError(report: ErrorReport, env: Record<string, string | undefined> = process.env): Promise<void> {
  console.error(JSON.stringify(report));

  const url = env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      // Reporting must never hold up or crash the request it is reporting on.
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The log line above is the fallback record.
  }
}
