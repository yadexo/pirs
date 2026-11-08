/**
 * A reset link is scoped to the door it was asked from, exactly as sign-in is.
 * One address can be a platform admin, a clinic owner and a client; asking for
 * a reset at the admin login must issue a token for the admin account and
 * leave the other two alone — otherwise the link that arrives signs the person
 * into the wrong place, or into nothing at all.
 *
 * The answer the form gives is always "sent", so what is asserted here is what
 * actually happened in the database and in the logs.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.200" }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key, getLocale: async () => "en" }));
const sent: { to: string }[] = [];
vi.mock("@/lib/providers/notifications", () => ({
  getEmailProvider: () => ({
    send: async (message: { to: string }) => {
      sent.push(message);
      return { status: "SENT" };
    },
  }),
}));

const { requestPasswordResetAction } = await import("@/lib/actions/password");

describe("a password reset is scoped to its door", () => {
  const stamp = Date.now();
  const shared = `prs-shared-${stamp}@example.com`;
  const ownerOnly = `prs-owner-${stamp}@example.com`;
  const twoClinics = `prs-two-${stamp}@example.com`;
  const slug = `prs-${stamp}`;
  const otherSlug = `prs-other-${stamp}`;
  let tenantId: string;
  let otherTenantId: string;
  const ids: Record<string, string> = {};

  const ask = async (email: string, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("email", email);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    // The rate limit is 3 per address per hour, which several cases here would
    // trip; each case clears its own counters first.
    await rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: `reset:email:${email}` }, { key: "reset:ip:203.0.113.200" }] } });
    const lines: string[] = [];
    const record = (...args: unknown[]) => String(args[0]).startsWith("[reset]") && lines.push(String(args[0]));
    vi.spyOn(console, "warn").mockImplementation(record);
    vi.spyOn(console, "info").mockImplementation(record);
    const result = await requestPasswordResetAction(undefined, fd);
    return { result, lines };
  };

  /** Which accounts now hold a live, unused reset token. */
  const tokenHolders = async () => {
    const tokens = await rawDb.passwordResetToken.findMany({ where: { usedAt: null, user: { email: { contains: `-${stamp}@` } } }, select: { userId: true } });
    const names = Object.entries(ids)
      .filter(([, id]) => tokens.some((t) => t.userId === id))
      .map(([name]) => name);
    return names.sort();
  };
  const clearTokens = () => rawDb.passwordResetToken.deleteMany({ where: { user: { email: { contains: `-${stamp}@` } } } });

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Reset Scope Clinic" } })).id;
    otherTenantId = (await rawDb.tenant.create({ data: { slug: otherSlug, name: "Reset Scope Other" } })).id;
    const passwordHash = await hashPassword("a-password-1234");
    const make = async (name: string, data: Record<string, unknown>) => {
      ids[name] = (await rawDb.user.create({ data: { passwordHash, ...data } as never })).id;
    };
    // One address, three kinds of account (the client at the other clinic —
    // User's @@unique([tenantId, email]) forbids two at one clinic).
    await make("admin", { email: shared, role: "PLATFORM_ADMIN" });
    await make("owner", { email: shared, role: "TENANT_ADMIN", tenantId });
    await make("client", { email: shared, role: "CUSTOMER", tenantId: otherTenantId });
    await make("ownerOnly", { email: ownerOnly, role: "TENANT_ADMIN", tenantId });
    // The same owner address at two clinics: nothing to send to.
    await make("twoA", { email: twoClinics, role: "TENANT_ADMIN", tenantId });
    await make("twoB", { email: twoClinics, role: "TENANT_ADMIN", tenantId: otherTenantId });
  });

  afterAll(async () => {
    await clearTokens();
    await rawDb.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await deleteTenantCompletely(tenantId);
    await deleteTenantCompletely(otherTenantId);
    await rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { contains: `-${stamp}@` } }, { key: "reset:ip:203.0.113.200" }] } });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    sent.length = 0;
    await clearTokens();
  });

  it("the admin door resets the platform admin and nothing else", async () => {
    const { result, lines } = await ask(shared, { portal: "admin" });
    expect(result).toEqual({ sent: true });
    expect(await tokenHolders()).toEqual(["admin"]);
    expect(lines).toEqual(["[reset] outcome=sent portal=admin role=PLATFORM_ADMIN"]);
  });

  it("the clinic door resets the clinic account and nothing else", async () => {
    await ask(shared, { portal: "clinic" });
    expect(await tokenHolders()).toEqual(["owner"]);
  });

  it("a clinic's own app resets that clinic's client and nothing else", async () => {
    await ask(shared, { clinic: otherSlug });
    expect(await tokenHolders()).toEqual(["client"]);
  });

  it("a clinic slug wins over any door named beside it", async () => {
    // The clinic slug is what makes a reset a client reset; a portal field
    // alongside it must not be able to redirect that at a staff account.
    await ask(shared, { clinic: otherSlug, portal: "admin" });
    expect(await tokenHolders()).toEqual(["client"]);
  });

  it("sends nothing for a client of a clinic this address is not a client of", async () => {
    const { result, lines } = await ask(shared, { clinic: slug });
    expect(result).toEqual({ sent: true });
    expect(await tokenHolders()).toEqual([]);
    expect(sent).toEqual([]);
    expect(lines).toEqual(["[reset] outcome=no_account_of_type portal=customer"]);
  });

  it("sends nothing at the admin door for an address that is only a clinic owner, and says which it was", async () => {
    const { lines } = await ask(ownerOnly, { portal: "admin" });
    expect(await tokenHolders()).toEqual([]);
    expect(lines).toEqual(["[reset] outcome=no_account_of_type portal=admin"]);
  });

  it("tells an address with no account at all apart in the logs", async () => {
    const { result, lines } = await ask(`prs-nobody-${stamp}@example.com`, { portal: "admin" });
    expect(result).toEqual({ sent: true });
    expect(lines).toEqual(["[reset] outcome=no_such_user portal=admin"]);
  });

  it("refuses to choose between two clinic accounts on one address", async () => {
    const { result, lines } = await ask(twoClinics, { portal: "clinic" });
    expect(result).toEqual({ sent: true });
    expect(await tokenHolders()).toEqual([]);
    expect(lines).toEqual(["[reset] outcome=ambiguous_email portal=clinic roles=TENANT_ADMIN+TENANT_ADMIN"]);
  });

  it("the staff fallback prefers the platform admin, and never reaches a client", async () => {
    await ask(shared);
    expect(await tokenHolders()).toEqual(["admin"]);
  });

  it("falls back to the staff door for a customer portal with no clinic", async () => {
    const { lines } = await ask(shared, { portal: "customer" });
    expect(await tokenHolders()).toEqual(["admin"]);
    expect(lines[0]).toContain("portal=staff");
  });

  it("writes no address into any line", async () => {
    const all = [...(await ask(shared, { portal: "admin" })).lines, ...(await ask(twoClinics, { portal: "clinic" })).lines].join("\n");
    expect(all).not.toContain("@");
    expect(all).not.toContain(String(stamp));
  });
});
