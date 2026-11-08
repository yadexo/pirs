/**
 * /login picks one account for an address to decide which sign-in to use —
 * staff or client. With no ordering asked for, an address that is on both a
 * platform admin and a client account leaves that choice to the database. The
 * choice is unchanged; what changed is that it is now said out loud in the
 * logs, so an admin who "can't sign in" can be told apart from a wrong password.
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

describe("sign-in by an address that is on several accounts", () => {
  const stamp = Date.now();
  const only = `sma-only-${stamp}@example.com`;
  const both = `sma-both-${stamp}@example.com`;
  const twoStaff = `sma-two-${stamp}@example.com`;
  let tenantId: string;
  let otherTenantId: string;

  const form = (email: string) => {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", "whatever-1234");
    fd.set("next", "/agency");
    return fd;
  };
  async function lines(email: string) {
    const out: string[] = [];
    const record = (...args: unknown[]) => String(args[0]).startsWith("[signin]") && out.push(String(args[0]));
    vi.spyOn(console, "warn").mockImplementation(record);
    vi.spyOn(console, "info").mockImplementation(record);
    await unifiedSignInAction(undefined, form(email));
    return out;
  }

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug: `sma-${stamp}`, name: "Multiple Accounts Clinic" } })).id;
    otherTenantId = (await rawDb.tenant.create({ data: { slug: `sma-other-${stamp}`, name: "Multiple Accounts Other" } })).id;
    const passwordHash = await hashPassword("a-password-1234");
    await rawDb.user.create({ data: { email: only, passwordHash, role: "PLATFORM_ADMIN" } });
    await rawDb.user.create({ data: { email: both, passwordHash, role: "PLATFORM_ADMIN" } });
    await rawDb.user.create({ data: { tenantId, email: both, passwordHash, role: "CUSTOMER" } });
    await rawDb.user.create({ data: { tenantId, email: twoStaff, passwordHash, role: "TENANT_ADMIN" } });
    await rawDb.user.create({ data: { tenantId: otherTenantId, email: twoStaff, passwordHash, role: "TENANT_ADMIN" } });
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

  it("says nothing for an address that is on one account", async () => {
    expect(await lines(only)).toEqual([]);
  });

  it("names the roles when an admin's address is also a client account", async () => {
    expect(await lines(both)).toEqual(["[signin] outcome=multiple_accounts_for_email roles=CUSTOMER+PLATFORM_ADMIN"]);
  });

  it("names the roles when the address is on two clinics", async () => {
    expect(await lines(twoStaff)).toEqual(["[signin] outcome=multiple_accounts_for_email roles=TENANT_ADMIN+TENANT_ADMIN"]);
  });

  it("still signs in through exactly one door, as before", async () => {
    await lines(both);
    expect(signInMock.mock.calls.length + clientSignInMock.mock.calls.length).toBe(1);
  });

  it("an address that is on no account is a plain failure, not a multiple-accounts line", async () => {
    expect(await lines(`sma-nobody-${stamp}@example.com`)).toEqual([]);
  });

  it("never writes the address into the line", async () => {
    const all = [...(await lines(both)), ...(await lines(twoStaff))].join("\n");
    expect(all).not.toContain("@");
    expect(all).not.toContain(String(stamp));
  });
});
