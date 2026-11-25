/**
 * A client who opens an email link while signed out lands on the sign-in
 * screen, and after signing in should be where the link pointed (for example
 * "my items"), not on the app's home. The forms also keep what was typed
 * when the server says no (QA report, item 6 of fix round 1).
 *
 * `next` is form input, so only a path inside this clinic's own app is
 * honoured; anything else falls back to the app's home.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { clientNext } from "@/lib/login-destination";
import { clientBasePath } from "@/lib/public-clinic";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/providers/notifications", () => ({
  getEmailProvider: () => ({ send: async () => ({ status: "SENT" }) }),
}));
const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.77", host: "login.deza.ai" }),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const { customerSignInAction, customerRegisterAction } = await import("@/lib/actions/auth");

const PASSWORD = "next-Password-123!";

describe("clientNext", () => {
  it("keeps a path inside the clinic's app and refuses everything else", () => {
    expect(clientNext("/app/riverside", "/app/riverside/profile?tab=items")).toBe("/app/riverside/profile?tab=items");
    expect(clientNext("/app/riverside", "/app/riverside?join=1")).toBe("/app/riverside?join=1");
    expect(clientNext("/app/riverside", "/app/riverside")).toBe("/app/riverside");
    expect(clientNext("/app/riverside", "/app/riversidex/profile")).toBe("/app/riverside");
    expect(clientNext("/app/riverside", "/app/other/profile")).toBe("/app/riverside");
    expect(clientNext("/app/riverside", "/m/abc")).toBe("/app/riverside");
    expect(clientNext("/app/riverside", "//evil.example/app/riverside")).toBe("/app/riverside");
    expect(clientNext("/app/riverside", "https://evil.example")).toBe("/app/riverside");
    expect(clientNext("/app/riverside", "")).toBe("/app/riverside");
    expect(clientNext("/app/riverside", null)).toBe("/app/riverside");
    // On a clinic's own domain the base is "" and the whole host is the app.
    expect(clientNext("", "/profile?tab=items")).toBe("/profile?tab=items");
    expect(clientNext("", "//evil.example")).toBe("/");
  });
});

describe("signing in from an email link", () => {
  const stamp = Date.now();
  const slug = `next-${stamp}`;
  const email = `next-client-${stamp}@example.com`;
  /** Where this clinic's app lives on the host the mocked request came in on. */
  const base = clientBasePath(slug, "login.deza.ai");
  let tenantId: string;

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Next Clinic" } })).id;
    await rawDb.user.create({ data: { tenantId, email, passwordHash: await hashPassword(PASSWORD), role: "CUSTOMER" } });
  });
  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });
  beforeEach(() => clientAuthMock.clientSignIn.mockReset());

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const redirectTo = () => (clientAuthMock.clientSignIn.mock.calls[0]?.[1] as { redirectTo?: string } | undefined)?.redirectTo;

  it("sign-in goes to the page the link pointed at", async () => {
    await customerSignInAction(slug, undefined, form({ email, password: PASSWORD, next: `${base}/profile?tab=items` }));
    expect(redirectTo()).toBe(`${base}/profile?tab=items`);
  });

  it("sign-in never leaves the clinic's app", async () => {
    await customerSignInAction(slug, undefined, form({ email, password: PASSWORD, next: "/agency" }));
    expect(redirectTo()).toBe(base);
  });

  it("sign-up goes there too", async () => {
    await customerRegisterAction(
      slug,
      undefined,
      form({ firstName: "Nora", lastName: "Next", email: `next-new-${stamp}@example.com`, password: PASSWORD, next: `${base}/profile?tab=items` }),
    );
    expect(redirectTo()).toBe(`${base}/profile?tab=items`);
  });
});

describe("the sign-in and sign-up forms", () => {
  const source = readFileSync("app/app/[merchantSlug]/onboarding.tsx", "utf8");

  it("send where the client was", () => {
    expect(source.match(/<input type="hidden" name="next"/g)?.length).toBe(2);
  });

  it("keep what was typed when the server says no", () => {
    // React resets an uncontrolled form after its action runs; controlled
    // inputs keep their values.
    for (const name of ["email", "password", "firstName", "lastName"]) {
      for (const input of source.match(new RegExp(`<input name="${name}"[^>]*>`, "g")) ?? []) {
        expect(input, name).toMatch(/value=\{/);
      }
    }
  });
});
