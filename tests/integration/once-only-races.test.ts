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
});
