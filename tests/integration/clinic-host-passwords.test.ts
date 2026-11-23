/**
 * Setting a password on a clinic's own domain works for that clinic's clients
 * and for nobody else.
 *
 * A clinic's verified domain is that clinic's client app and nothing more
 * (lib/portal-hosts.ts, clinicDomainRoute). The set-password and
 * forgot-password pages are served there because client emails link to them
 * — but on that host they must not become a side door into staff accounts,
 * platform admins, or another clinic's clients. The binding comes from the
 * x-clinic-host header, which only the middleware sets (incoming copies are
 * stripped), never from the form.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { CLINIC_HOST_HEADER } from "@/lib/portal-hosts";

const request = vi.hoisted(() => ({ clinicHost: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () => {
    const h = new Headers({ "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.1` });
    if (request.clinicHost) h.set("x-clinic-host", request.clinicHost);
    return h;
  },
}));
const sent = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock("@/lib/providers/notifications", () => ({
  getEmailProvider: () => ({
    send: async (p: { to: string }) => {
      sent.to.push(p.to);
      return { providerMessageId: "t", status: "SENT" };
    },
  }),
}));

const { issuePasswordToken, inspectPasswordToken } = await import("@/lib/password-tokens");
const { requestPasswordResetAction, setPasswordAction } = await import("@/lib/actions/password");

describe("passwords on a clinic's own domain", () => {
  const stamp = Date.now();
  const slug = `chp-${stamp}`;
  const otherSlug = `chp-other-${stamp}`;
  let tenantId: string;
  let otherTenantId: string;
  const ids: Record<"client" | "staff" | "admin" | "otherClient", string> = { client: "", staff: "", admin: "", otherClient: "" };
  const shared = `chp-shared-${stamp}@example.com`;
  // One clinic cannot hold two accounts on one address, so its staff member has its own.
  const staffEmail = `chp-staff-${stamp}@example.com`;

  beforeAll(async () => {
    expect(CLINIC_HOST_HEADER).toBe("x-clinic-host");
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Host Clinic" } })).id;
    otherTenantId = (await rawDb.tenant.create({ data: { slug: otherSlug, name: "Other Clinic" } })).id;
    const pw = await hashPassword("old-password-1");
    ids.client = (await rawDb.user.create({ data: { tenantId, email: shared, passwordHash: pw, role: "CUSTOMER" } })).id;
    ids.staff = (await rawDb.user.create({ data: { tenantId, email: staffEmail, passwordHash: pw, role: "TENANT_ADMIN" } })).id;
    ids.admin = (await rawDb.user.create({ data: { email: shared, passwordHash: pw, role: "PLATFORM_ADMIN" } })).id;
    ids.otherClient = (await rawDb.user.create({ data: { tenantId: otherTenantId, email: shared, passwordHash: pw, role: "CUSTOMER" } })).id;
  });

  afterAll(async () => {
    await rawDb.passwordResetToken.deleteMany({ where: { userId: ids.admin } });
    await rawDb.user.delete({ where: { id: ids.admin } }).catch(() => undefined);
    await deleteTenantCompletely(tenantId);
    await deleteTenantCompletely(otherTenantId);
  });

  beforeEach(async () => {
    request.clinicHost = null;
    sent.to.length = 0;
    await rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { contains: shared } }, { key: { contains: staffEmail } }, { key: { startsWith: "reset:ip:10.9." } }, { key: { startsWith: "set-password:10.9." } }] } });
  });

  const form = (token: string, password = "new-password-123") => {
    const fd = new FormData();
    fd.set("token", token);
    fd.set("password", password);
    fd.set("confirm", password);
    return fd;
  };
  const unused = async (userId: string) => (await rawDb.passwordResetToken.count({ where: { userId, usedAt: null } })) > 0;

  describe("on the clinic's host", () => {
    beforeEach(() => {
      request.clinicHost = slug;
    });

    it("sets that clinic's client's password, and sends them to the clinic's home", async () => {
      const token = await issuePasswordToken(ids.client, 60_000);
      expect(await inspectPasswordToken(token, { clinicSlug: slug })).toMatchObject({ email: shared });
      await expect(setPasswordAction(undefined, form(token, "client-new-pass-1"))).rejects.toThrow("NEXT_REDIRECT:/?password=updated");
      const user = await rawDb.user.findUniqueOrThrow({ where: { id: ids.client } });
      expect(await verifyPassword("client-new-pass-1", user.passwordHash)).toBe(true);
    });

    it("and the link is single-use", async () => {
      const token = await issuePasswordToken(ids.client, 60_000);
      await expect(setPasswordAction(undefined, form(token))).rejects.toThrow("NEXT_REDIRECT");
      expect(await setPasswordAction(undefined, form(token))).toMatchObject({ error: expect.any(String) });
      expect(await inspectPasswordToken(token, { clinicSlug: slug })).toBeNull();
    });

    for (const who of ["staff", "admin", "otherClient"] as const) {
      it(`refuses a ${who} link, shows no address, and leaves the link usable where it belongs`, async () => {
        const before = (await rawDb.user.findUniqueOrThrow({ where: { id: ids[who] } })).passwordHash;
        const token = await issuePasswordToken(ids[who], 60_000);
        expect(await inspectPasswordToken(token, { clinicSlug: slug })).toBeNull();
        expect(await setPasswordAction(undefined, form(token))).toMatchObject({ error: expect.any(String) });
        expect((await rawDb.user.findUniqueOrThrow({ where: { id: ids[who] } })).passwordHash).toBe(before);
        // Not burned: the same link still works on the host it was meant for.
        expect(await unused(ids[who])).toBe(true);
        request.clinicHost = who === "otherClient" ? otherSlug : null;
        await expect(setPasswordAction(undefined, form(token))).rejects.toThrow("NEXT_REDIRECT");
      });
    }

    it("only ever resets this clinic's client, whatever the form says", async () => {
      for (const fields of [{ portal: "admin" }, { portal: "clinic" }, { clinic: otherSlug }, {}] as Record<string, string>[]) {
        await rawDb.passwordResetToken.deleteMany({ where: { userId: { in: Object.values(ids) } } });
        await rawDb.rateLimitBucket.deleteMany({ where: { key: { contains: shared } } });
        const fd = new FormData();
        fd.set("email", shared);
        for (const [k, v] of Object.entries(fields)) fd.set(k, v);
        expect(await requestPasswordResetAction(undefined, fd)).toEqual({ sent: true });
        const holders = await rawDb.passwordResetToken.findMany({ where: { usedAt: null, userId: { in: Object.values(ids) } }, select: { userId: true } });
        expect(holders.map((h) => h.userId), JSON.stringify(fields)).toEqual([ids.client]);
      }
    });

    it("issues nothing for a staff address, even asked at the clinic door", async () => {
      await rawDb.passwordResetToken.deleteMany({ where: { userId: ids.staff } });
      await rawDb.rateLimitBucket.deleteMany({ where: { key: { contains: staffEmail } } });
      const fd = new FormData();
      fd.set("email", staffEmail);
      fd.set("portal", "clinic");
      expect(await requestPasswordResetAction(undefined, fd)).toEqual({ sent: true });
      expect(await unused(ids.staff)).toBe(false);
      expect(sent.to).toEqual([]);
    });
  });

  describe("anywhere else", () => {
    it("behaves as before: staff sign in again, clients go back to their app", async () => {
      await expect(setPasswordAction(undefined, form(await issuePasswordToken(ids.staff, 60_000)))).rejects.toThrow("NEXT_REDIRECT:/login?reason=password-updated");
      await expect(setPasswordAction(undefined, form(await issuePasswordToken(ids.client, 60_000)))).rejects.toThrow(`NEXT_REDIRECT:/app/${slug}?password=updated`);
      expect(await inspectPasswordToken(await issuePasswordToken(ids.admin, 60_000))).toMatchObject({ email: shared });
    });
  });
});
