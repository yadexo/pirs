import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

/**
 * Buying sessions, owning them, and giving them away.
 *
 * Sessions are money the client has already spent, so the tests that matter
 * are the ones about them not being duplicated, not being lost, and not
 * outliving the date they were sold with.
 */

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);

const { createPackagesForOrder } = await import("@/lib/customer-packages");
const { clientGiveSessionsAction } = await import("@/lib/actions/client-app");
const { getOwnedPackages } = await import("@/lib/client-app-packages");
const { getTenantDb } = await import("@/lib/tenant-db");
const { spendPackageSession, sessionUsedMessage } = await import("@/lib/package-redemption");

describe("session packages", () => {
  let tenantId: string;
  let slug: string;
  let serviceId: string;
  let packageId: string;
  let giverId: string;
  let receiverId: string;
  let giverUserId: string;
  let db: ReturnType<typeof getTenantDb>;

  const signInAs = (customerProfileId: string, userId: string) => {
    clientAuthMock.clientAuth.mockResolvedValue({
      user: { id: userId, email: "x@example.com", role: "CUSTOMER", tenantId, tenantSlug: slug, customerProfileId, authTime: Date.now() },
    });
  };

  beforeAll(async () => {
    const stamp = Date.now();
    slug = `pkg-${stamp}`;
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Package Clinic" } })).id;
    db = getTenantDb(tenantId);

    const category = await rawDb.serviceCategory.create({ data: { tenantId, name: "General" } });
    serviceId = (
      await rawDb.service.create({
        data: { tenantId, categoryId: category.id, name: "Facial", durationMinutes: 60, priceCents: 9_500, schedulingUrl: "https://clinic.example/book" },
      })
    ).id;

    packageId = (
      await rawDb.package.create({
        data: { tenantId, name: "Glow 5", priceCents: 42_500, totalUses: 5, expiryDays: 365, transferable: true },
      })
    ).id;
    await rawDb.packageItem.create({ data: { packageId, serviceId } });

    const mk = async (email: string, phone: string) => {
      const user = await rawDb.user.create({ data: { tenantId, email, passwordHash: "x", role: "CUSTOMER" } });
      const profile = await rawDb.customerProfile.create({ data: { tenantId, userId: user.id, firstName: "A", lastName: "B", phone } });
      return { userId: user.id, profileId: profile.id };
    };
    const giver = await mk(`giver-${stamp}@x.com`, "+31600000001");
    const receiver = await mk(`receiver-${stamp}@x.com`, "+31600000002");
    giverId = giver.profileId;
    giverUserId = giver.userId;
    receiverId = receiver.profileId;
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  /** A paid order carrying one package line. */
  async function buyPackage(quantity = 1) {
    const order = await rawDb.order.create({
      data: {
        tenantId,
        customerProfileId: giverId,
        orderNumber: `ORD-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        status: "PAID",
        subtotalCents: 42_500 * quantity,
        totalCents: 42_500 * quantity,
        paidAt: new Date(),
      },
    });
    await rawDb.orderItem.create({
      data: { orderId: order.id, itemType: "PACKAGE", packageId, name: "Glow 5", quantity, unitPriceCents: 42_500, totalCents: 42_500 * quantity },
    });
    return order.id;
  }

  describe("buying them", () => {
    it("turns a paid package line into sessions with an end date", async () => {
      const orderId = await buyPackage();
      const bought = new Date("2026-10-13T12:00:00.000Z");
      expect(await createPackagesForOrder(orderId, rawDb, bought)).toMatchObject({ created: 1 });

      const owned = await rawDb.customerPackage.findFirstOrThrow({ where: { customerProfileId: giverId }, orderBy: { createdAt: "desc" } });
      expect(owned.remainingUses).toBe(5);
      expect(owned.totalUses).toBe(5);
      // 365 days from the day it was bought, not from today.
      expect(owned.expiresAt?.toISOString()).toBe("2027-10-13T12:00:00.000Z");
    });

    it("creates nothing the second time, so a retried webhook costs nothing", async () => {
      const orderId = await buyPackage();
      expect(await createPackagesForOrder(orderId)).toMatchObject({ created: 1 });
      expect(await createPackagesForOrder(orderId)).toMatchObject({ created: 0 });
      expect(await rawDb.customerPackage.count({ where: { orderItemId: { not: null }, customerProfileId: giverId } })).toBeGreaterThan(0);
    });

    it("gives two of the same package their own counts rather than one double one", async () => {
      const orderId = await buyPackage(2);
      expect(await createPackagesForOrder(orderId)).toMatchObject({ created: 2 });
      // orderItemId is a plain column, not a relation, so the line is looked
      // up first and the sessions by its id.
      const line = await rawDb.orderItem.findFirstOrThrow({ where: { orderId } });
      const rows = await rawDb.customerPackage.findMany({ where: { orderItemId: line.id } });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.remainingUses === 5)).toBe(true);
    });
  });

  describe("giving them away", () => {
    async function freshPackage(over: Record<string, unknown> = {}) {
      return rawDb.customerPackage.create({
        data: {
          tenantId,
          customerProfileId: giverId,
          packageId,
          remainingUses: 3,
          totalUses: 5,
          expiresAt: new Date(Date.now() + 90 * 86_400_000),
          ...over,
        } as never,
      });
    }

    it("moves the sessions, and the end date travels with them", async () => {
      const mine = await freshPackage();
      signInAs(giverId, giverUserId);
      const res = await clientGiveSessionsAction(slug, mine.id, 2, `receiver-${tenantId.slice(-4)}@x.com`.replace(/.*/, (await rawDb.user.findFirstOrThrow({ where: { customerProfile: { id: receiverId } }, select: { email: true } })).email!));
      expect(res).toMatchObject({ ok: true, sessions: 2, remaining: 1 });

      const given = await rawDb.customerPackage.findFirstOrThrow({ where: { customerProfileId: receiverId }, orderBy: { createdAt: "desc" } });
      expect(given.remainingUses).toBe(2);
      expect(given.receivedFromCustomerProfileId).toBe(giverId);
      // The same instant, not ninety fresh days.
      expect(given.expiresAt?.toISOString()).toBe(mine.expiresAt?.toISOString());

      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).remainingUses).toBe(1);
    });

    it("writes it to the audit log, so the clinic can see who moved what", async () => {
      const mine = await freshPackage();
      signInAs(giverId, giverUserId);
      const email = (await rawDb.user.findFirstOrThrow({ where: { customerProfile: { id: receiverId } }, select: { email: true } })).email!;
      await clientGiveSessionsAction(slug, mine.id, 1, email);

      const entry = await rawDb.auditLog.findFirst({ where: { tenantId, action: "package.sessions.given", entityId: mine.id } });
      expect(entry).not.toBeNull();
      expect(entry!.metadata).toMatchObject({ sessions: 1, toCustomerProfileId: receiverId });
    });

    it("refuses more sessions than are left, and moves nothing", async () => {
      const mine = await freshPackage({ remainingUses: 1 });
      signInAs(giverId, giverUserId);
      const email = (await rawDb.user.findFirstOrThrow({ where: { customerProfile: { id: receiverId } }, select: { email: true } })).email!;
      expect(await clientGiveSessionsAction(slug, mine.id, 2, email)).toMatchObject({ error: expect.stringMatching(/between 1 and 1/) });
      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).remainingUses).toBe(1);
    });

    it("refuses expired sessions", async () => {
      const mine = await freshPackage({ expiresAt: new Date(Date.now() - 86_400_000) });
      signInAs(giverId, giverUserId);
      const email = (await rawDb.user.findFirstOrThrow({ where: { customerProfile: { id: receiverId } }, select: { email: true } })).email!;
      expect(await clientGiveSessionsAction(slug, mine.id, 1, email)).toMatchObject({ error: expect.stringMatching(/end date/i) });
    });

    it("refuses when the clinic did not make the package transferable", async () => {
      const locked = await rawDb.package.create({
        data: { tenantId, name: "Not shareable", priceCents: 10_000, totalUses: 2, transferable: false },
      });
      const mine = await rawDb.customerPackage.create({
        data: { tenantId, customerProfileId: giverId, packageId: locked.id, remainingUses: 2, totalUses: 2 } as never,
      });
      signInAs(giverId, giverUserId);
      const email = (await rawDb.user.findFirstOrThrow({ where: { customerProfile: { id: receiverId } }, select: { email: true } })).email!;
      expect(await clientGiveSessionsAction(slug, mine.id, 1, email)).toMatchObject({ error: expect.stringMatching(/can't be given/i) });
    });

    it("refuses somebody with no account at this clinic, and moves nothing", async () => {
      const mine = await freshPackage();
      signInAs(giverId, giverUserId);
      expect(await clientGiveSessionsAction(slug, mine.id, 1, "nobody@example.com")).toMatchObject({
        error: expect.stringMatching(/couldn't find an account/i),
      });
      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).remainingUses).toBe(3);
    });

    it("refuses giving to yourself", async () => {
      const mine = await freshPackage();
      signInAs(giverId, giverUserId);
      const email = (await rawDb.user.findFirstOrThrow({ where: { customerProfile: { id: giverId } }, select: { email: true } })).email!;
      expect(await clientGiveSessionsAction(slug, mine.id, 1, email)).toMatchObject({ error: expect.stringMatching(/already yours/i) });
    });

    it("marks a package given away in full as no longer the giver's", async () => {
      const mine = await freshPackage({ remainingUses: 2 });
      signInAs(giverId, giverUserId);
      const email = (await rawDb.user.findFirstOrThrow({ where: { customerProfile: { id: receiverId } }, select: { email: true } })).email!;
      await clientGiveSessionsAction(slug, mine.id, 2, email);
      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("TRANSFERRED");
    });
  });

  describe("what the client sees", () => {
    it("counts the sessions and keeps the end date", async () => {
      await rawDb.customerPackage.deleteMany({ where: { customerProfileId: receiverId } });
      await rawDb.customerPackage.create({
        data: {
          tenantId,
          customerProfileId: receiverId,
          packageId,
          remainingUses: 3,
          totalUses: 5,
          expiresAt: new Date("2027-10-02T00:00:00.000Z"),
        } as never,
      });

      const owned = await getOwnedPackages(db, receiverId);
      expect(owned).toHaveLength(1);
      expect(owned[0]!.sessionsLabel).toBe("3 of 5 sessions left");
      expect(owned[0]!.expiresAt).toBe("2027-10-02T00:00:00.000Z");
      expect(owned[0]!.expired).toBe(false);
      expect(owned[0]!.canGive).toBe(true);
      // The treatments a session buys, with the page to book them on.
      expect(owned[0]!.covers).toMatchObject([{ name: "Facial", bookingUrl: "https://clinic.example/book" }]);
    });

    it("will not offer to give away expired sessions", async () => {
      await rawDb.customerPackage.deleteMany({ where: { customerProfileId: receiverId } });
      await rawDb.customerPackage.create({
        data: { tenantId, customerProfileId: receiverId, packageId, remainingUses: 2, totalUses: 5, expiresAt: new Date("2020-01-01T00:00:00.000Z") } as never,
      });
      const owned = await getOwnedPackages(db, receiverId);
      expect(owned[0]!.expired).toBe(true);
      expect(owned[0]!.canGive).toBe(false);
    });
  });

  /* ------------------------------------------------ spending them at the desk */

  describe("using a session at the desk", () => {
    let staffUserId: string;
    let deskPackageId: string;
    let deskServiceId: string;
    let otherServiceId: string;

    beforeAll(async () => {
      const stamp = Date.now();
      staffUserId = (await rawDb.user.create({ data: { tenantId, email: `desk-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } })).id;
      const category = await rawDb.serviceCategory.findFirstOrThrow({ where: { tenantId } });
      deskServiceId = serviceId;
      otherServiceId = (
        await rawDb.service.create({ data: { tenantId, categoryId: category.id, name: "Not covered", durationMinutes: 30, priceCents: 5_000 } })
      ).id;
      deskPackageId = packageId;
    });

    async function owned(over: Record<string, unknown> = {}) {
      return rawDb.customerPackage.create({
        data: {
          tenantId,
          customerProfileId: giverId,
          packageId: deskPackageId,
          remainingUses: 3,
          totalUses: 5,
          expiresAt: new Date(Date.now() + 60 * 86_400_000),
          ...over,
        } as never,
      });
    }

    it("takes one session and records who took it, and what for", async () => {
      const mine = await owned();
      const res = await spendPackageSession({ tenantId, customerPackageId: mine.id, serviceId: deskServiceId, staffUserId });
      expect(res).toMatchObject({ ok: true, remainingUses: 2, totalUses: 5, serviceName: "Facial" });

      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).remainingUses).toBe(2);
      const use = await rawDb.packageSessionUse.findFirstOrThrow({ where: { customerPackageId: mine.id } });
      expect(use.usedById).toBe(staffUserId);
      expect(use.serviceId).toBe(deskServiceId);
    });

    /**
     * The point of the whole thing: two people at the desk, one session. One of
     * them gets it and the other is told, rather than both being handed a
     * session that only existed once.
     */
    it("gives the last session to exactly one of two people asking at once", async () => {
      const mine = await owned({ remainingUses: 1 });
      const [a, b] = await Promise.all([
        spendPackageSession({ tenantId, customerPackageId: mine.id, serviceId: deskServiceId, staffUserId }),
        spendPackageSession({ tenantId, customerPackageId: mine.id, serviceId: deskServiceId, staffUserId }),
      ]);

      const wins = [a, b].filter((r) => r.ok);
      expect(wins).toHaveLength(1);
      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).remainingUses).toBe(0);
      // And only one row in the history, so the client is not billed twice for
      // a session that happened once.
      expect(await rawDb.packageSessionUse.count({ where: { customerPackageId: mine.id } })).toBe(1);
    });

    it("marks a package with nothing left as finished", async () => {
      const mine = await owned({ remainingUses: 1 });
      await spendPackageSession({ tenantId, customerPackageId: mine.id, serviceId: deskServiceId, staffUserId });
      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("DEPLETED");
    });

    it("refuses an empty package, and writes no history", async () => {
      const mine = await owned({ remainingUses: 0 });
      const res = await spendPackageSession({ tenantId, customerPackageId: mine.id, serviceId: deskServiceId, staffUserId });
      expect(res).toMatchObject({ ok: false, reason: "none-left" });
      expect(await rawDb.packageSessionUse.count({ where: { customerPackageId: mine.id } })).toBe(0);
    });

    it("refuses an expired package, and says so rather than saying it is empty", async () => {
      const mine = await owned({ expiresAt: new Date(Date.now() - 86_400_000) });
      const res = await spendPackageSession({ tenantId, customerPackageId: mine.id, serviceId: deskServiceId, staffUserId });
      expect(res).toMatchObject({ ok: false, reason: "expired" });
      expect((res as { message: string }).message).toMatch(/end date/i);
      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).remainingUses).toBe(3);
    });

    it("refuses a treatment the package does not cover", async () => {
      const mine = await owned();
      const res = await spendPackageSession({ tenantId, customerPackageId: mine.id, serviceId: otherServiceId, staffUserId });
      expect(res).toMatchObject({ ok: false, reason: "not-covered" });
      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).remainingUses).toBe(3);
    });

    it("refuses a package belonging to another clinic", async () => {
      const mine = await owned();
      const res = await spendPackageSession({ tenantId: "some-other-clinic", customerPackageId: mine.id, serviceId: deskServiceId, staffUserId });
      expect(res).toMatchObject({ ok: false, reason: "not-found" });
      expect((await rawDb.customerPackage.findUniqueOrThrow({ where: { id: mine.id } })).remainingUses).toBe(3);
    });

    it("tells the client how many are left, in those words", async () => {
      expect(sessionUsedMessage(4)).toBe("1 session used, 4 left");
      expect(sessionUsedMessage(0)).toBe("1 session used, 0 left");
    });
  });

});

/**
 * The order line has to carry the package, or the sessions have nothing to be
 * created from. This is the bug that shipped nothing to a client who paid.
 */
describe("the order line a package is sold on", () => {
  it("records which package it was", async () => {
    const { clientCheckoutAction } = await import("@/lib/actions/client-app");
    expect(typeof clientCheckoutAction).toBe("function");
    const source = (await import("node:fs")).readFileSync("lib/actions/client-app.ts", "utf8");
    expect(source).toMatch(/packageId: i\.packageId,/);
    expect(source).toMatch(/i\.package\?\.name/);
  });
});
