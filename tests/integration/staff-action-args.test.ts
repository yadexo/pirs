/**
 * Clinic-side actions refuse an object where an id belongs.
 *
 * docs/security/review-2026-11-pass2.md, I-4: `{ "not": "x" }` sent as a
 * membership id matched every membership of the clinic, so one request from
 * a staff member cancelled them all; the same as an item id voided every
 * unused item. These are those requests, plus their neighbours, and each must
 * be refused before anything is read or written.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { INVALID_REQUEST } from "@/lib/action-args";
import { ENROLLED } from "../helpers/enrolled";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/lib/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/web-push")>();
  return { ...actual, notifyClientQuietly: vi.fn() };
});

const membership = await import("@/lib/actions/client-membership");
const items = await import("@/lib/actions/client-items");
const builder = await import("@/lib/actions/app-builder");
const account = await import("@/lib/actions/client-account");
const redeem = await import("@/lib/actions/redeem");
const refunds = await import("@/lib/actions/refund-order");
const settings = await import("@/lib/actions/clinic-settings");
const checkIn = await import("@/lib/actions/check-in");

/** Calls an action with arguments its TypeScript signature would never allow. */
const call = (fn: (...a: never[]) => unknown, ...a: unknown[]) => (fn as (...x: unknown[]) => Promise<unknown>)(...a);

describe("clinic actions refuse objects as ids", () => {
  const stamp = Date.now();
  let clinic: string;
  let staffUserId: string;
  let planId: string;
  const anything = { not: "x" };

  async function snapshot() {
    const [m, i, s] = await Promise.all([
      rawDb.customerMembership.findMany({ where: { tenantId: clinic }, orderBy: { id: "asc" }, select: { id: true, status: true, membershipPlanId: true, cancelAtPeriodEnd: true, pausedAt: true } }),
      rawDb.redeemableItem.findMany({ where: { tenantId: clinic }, orderBy: { id: "asc" }, select: { id: true, status: true, code: true } }),
      rawDb.service.findMany({ where: { tenantId: clinic }, orderBy: { id: "asc" }, select: { id: true, active: true } }),
    ]);
    return JSON.stringify({ m, i, s });
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `staff-args-${stamp}`, name: "Args Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Args Clinic", currency: "EUR" } });
    staffUserId = (await rawDb.user.create({ data: { tenantId: clinic, email: `o-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN", twoFactor: ENROLLED } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: staffUserId, firstName: "Olive", lastName: "Owner" } });
    planId = (await rawDb.membershipPlan.create({ data: { tenantId: clinic, name: "Standard", billingFrequency: "MONTHLY", priceCents: 4_900 } })).id;
    const category = await rawDb.serviceCategory.create({ data: { tenantId: clinic, name: "General" } });
    for (let n = 0; n < 3; n++) {
      const u = await rawDb.user.create({ data: { tenantId: clinic, email: `c${n}-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
      const p = await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: u.id, firstName: `C${n}`, lastName: "Client" } });
      await rawDb.customerMembership.create({
        data: { tenantId: clinic, customerProfileId: p.id, membershipPlanId: planId, status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) } as never,
      });
      await rawDb.redeemableItem.create({
        data: { tenantId: clinic, customerProfileId: p.id, unitIndex: 0, itemType: "SERVICE", name: "Facial", token: `tok-${stamp}-${n}`, code: `C${stamp}${n}` } as never,
      });
      await rawDb.service.create({ data: { tenantId: clinic, categoryId: category.id, name: `Service ${n}`, durationMinutes: 30, priceCents: 1000 } });
    }
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(() => {
    authMock.auth.mockResolvedValue({
      user: { id: staffUserId, email: `o-${stamp}@x.com`, name: "Olive", role: "TENANT_ADMIN", tenantId: clinic, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });
  });

  it("membership changes: the I-4 request is refused and no membership changes", async () => {
    const before = await snapshot();
    expect(await call(membership.cancelClientMembershipAction, clinic, anything, { when: "now", reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(membership.pauseClientMembershipAction, clinic, anything, { reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(membership.resumeClientMembershipAction, clinic, { in: ["a", "b"] }, { reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(membership.switchClientPlanAction, clinic, anything, { planId, reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(membership.giveFreePeriodsAction, clinic, anything, { periods: "1", reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(membership.clientMembershipAction, clinic, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(membership.cancelClientMembershipAction, anything, "abc", { when: "now", reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await snapshot()).toEqual(before);
  });

  it("item changes: the I-4 request is refused and no item changes", async () => {
    const before = await snapshot();
    expect(await call(items.voidClientItemAction, clinic, anything, { reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(items.reissueClientItemAction, clinic, anything, { reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(items.giftClientItemAction, clinic, anything, { name: "x", itemType: "SERVICE", reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(redeem.redeemItemAction, clinic, { itemId: anything, method: "MANUAL" })).toEqual({ error: INVALID_REQUEST });
    expect(await snapshot()).toEqual(before);
  });

  it("an input object with a key the portal never sends is refused", async () => {
    const before = await snapshot();
    const id = (await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } })).id;
    expect(await call(membership.pauseClientMembershipAction, clinic, id, { reason: "x", status: "CANCELLED" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(membership.cancelClientMembershipAction, clinic, id, { when: "now", reason: { toString: "x" } })).toEqual({ error: INVALID_REQUEST });
    expect(await snapshot()).toEqual(before);
  });

  it("the catalogue, accounts, refunds, settings and check-in refuse them too", async () => {
    const before = await snapshot();
    expect(await call(builder.setItemActiveAction, clinic, "service", anything, false)).toEqual({ error: INVALID_REQUEST });
    expect(await call(builder.setItemActiveAction, clinic, "constructor", "abc", false)).toEqual({ error: INVALID_REQUEST });
    expect(await call(builder.setItemActiveAction, clinic, "service", "abc", "false")).toEqual({ error: INVALID_REQUEST });
    expect(await call(builder.archiveItemAction, clinic, "service", anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(builder.saveServiceAction, clinic, anything, new FormData())).toEqual({ error: INVALID_REQUEST });
    expect(await call(builder.saveServiceAction, clinic, null, { name: "not a form" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(account.clientAccountAction, clinic, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(account.adjustClientCreditAction, clinic, anything, { direction: "add", amount: "5", reason: "x" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(refunds.refundOrderAction, clinic, { orderId: anything })).toEqual({ error: INVALID_REQUEST });
    expect(await call(settings.archiveLocationAction, clinic, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(settings.setStaffActiveAction, clinic, anything, false)).toEqual({ error: INVALID_REQUEST });
    expect(await call(checkIn.checkInClientAction, clinic, { customerProfileId: anything })).toEqual({ error: INVALID_REQUEST });
    expect(await call(checkIn.checkInClientAction, clinic, { token: "t", customerProfileId: "c" })).toEqual({ error: INVALID_REQUEST });
    expect(await snapshot()).toEqual(before);
  });

  it("what the portal really sends still works", async () => {
    const m = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    const res = await membership.pauseClientMembershipAction(clinic, m.id, { reason: "Travelling" });
    expect(res).toMatchObject({ ok: true });
    const i = await rawDb.redeemableItem.findFirstOrThrow({ where: { tenantId: clinic, status: "AVAILABLE" } });
    expect(await items.voidClientItemAction(clinic, i.id, { reason: "Issued twice" })).toMatchObject({ ok: true, status: "VOIDED" });
    // Exactly one of each changed.
    expect(await rawDb.customerMembership.count({ where: { tenantId: clinic, status: "PAUSED" } })).toBe(1);
    expect(await rawDb.redeemableItem.count({ where: { tenantId: clinic, status: "VOIDED" } })).toBe(1);
  });
});
