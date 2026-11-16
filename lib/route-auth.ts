import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/rbac";

/**
 * Wraps a route handler so "not signed in" answers 401 and "not allowed"
 * answers 403, instead of escaping as a 500 with a stack trace in the logs
 * (docs/security/review-2026-11-pass2.md, R-4). Anything else is left to fail
 * as it would have.
 */
export function withAuthErrors<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
      if (err instanceof ForbiddenError) return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
      throw err;
    }
  };
}
