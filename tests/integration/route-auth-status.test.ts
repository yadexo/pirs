/**
 * Route handlers answer "not signed in" with 401, not a server error.
 *
 * docs/security/review-2026-11-pass2.md, R-4: without a session,
 * GET /api/items/<id> and GET /api/push threw UnauthorizedError out of the
 * handler and answered 500, logging a stack trace per request. That buries
 * real errors in the logs and alerting.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));

const rbac = vi.hoisted(() => ({ fail: "unauthorized" as "unauthorized" | "forbidden" }));
vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return {
    ...actual,
    requireCustomerContext: async () => {
      throw rbac.fail === "unauthorized" ? new actual.UnauthorizedError("Not signed in") : new actual.ForbiddenError("Not allowed");
    },
  };
});

const items = await import("@/app/api/items/[itemId]/route");
const push = await import("@/app/api/push/route");

describe("route handlers without a session", () => {
  it("answer 401 when nobody is signed in", async () => {
    rbac.fail = "unauthorized";
    const a = await items.GET(new Request("http://localhost/api/items/x"), { params: Promise.resolve({ itemId: "x" }) });
    const b = await push.GET();
    const c = await push.POST(new Request("http://localhost/api/push", { method: "POST", body: "{}" }));
    expect([a.status, b.status, c.status]).toEqual([401, 401, 401]);
  });

  it("answer 403 when the signed-in account may not use them", async () => {
    rbac.fail = "forbidden";
    const res = await push.GET();
    expect(res.status).toBe(403);
  });
});
