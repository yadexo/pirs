import { buildErrorReport, reportError } from "@/lib/observability";

/** Called by Next.js for unhandled server errors. See lib/observability.ts. */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
) {
  await reportError(buildErrorReport(error, request, context));
}
