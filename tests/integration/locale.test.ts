import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => clientAuthMock);

let currentPathname = "/";
let currentCookie: string | undefined;
let lastCookieSet: { name: string; value: string } | undefined;

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-pathname": currentPathname })),
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "pirs_locale" && currentCookie !== undefined ? { value: currentCookie } : undefined),
    set: (name: string, value: string) => {
      lastCookieSet = { name, value };
      currentCookie = value;
    },
  })),
}));

const { resolveLocale, setLocaleCookie, LOCALE_COOKIE } = await import("@/lib/locale");
const { clientSaveLocaleAction } = await import("@/lib/actions/client-app");
const { staffSaveLocaleAction } = await import("@/lib/actions/account");

/**
 * Priority order the bug report asked for, exactly: a signed-in account's
 * own choice beats everything, a signed-out browser's remembered cookie
 * beats the clinic's default, and the clinic's default only applies to the
 * client app (staff have no clinic default to fall back to).
 */
describe("locale resolution priority", () => {
  const stamp = Date.now();
  let clinic: string;
  let slug: string;
  let staffUserId: string;
  let clientUserId: string;
  let clientProfileId: string;

  const asStaff = () => authMock.auth.mockResolvedValue({ user: { id: staffUserId } });
  const asClient = () =>
    clientAuthMock.clientAuth.mockResolvedValue({
      user: { id: clientUserId, email: `c-${stamp}@x.com`, role: "CUSTOMER", tenantId: clinic, tenantSlug: slug, customerProfileId: clientProfileId, staffProfileId: null, permissions: [] },
    });

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    slug = `locale-${stamp}`;
    clinic = (await rawDb.tenant.create({ data: { slug, name: "Locale Clinic" } })).id;
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, defaultClientLocale: "en" } });

    staffUserId = (await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN", locale: "nl" } })).id;
    clientUserId = (await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER", locale: "nl" } })).id;
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: clientUserId, firstName: "Cara", lastName: "Client" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  afterEach(() => {
    currentPathname = "/";
    currentCookie = undefined;
    lastCookieSet = undefined;
    authMock.auth.mockReset();
    clientAuthMock.clientAuth.mockReset();
  });

  describe("staff / clinic portal", () => {
    it("a signed-in account's own locale wins over the cookie", async () => {
      currentPathname = "/m/abc";
      currentCookie = "en";
      asStaff();
      expect(await resolveLocale()).toBe("nl");
    });

    it("signed out, the cookie wins over the platform default", async () => {
      currentPathname = "/m/abc";
      currentCookie = "en";
      authMock.auth.mockResolvedValue(null);
      expect(await resolveLocale()).toBe("en");
    });

    it("signed out with no cookie falls back to the platform default (nl)", async () => {
      currentPathname = "/m/abc";
      authMock.auth.mockResolvedValue(null);
      expect(await resolveLocale()).toBe("nl");
    });
  });

  describe("client app", () => {
    it("a signed-in client's own locale wins over the cookie and the clinic default", async () => {
      currentPathname = `/app/${slug}`;
      currentCookie = "en";
      asClient();
      expect(await resolveLocale()).toBe("nl");
    });

    it("signed out, the cookie wins over the clinic default", async () => {
      currentPathname = `/app/${slug}`;
      currentCookie = "nl";
      clientAuthMock.clientAuth.mockResolvedValue(null);
      expect(await resolveLocale()).toBe("nl");
    });

    it("signed out with no cookie falls back to the clinic's default", async () => {
      currentPathname = `/app/${slug}`;
      clientAuthMock.clientAuth.mockResolvedValue(null);
      expect(await resolveLocale()).toBe("en");
    });

    it("signed out, no cookie, unknown clinic falls back to the platform default", async () => {
      currentPathname = "/app/does-not-exist";
      clientAuthMock.clientAuth.mockResolvedValue(null);
      expect(await resolveLocale()).toBe("nl");
    });
  });

  describe("switching both ways", () => {
    it("clientSaveLocaleAction moves a client nl -> en and writes the fallback cookie", async () => {
      asClient();
      const res = await clientSaveLocaleAction(slug, "en");
      expect(res).toEqual({ ok: true });
      const user = await rawDb.user.findUnique({ where: { id: clientUserId }, select: { locale: true } });
      expect(user?.locale).toBe("en");
      expect(lastCookieSet).toEqual({ name: LOCALE_COOKIE, value: "en" });
    });

    it("clientSaveLocaleAction moves a client en -> nl and writes the fallback cookie", async () => {
      asClient();
      const res = await clientSaveLocaleAction(slug, "nl");
      expect(res).toEqual({ ok: true });
      const user = await rawDb.user.findUnique({ where: { id: clientUserId }, select: { locale: true } });
      expect(user?.locale).toBe("nl");
      expect(lastCookieSet).toEqual({ name: LOCALE_COOKIE, value: "nl" });
    });

    it("staffSaveLocaleAction moves a staff account nl -> en and writes the fallback cookie", async () => {
      asStaff();
      const res = await staffSaveLocaleAction("en");
      expect(res).toEqual({ ok: true });
      const user = await rawDb.user.findUnique({ where: { id: staffUserId }, select: { locale: true } });
      expect(user?.locale).toBe("en");
      expect(lastCookieSet).toEqual({ name: LOCALE_COOKIE, value: "en" });
    });

    it("staffSaveLocaleAction moves a staff account en -> nl and writes the fallback cookie", async () => {
      asStaff();
      const res = await staffSaveLocaleAction("nl");
      expect(res).toEqual({ ok: true });
      const user = await rawDb.user.findUnique({ where: { id: staffUserId }, select: { locale: true } });
      expect(user?.locale).toBe("nl");
      expect(lastCookieSet).toEqual({ name: LOCALE_COOKIE, value: "nl" });
    });

    it("rejects an unsupported locale without writing anything", async () => {
      asClient();
      const res = await clientSaveLocaleAction(slug, "fr");
      expect(res).toEqual({ error: "Unsupported language." });
      expect(lastCookieSet).toBeUndefined();
    });
  });

  it("setLocaleCookie writes exactly the cookie resolveLocale reads back", async () => {
    await setLocaleCookie("en");
    expect(lastCookieSet).toEqual({ name: LOCALE_COOKIE, value: "en" });
    currentPathname = "/m/abc";
    authMock.auth.mockResolvedValue(null);
    expect(await resolveLocale()).toBe("en");
  });
});
