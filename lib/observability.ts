/**
 * Server error reporting with no SDK. Next.js calls `onRequestError` (see
 * instrumentation.ts) for every unhandled error in a route, page, action or
 * middleware; this turns it into one structured log line and, if configured,
 * forwards the same report to Sentry and/or a generic webhook.
 *
 * Why not the Sentry SDK: bundling it for the Edge runtime took production
 * builds from under a minute to over ten on this project. Sentry still gets
 * the error — `sendToSentry` below talks to Sentry's own ingest API
 * directly, as one small POST, which is all this needs: Sentry accepts a
 * plain HTTP envelope from anything that can build one, no SDK required.
 * ERROR_WEBHOOK_URL still works too, for anything else that wants the same
 * JSON (Better Stack, Axiom, Slack, a log drain).
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

  await Promise.all([sendToSentry(report, env.SENTRY_DSN), sendToWebhook(report, env.ERROR_WEBHOOK_URL)]);
}

async function sendToWebhook(report: ErrorReport, url: string | undefined): Promise<void> {
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

interface SentryTarget {
  /** Where the envelope POSTs to: https://<host>/api/<projectId>/envelope/ */
  ingestUrl: string;
  publicKey: string;
  /** The DSN as given — the envelope's own header field wants it verbatim, not reconstructed. */
  dsn: string;
}

/**
 * A Sentry DSN, as copied from Project Settings → Client Keys, looks like
 * `https://<public key>@<host>/<project id>` (self-hosted Sentry may add a
 * path prefix before the project id — handled by taking the last segment).
 * Returns null for anything that isn't a well-formed DSN, so a typo disables
 * Sentry reporting rather than crashing the app that's trying to report an
 * unrelated error.
 */
export function parseSentryDsn(dsn: string | undefined): SentryTarget | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.split("/").filter(Boolean).pop();
    if (!publicKey || !projectId) return null;
    return { ingestUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`, publicKey, dsn };
  } catch {
    return null;
  }
}

/**
 * Builds a minimal Sentry envelope — two JSON lines, newline-separated — for
 * one message-level event. Not the full exception/stacktrace-frame shape the
 * SDK sends (that needs parsing the stack into {filename, lineno, function}
 * frames, which buys grouping quality the SDK gives for free); Sentry still
 * accepts and displays this, searchable by message, route and environment,
 * which is what "did this error happen, and where" needs.
 */
export function buildSentryEnvelope(report: ErrorReport, target: SentryTarget): string {
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const header = { event_id: eventId, sent_at: report.timestamp, dsn: target.dsn };
  const item = { type: "event" };
  const event = {
    event_id: eventId,
    timestamp: report.timestamp,
    platform: "node",
    level: report.level,
    environment: report.environment,
    message: { formatted: `${report.name}: ${report.message}` },
    extra: { stack: report.stack, digest: report.digest },
    tags: { route: report.routePath ?? report.path, routeType: report.routeType, method: report.method },
  };
  return [JSON.stringify(header), JSON.stringify(item), JSON.stringify(event)].join("\n");
}

async function sendToSentry(report: ErrorReport, dsn: string | undefined): Promise<void> {
  const target = parseSentryDsn(dsn);
  if (!target) return;
  try {
    await fetch(target.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=pirs-observability/1.0, sentry_key=${target.publicKey}`,
      },
      body: buildSentryEnvelope(report, target),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The log line in reportError is the fallback record.
  }
}
