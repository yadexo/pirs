/**
 * /login used to pick one account for an address with no ordering asked for,
 * so which sign-in it used — staff or client — was the database's choice. An
 * admin whose address was also a client account could be sent to the client
 * door and fail with the right password.
 *
 * Now the door decides: the page sets it from the host (lib/portal-scope.ts),
 * and the action only ever looks at accounts of that door's kind. This covers
 * the action end of that — which session it asks for, and where it sends
 * someone afterwards.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));
// The real ones start NextAuth, which this is not about.
const signInMock = vi.hoisted(() => vi.fn(async () => undefined));
const clientSignInMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/auth", () => ({ signIn: signInMock }));
vi.mock("@/client-auth", () => ({ clientSignIn: clientSignInMock }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key, getLocale: async () => "en" }));

const { unifiedSignInAction } = await import("@/lib/actions/auth");

describe("signing in at a door, with one address on several accounts", () => {
  const stamp = Date.now();
  const everything = `sma-all-${stamp}@example.com`;
  const twoClinics = `sma-two-${stamp}@example.com`;
  let tenantId: string;
  let otherTenantId: string;
  const slug = `sma-${stamp}`;
  const otherSlug = `sma-other-${stamp}`;

  /** A /login post from a given door. */
  const submit = (email: string, portal: string, next?: string) => {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", "whatever-1234");
    fd.set("portal", portal);
    if (next) fd.set("next", next);
    return unifiedSignInAction(undefined, fd);
  };

  /** Which session was asked for, and with what credentials and destination. */
  const asked = () => {
    const staff = signInMock.mock.calls.map((c) => ({ audience: "staff", args: c as unknown[] }));
    const client = clientSignInMock.mock.calls.map((c) => ({ audience: "client", args: c as unknown[] }));
    const all = [...staff, ...client];
    expect(all).toHaveLength(1);
    const [, options] = all[0]!.args as [string, Record<string, string>];
    return { audience: all[0]!.audience, portal: options.portal, tenantSlug: options.tenantSlug, redirectTo: options.redirectTo };
  };

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Multiple Accounts Clinic" } })).id;
    otherTenantId = (await rawDb.tenant.create({ data: { slug: otherSlug, name: "Multiple Accounts Other" } })).id;
    const passwordHash = await hashPassword("a-password-1234");
    // One address, three kinds of account. The client is at the other clinic:
    // User's @@unique([tenantId, email]) forbids two at one clinic.
    await rawDb.user.create({ data: { email: everything, passwordHash, role: "PLATFORM_ADMIN" } });
    await rawDb.user.create({ data: { tenantId, email: everything, passwordHash, role: "TENANT_ADMIN" } });
    await rawDb.user.create({ data: { tenantId: otherTenantId, email: everything, passwordHash, role: "CUSTOMER" } });
    // The same owner address at two clinics: still no way to choose.
    await rawDb.user.create({ data: { tenantId, email: twoClinics, passwordHash, role: "TENANT_ADMIN" } });
    await rawDb.user.create({ data: { tenantId: otherTenantId, email: twoClinics, passwordHash, role: "TENANT_ADMIN" } });
  });

  afterAll(async () => {
    await rawDb.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await deleteTenantCompletely(tenantId);
    await deleteTenantCompletely(otherTenantId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    signInMock.mockClear();
    clientSignInMock.mockClear();
  });

  it("asks for the staff session at the admin door, and lands on /agency", async () => {
    await submit(everything, "admin", "/agency");
    expect(asked()).toMatchObject({ audience: "staff", portal: "admin", redirectTo: "/agency" });
  });

  it("asks for the staff session at the clinic door, and lands on that clinic", async () => {
    await submit(everything, "clinic");
    expect(asked()).toMatchObject({ audience: "staff", portal: "clinic", redirectTo: `/m/${tenantId}` });
  });

  it("asks for the client session at a client door, carrying the clinic", async () => {
    await submit(everything, "customer", `/app/${otherSlug}`);
    expect(asked()).toMatchObject({ audience: "client", portal: "customer", tenantSlug: otherSlug, redirectTo: `/app/${otherSlug}` });
  });

  it("never asks for the client session at a staff door, however many client accounts share the address", async () => {
    for (const portal of ["admin", "clinic", "staff"]) {
      signInMock.mockClear();
      clientSignInMock.mockClear();
      await submit(everything, portal);
      expect(clientSignInMock).not.toHaveBeenCalled();
      expect(signInMock).toHaveBeenCalledTimes(1);
    }
  });

  it("is not talked into a client door without a clinic — that is the staff door", async () => {
    await submit(everything, "customer");
    expect(asked()).toMatchObject({ audience: "staff", portal: "staff" });
  });

  it("ignores a door it does not recognise and uses the staff one", async () => {
    // A page left open across the deploy that renamed the doors.
    await submit(everything, "unified");
    expect(asked()).toMatchObject({ audience: "staff", portal: "staff" });
  });

  it("still attempts the sign-in for an address on two clinics, so the answer gives nothing away", async () => {
    await submit(twoClinics, "clinic");
    // No destination is guessed: authorizeCredentials refuses it as ambiguous.
    expect(asked()).toMatchObject({ audience: "staff", portal: "clinic", redirectTo: "/login" });
  });

  it("attempts the sign-in for an address with no account at all, the same way", async () => {
    await submit(`sma-nobody-${stamp}@example.com`, "admin");
    expect(asked()).toMatchObject({ audience: "staff", portal: "admin", redirectTo: "/agency" });
  });

  it("writes no [signin] line of its own — the credentials step owns that", async () => {
    const out: string[] = [];
    const record = (...args: unknown[]) => String(args[0]).startsWith("[signin]") && out.push(String(args[0]));
    vi.spyOn(console, "warn").mockImplementation(record);
    vi.spyOn(console, "info").mockImplementation(record);
    await submit(everything, "admin");
    await submit(twoClinics, "clinic");
    expect(out).toEqual([]);
  });
});
