/**
 * Who a clinic's broadcast reaches, and what closing an account takes with it.
 *
 * A broadcast used to go straight to every device the clinic had — whatever
 * its owner had chosen about offers, at any hour, and including people who
 * had closed their account (docs/security/review-2026-11.md, N-1 and N-3).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { ENROLLED } from "../helpers/enrolled";

const sent: { userId: string; title: string }[] = [];
vi.mock("@/lib/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/web-push")>();
  return {
    ...actual,
    vapidConfigured: () => true,
    // One device per client, always accepted: this file is about who is
    // chosen, not about talking to a push service.
    sendToClient: async (userId: string, message: { title: string }) => {
      sent.push({ userId, title: message.title });
      return { sent: 1, removed: 0, failed: 0 };
    },
    notifyClientQuietly: async () => {},
  };
});

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => clientAuthMock);

const { sendClinicBroadcastAction } = await import("@/lib/actions/clinic-broadcast");
const { clientDeleteAccountAction } = await import("@/lib/actions/client-app");

/** 10:00 in Amsterdam: inside any clinic's sending hours. */
const DAYTIME = new Date("2026-07-01T08:00:00Z");
/** 23:00 in Amsterdam: outside them. */
const NIGHT = new Date("2026-07-01T21:00:00Z");

describe("a clinic's broadcast", () => {
  const stamp = Date.now();
  const slug = `bc-${stamp}`;
  let clinic: string;
  let otherClinic: string;
  let ownerId: string;
  const who: Record<string, { userId: string; profileId: string }> = {};

  async function client(tag: string, into: string, opts: { offers: boolean; device?: boolean }) {
    const user = await rawDb.user.create({ data: { tenantId: into, email: `${tag}-${stamp}@example.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profile = await rawDb.customerProfile.create({
      data: { tenantId: into, userId: user.id, firstName: tag, lastName: "Client", marketingConsent: opts.offers, pushConsent: true },
    });
    if (opts.device !== false) {
      await rawDb.pushSubscription.create({ data: { tenantId: into, userId: user.id, endpoint: `https://push.example/${tag}-${stamp}`, p256dh: "k", auth: "a" } });
    }
    who[tag] = { userId: user.id, profileId: profile.id };
  }

  const form = (title = "Autumn offer") => {
    const fd = new FormData();
    fd.set("title", title);
    fd.set("body", "Ten percent off this week.");
    return fd;
  };
  const sentTo = () => sent.map((s) => s.userId);
  const clearSends = async () => {
    sent.length = 0;
    await rawDb.notificationDelivery.deleteMany({ where: { tenantId: clinic } });
    await rawDb.rateLimitBucket.deleteMany({ where: { key: `broadcast:${clinic}` } });
  };

  beforeAll(async () => {
    clinic = (await rawDb.tenant.create({ data: { slug, name: "Broadcast Clinic" } })).id;
    otherClinic = (await rawDb.tenant.create({ data: { slug: `${slug}-other`, name: "Other Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Broadcast Clinic", timeZone: "Europe/Amsterdam" } });
    await rawDb.tenantSettings.create({ data: { tenantId: clinic } });
    ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `bc-owner-${stamp}@example.com`, passwordHash: "x", role: "TENANT_ADMIN", twoFactor: ENROLLED } })).id;

    await client("wants", clinic, { offers: true });
    await client("declined", clinic, { offers: false });
    await client("nodevice", clinic, { offers: true, device: false });
    await client("elsewhere", otherClinic, { offers: true });
  });

  afterAll(async () => {
    vi.useRealTimers();
    for (const id of [clinic, otherClinic]) await deleteTenantCompletely(id).catch(() => undefined);
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DAYTIME);
    authMock.auth.mockResolvedValue({
      user: { id: ownerId, email: "o@example.com", name: "O", role: "TENANT_ADMIN", tenantId: clinic, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });
    await clearSends();
  });

  afterEach(() => vi.useRealTimers());

  it("reaches the clients who asked for offers, and nobody else", async () => {
    const result = await sendClinicBroadcastAction(clinic, form());
    expect(result).toMatchObject({ ok: true, devices: 1 });
    expect(sentTo()).toEqual([who.wants!.userId]);
    // Not the client who switched offers off, and never another clinic's.
    expect(sentTo()).not.toContain(who.declined!.userId);
    expect(sentTo()).not.toContain(who.elsewhere!.userId);
  });

  it("does not go out at night, and says that is why", async () => {
    vi.setSystemTime(NIGHT);
    const result = await sendClinicBroadcastAction(clinic, form());
    expect(sent).toHaveLength(0);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("outside your sending hours");
  });

  it("respects the one-a-day limit a campaign would", async () => {
    expect(await sendClinicBroadcastAction(clinic, form("First"))).toMatchObject({ ok: true, devices: 1 });
    const second = await sendClinicBroadcastAction(clinic, form("Second"));
    expect(sent.map((s) => s.title)).toEqual(["First"]);
    expect((second as { error: string }).error).toContain("daily limit reached");
  });

  it("tells a clinic with nobody to send to that nobody was sent it", async () => {
    await rawDb.customerProfile.updateMany({ where: { id: who.wants!.profileId }, data: { marketingConsent: false } });
    try {
      const result = await sendClinicBroadcastAction(clinic, form());
      expect(sent).toHaveLength(0);
      expect((result as { error: string }).error).toContain("Nobody was sent this");
    } finally {
      await rawDb.customerProfile.updateMany({ where: { id: who.wants!.profileId }, data: { marketingConsent: true } });
    }
  });

  describe("after a client closes their account", () => {
    it("their devices are gone, so nothing can reach them", async () => {
      await client("leaving", clinic, { offers: true });
      const leaving = who.leaving!;
      clientAuthMock.clientAuth.mockResolvedValue({
        user: { id: leaving.userId, email: "l@example.com", name: "L", role: "CUSTOMER", tenantId: clinic, tenantSlug: slug, staffProfileId: null, customerProfileId: leaving.profileId, permissions: [] },
      });
      expect(await rawDb.pushSubscription.count({ where: { userId: leaving.userId } })).toBe(1);

      expect(await clientDeleteAccountAction(slug)).toEqual({ ok: true });

      expect(await rawDb.pushSubscription.count({ where: { userId: leaving.userId } })).toBe(0);
      expect(await rawDb.customerProfile.findUniqueOrThrow({ where: { id: leaving.profileId } })).toMatchObject({ marketingConsent: false, pushConsent: false });

      await clearSends();
      await sendClinicBroadcastAction(clinic, form());
      expect(sentTo()).not.toContain(leaving.userId);
      // And somebody else's devices were left alone.
      expect(await rawDb.pushSubscription.count({ where: { userId: who.wants!.userId } })).toBe(1);
    });
  });
});
