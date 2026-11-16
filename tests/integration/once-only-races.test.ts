/**
 * Things a client can have once stay once, however many requests arrive together.
 *
 * docs/security/review-2026-11-pass2.md: each of these was a check followed
 * by a write, and simultaneous requests all passed the check before any of
 * them wrote. Reproduced against the local build before the fixes:
 * - P-4: 20 simultaneous referral claims gave 18 bonuses.
 * - P-5: 10 simultaneous "join plan" requests made 10 memberships.
 * - P-6: a one-time personal discount was used by 5 simultaneous checkouts.
 * - B-2: 8 simultaneous bookings all got the same slot.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

// Each parallel call runs as its own signed-in client.
const who = new AsyncLocalStorage<{ db: TenantDb; user: Record<string, unknown> }>();
const rbacMocks = vi.hoisted(() => ({
  requireCustomerContext: vi.fn(),
  requireStaffContext: vi.fn(),
  requirePermission: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/rbac", () => rbacMocks);

const clientApp = await import("@/lib/actions/client-app");

describe("once-only claims under simultaneous requests", () => {
  const stamp = Date.now();
  const slug = `races-${stamp}`;
  let tenantId: string;
  let db: TenantDb;

  async function makeClient(name: string) {
    const user = await rawDb.user.create({ data: { tenantId, email: `${name}-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profile = await rawDb.customerProfile.create({ data: { tenantId, userId: user.id, firstName: name, lastName: "C" } });
    return { db, user: { id: user.id, email: user.email, role: "CUSTOMER", tenantId, tenantSlug: slug, staffProfileId: null, customerProfileId: profile.id, permissions: [] }, profileId: profile.id };
  }
  type Client = Awaited<ReturnType<typeof makeClient>>;
  const as = <T,>(client: Client, fn: () => Promise<T>) => who.run(client, fn);
  const together = <T,>(client: Client, n: number, fn: () => Promise<T>) => Promise.all(Array.from({ length: n }, () => as(client, fn)));

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Race Clinic" } })).id;
    db = getTenantDb(tenantId);
    await rawDb.tenantBranding.create({ data: { tenantId, businessName: "Race Clinic", currency: "EUR" } });
    await rawDb.tenantSettings.create({ data: { tenantId, vatRateBasisPoints: 0, googleReviewUrl: "https://g.page/r/race/review" } });
    await rawDb.loyaltyProgramme.create({ data: { tenantId, pointsPerCents: 0, active: true, referralPoints: 100, reviewPoints: 50 } });
    rbacMocks.requireCustomerContext.mockImplementation(async () => {
      const current = who.getStore();
      if (!current) throw new Error("no client in context");
      return current;
    });
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  describe("the referral and review bonuses (P-4)", () => {
    it("20 simultaneous referral claims give one bonus", async () => {
      const client = await makeClient("referrer");
      const results = await together(client, 20, () => clientApp.clientReferralAction(slug));
      expect(results.filter((r) => "ok" in r)).toHaveLength(1);
      expect(results.filter((r) => "error" in r).every((r) => "error" in r && /already claimed/.test(r.error))).toBe(true);
      expect(await rawDb.loyaltyTransaction.count({ where: { customerProfileId: client.profileId, reason: "Referral shared" } })).toBe(1);
      expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: client.profileId } })).loyaltyPointsBalance).toBe(100);
    });

    it("20 simultaneous review claims give one bonus", async () => {
      const client = await makeClient("reviewer");
      const results = await together(client, 20, () => clientApp.clientReviewAction(slug));
      expect(results.filter((r) => "ok" in r)).toHaveLength(1);
      expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: client.profileId } })).loyaltyPointsBalance).toBe(50);
    });

    it("one client's claim does not hold up another's", async () => {
      const [a, b] = [await makeClient("ra"), await makeClient("rb")];
      const [ra, rb] = await Promise.all([as(a, () => clientApp.clientReferralAction(slug)), as(b, () => clientApp.clientReferralAction(slug))]);
      expect([ra, rb].every((r) => "ok" in r)).toBe(true);
    });
  });
  describe("joining a plan (P-5)", () => {
    it("10 simultaneous joins make one membership", async () => {
      const plan = await rawDb.membershipPlan.create({
        data: { tenantId, name: `Race Plan ${stamp}`, billingFrequency: "MONTHLY", priceCents: 4_900, includedCreditCents: 2_000, active: true },
      });
      const client = await makeClient("joiner");
      const results = await together(client, 10, () => clientApp.clientJoinPlanAction(slug, plan.id));
      expect(results.filter((r) => "ok" in r)).toHaveLength(1);
      expect(results.filter((r) => "error" in r).every((r) => "error" in r && /already have/.test(r.error))).toBe(true);
      const memberships = await rawDb.customerMembership.findMany({ where: { customerProfileId: client.profileId } });
      expect(memberships).toHaveLength(1);
      // The plan's included credit is granted once, with the one membership.
      expect(memberships.reduce((sum, m) => sum + m.creditBalanceCents, 0)).toBe(2_000);
      expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: client.profileId } })).accountCreditBalanceCents).toBe(2_000);
    });
  });
  describe("a one-time personal discount (P-6)", () => {
    it("5 simultaneous checkouts use it once", async () => {
      const category = await rawDb.serviceCategory.create({ data: { tenantId, name: `Race ${stamp}` } });
      const service = await rawDb.service.create({ data: { tenantId, categoryId: category.id, name: "Race Facial", durationMinutes: 30, priceCents: 15_000 } });
      const client = await makeClient("discounted");
      const promotion = await rawDb.promotion.create({
        data: {
          tenantId,
          title: "Half off, once",
          discountType: "PERCENT",
          discountValue: 50,
          perCustomerLimit: 1,
          customerProfileId: client.profileId,
          autoApply: true,
          active: true,
          startAt: new Date(Date.now() - 86_400_000),
          endAt: new Date(Date.now() + 86_400_000),
        },
      });
      expect(await as(client, () => clientApp.clientAddToCartAction(slug, "service", service.id, 1))).toMatchObject({ ok: true });

      const results = await together(client, 5, () => clientApp.clientCheckoutAction(slug, null));

      const discounted = await rawDb.order.findMany({ where: { customerProfileId: client.profileId, promotionId: promotion.id, status: { not: "FAILED" } } });
      expect(discounted).toHaveLength(1);
      expect(discounted[0]!.discountCents).toBe(7_500);
      expect(await rawDb.promotionRedemption.count({ where: { promotionId: promotion.id } })).toBe(1);
      // The others are told plainly, and hold nothing.
      const refused = results.filter((r) => "error" in r);
      expect(refused.length).toBeGreaterThanOrEqual(1);
      expect(refused.every((r) => "error" in r && /offer has just been used|cart/i.test(r.error))).toBe(true);
    });

    it("a failed order gives its reserved use back", async () => {
      const client = await makeClient("released");
      const promotion = await rawDb.promotion.create({
        data: { tenantId, title: "Once", discountType: "PERCENT", discountValue: 10, perCustomerLimit: 1, customerProfileId: client.profileId, autoApply: true, active: true, startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) },
      });
      const order = await rawDb.order.create({
        data: { tenantId, customerProfileId: client.profileId, orderNumber: `RACE-${stamp}`, status: "PENDING", subtotalCents: 10_000, discountCents: 1_000, totalCents: 9_000, promotionId: promotion.id, currency: "EUR" },
      });
      await rawDb.promotionRedemption.create({ data: { tenantId, promotionId: promotion.id, customerProfileId: client.profileId, orderId: order.id, discountAppliedCents: 1_000 } });
      const { releaseFailedOrder } = await import("@/lib/order-completion");
      expect(await releaseFailedOrder(db, order.id, "test")).toBe(true);
      expect(await rawDb.promotionRedemption.count({ where: { promotionId: promotion.id } })).toBe(0);
    });
  });
});
