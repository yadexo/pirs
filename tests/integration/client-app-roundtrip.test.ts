/**
 * The patient app and the clinic portal are two front-ends over one database.
 * These tests call the real client-app server actions, then re-read using the
 * same queries the clinic portal pages issue — so a regression that decouples
 * the two surfaces fails here rather than in production.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { hashPassword } from "@/lib/password";

const rbacMocks = vi.hoisted(() => ({
  requireCustomerContext: vi.fn(),
  requireStaffContext: vi.fn(),
  requirePermission: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/rbac", () => rbacMocks);

const {
  clientBookAction,
  clientCancelAppointmentAction,
  clientAddToCartAction,
  clientCartAction,
  clientSetCartQtyAction,
  clientCheckoutAction,
  clientCheckInAction,
  clientJoinPlanAction,
  clientCancelPlanAction,
  clientSaveProfileAction,
  clientSaveConsentAction,
  getBookingOptionsForServiceAction,
  getClientSlotsAction,
} = await import("@/lib/actions/client-app");

describe("patient app -> clinic portal round trip", () => {
  let tenantId: string;
  let db: TenantDb;
  let customerProfileId: string;
  let serviceId: string;
  let staffProfileId: string;
  let locationId: string;
  let productId: string;
  let planId: string;

  const SLUG = "roundtrip-clinic";

  beforeAll(async () => {
    const tenant = await rawDb.tenant.create({ data: { slug: `${SLUG}-${Date.now()}`, name: "Round Trip Clinic" } });
    tenantId = tenant.id;
    db = getTenantDb(tenantId);

    await rawDb.tenantSettings.create({
      data: { tenantId, taxRateBasisPoints: 0, appointmentCancellationHours: 24 },
    });
    await rawDb.loyaltyProgramme.create({
      data: { tenantId, pointsPerCents: 0.01, pointsPerVisit: 50, referralPoints: 100 },
    });

    const location = await rawDb.location.create({ data: { tenantId, name: "Main", isPrimary: true } });
    locationId = location.id;

    const category = await rawDb.serviceCategory.create({ data: { tenantId, name: "General" } });
    const service = await rawDb.service.create({
      data: { tenantId, categoryId: category.id, name: "Consultation", durationMinutes: 60, priceCents: 8000 },
    });
    serviceId = service.id;

    const staffUser = await rawDb.user.create({
      data: {
        tenantId,
        email: `staff-${Date.now()}@example.com`,
        passwordHash: await hashPassword("Password123!"),
        role: "TENANT_ADMIN",
      },
    });
    const staff = await rawDb.staffProfile.create({
      data: { tenantId, userId: staffUser.id, firstName: "Dee", lastName: "Staff", active: true },
    });
    staffProfileId = staff.id;

    await rawDb.staffService.create({ data: { staffProfileId, serviceId } });
    await rawDb.staffLocation.create({ data: { staffProfileId, locationId } });
    // Available every day so the booking test isn't calendar-dependent.
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      await rawDb.staffAvailability.create({
        data: { tenantId, staffProfileId, dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 },
      });
    }

    const productCategory = await rawDb.productCategory.create({ data: { tenantId, name: "Home care" } });
    const product = await rawDb.product.create({
      data: {
        tenantId,
        categoryId: productCategory.id,
        name: "Cleanser",
        sku: `SKU-${Date.now()}`,
        priceCents: 2500,
        inventoryQuantity: 20,
        taxable: false,
      },
    });
    productId = product.id;

    const plan = await rawDb.membershipPlan.create({
      data: { tenantId, name: "Care Plan", priceCents: 4900, billingFrequency: "MONTHLY", active: true },
    });
    planId = plan.id;

    const customerUser = await rawDb.user.create({
      data: {
        tenantId,
        email: `client-${Date.now()}@example.com`,
        passwordHash: await hashPassword("Password123!"),
        role: "CUSTOMER",
      },
    });
    const profile = await rawDb.customerProfile.create({
      data: { tenantId, userId: customerUser.id, firstName: "Rita", lastName: "Client" },
    });
    customerProfileId = profile.id;

    // Every client action resolves its identity through requireCustomerContext.
    rbacMocks.requireCustomerContext.mockResolvedValue({
      db,
      user: {
        id: customerUser.id,
        email: customerUser.email,
        name: "Test Client",
        role: "CUSTOMER",
        tenantId,
        tenantSlug: SLUG,
        staffProfileId: null,
        customerProfileId,
        permissions: [],
      },
    });
  });

  afterAll(async () => {
    await rawDb.tenant.delete({ where: { id: tenantId } });
  });

  /**
   * Next open slot the availability engine actually offers, from three days
   * out. Starting tomorrow would make the cancellation test depend on the
   * clock: a 9am slot booked after 9am today sits inside the clinic's 24-hour
   * notice window, so the cancellation would be refused correctly and the test
   * would fail every afternoon.
   */
  async function nextSlot(): Promise<string> {
    for (let dayOffset = 3; dayOffset <= 12; dayOffset++) {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset);
      const slots = await getClientSlotsAction(staffProfileId, locationId, 60, date.toISOString());
      if (slots.length > 0) return slots[0]!;
    }
    throw new Error("Availability engine offered no slots in the next 12 days");
  }

  it("offers booking options drawn from the merchant's own catalogue", async () => {
    const options = await getBookingOptionsForServiceAction(serviceId);
    expect(options).not.toBeNull();
    expect(options!.staff.map((s) => s.id)).toContain(staffProfileId);
    expect(options!.locations.map((l) => l.id)).toContain(locationId);
  });

  it("a booking made in the patient app appears on the clinic's Appointments page", async () => {
    const startAtIso = await nextSlot();
    const result = await clientBookAction(SLUG, { serviceId, staffProfileId, locationId, startAtIso });
    expect(result).toEqual({ ok: true, when: startAtIso });

    // Exactly the query app/m/[merchantId]/appointments/page.tsx runs for "requested".
    const portalRows = await db.appointment.findMany({
      where: { status: { in: ["REQUESTED"] } },
      include: {
        customerProfile: { select: { firstName: true, lastName: true } },
        service: { select: { name: true, durationMinutes: true } },
      },
    });
    const booked = portalRows.find((a) => a.startAt.toISOString() === startAtIso);
    expect(booked).toBeDefined();
    expect(booked!.customerProfile.firstName).toBe("Rita");
    expect(booked!.service.name).toBe("Consultation");
    expect(booked!.tenantId).toBe(tenantId);
  });

  it("refuses a slot that is already taken", async () => {
    const taken = await db.appointment.findFirst({ where: { status: "REQUESTED" } });
    const result = await clientBookAction(SLUG, {
      serviceId,
      staffProfileId,
      locationId,
      startAtIso: taken!.startAt.toISOString(),
    });
    expect(result).toEqual({ error: "That time was just taken. Please pick another." });
  });

  it("honours the clinic's cancellation window", async () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000); // inside the 24h window
    const tooLate = await db.appointment.create({
      data: {
        customerProfileId,
        serviceId,
        staffProfileId,
        locationId,
        startAt: soon,
        endAt: new Date(soon.getTime() + 3600_000),
        status: "CONFIRMED",
      } as never,
    });

    const blocked = await clientCancelAppointmentAction(SLUG, tooLate.id);
    expect(blocked).toHaveProperty("error");

    // Outside the window it goes through. Assert the precondition, so a slot
    // that drifts inside the window reports that rather than a bare failure.
    const far = await db.appointment.findFirst({ where: { status: "REQUESTED" } });
    const hoursOut = (far!.startAt.getTime() - Date.now()) / 3_600_000;
    expect(hoursOut).toBeGreaterThan(24);
    expect(await clientCancelAppointmentAction(SLUG, far!.id)).toEqual({ ok: true });
    const after = await db.appointment.findFirst({ where: { id: far!.id } });
    expect(after!.status).toBe("CANCELLED");
  });

  it("a purchase in the patient app lands in the clinic's Shop Summary and awards points", async () => {
    expect(await clientAddToCartAction(SLUG, "product", productId, 1)).toEqual({ ok: true });
    let cart = await clientCartAction();
    expect(cart.count).toBe(1);

    expect(await clientSetCartQtyAction(SLUG, cart.items[0]!.id, 2)).toEqual({ ok: true });
    cart = await clientCartAction();
    expect(cart.count).toBe(2);

    const checkout = await clientCheckoutAction(SLUG, null);
    expect(checkout).toHaveProperty("ok", true);
    const { orderNumber, totalCents } = checkout as { orderNumber: string; totalCents: number; pointsEarned: number };
    expect(totalCents).toBe(5000);

    // The Shop Summary aggregate, verbatim from app/m/[merchantId]/shop/page.tsx.
    const revenue = await db.order.aggregate({ where: { status: "PAID" }, _sum: { totalCents: true } });
    expect(revenue._sum.totalCents).toBe(5000);

    const order = await db.order.findFirst({ where: { orderNumber }, include: { items: true, payments: true } });
    expect(order!.customerProfileId).toBe(customerProfileId);
    expect(order!.items[0]!.quantity).toBe(2);
    expect(order!.payments[0]!.status).toBe("SUCCEEDED");

    // Stock came off the shelf the clinic manages.
    const product = await db.product.findFirst({ where: { id: productId } });
    expect(product!.inventoryQuantity).toBe(18);
    const movement = await db.inventoryTransaction.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
    expect(movement!.quantityChange).toBe(-2);

    // Points show on the profile the clinic reads in Client Profiles.
    const profile = await db.customerProfile.findFirst({ where: { id: customerProfileId } });
    expect(profile!.loyaltyPointsBalance).toBe(50);
    const ledger = await db.loyaltyTransaction.findFirst({
      where: { customerProfileId, type: "EARNED", relatedOrderId: order!.id },
    });
    expect(ledger!.points).toBe(50);
  });

  it("empties the basket after checkout so the next visit starts clean", async () => {
    expect(await clientCartAction()).toMatchObject({ count: 0 });
    expect(await clientCheckoutAction(SLUG, null)).toEqual({ error: "Your cart is empty." });
  });

  it("check-in bumps the visit count the clinic sees, once per day", async () => {
    const first = await clientCheckInAction(SLUG);
    expect(first).toEqual({ ok: true, points: 50 });

    const profile = await db.customerProfile.findFirst({ where: { id: customerProfileId } });
    expect(profile!.visitCount).toBe(1);
    expect(profile!.lastVisitAt).not.toBeNull();
    expect(profile!.loyaltyPointsBalance).toBe(100); // 50 purchase + 50 visit

    expect(await clientCheckInAction(SLUG)).toEqual({ error: "You've already checked in today." });
  });

  it("joining a plan creates the membership the clinic manages, and cancelling ends it", async () => {
    const joined = await clientJoinPlanAction(SLUG, planId);
    expect(joined).toEqual({ ok: true, name: "Care Plan" });

    const membership = await db.customerMembership.findFirst({ where: { customerProfileId } });
    expect(membership!.status).toBe("ACTIVE");
    expect(membership!.membershipPlanId).toBe(planId);
    expect(membership!.tenantId).toBe(tenantId);

    expect(await clientJoinPlanAction(SLUG, planId)).toHaveProperty("error");

    expect(await clientCancelPlanAction(SLUG)).toEqual({ ok: true });
    const cancelled = await db.customerMembership.findFirst({ where: { id: membership!.id } });
    expect(cancelled!.status).toBe("CANCELLED");
  });

  it("profile edits made by the client show on the clinic's client record", async () => {
    const saved = await clientSaveProfileAction(SLUG, {
      firstName: "Rita",
      lastName: "Renamed",
      phone: "+31 6 1234 5678",
    });
    expect(saved).toEqual({ ok: true });

    const profile = await db.customerProfile.findFirst({ where: { id: customerProfileId } });
    expect(profile!.lastName).toBe("Renamed");
    expect(profile!.phone).toBe("+31 6 1234 5678");

    // A blank first name is rejected, not silently written.
    expect(await clientSaveProfileAction(SLUG, { firstName: "" })).toHaveProperty("error");
  });

  it("notification consent set in the app is stored against the tenant's record", async () => {
    const consent = { emailConsent: true, smsConsent: false, pushConsent: true, marketingConsent: true };
    expect(await clientSaveConsentAction(SLUG, consent)).toEqual({ ok: true });

    const profile = await db.customerProfile.findFirst({ where: { id: customerProfileId } });
    expect(profile!.emailConsent).toBe(true);
    expect(profile!.smsConsent).toBe(false);
    expect(profile!.pushConsent).toBe(true);
    expect(profile!.marketingConsent).toBe(true);
  });

  it("every row the client created carries this tenant's id", async () => {
    for (const rows of [
      await db.appointment.findMany({}),
      await db.order.findMany({}),
      await db.loyaltyTransaction.findMany({}),
      await db.customerMembership.findMany({}),
    ]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r: { tenantId: string }) => r.tenantId === tenantId)).toBe(true);
    }
  });
});
