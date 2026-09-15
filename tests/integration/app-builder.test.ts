import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);

const A = await import("@/lib/actions/app-builder");

const fd = (fields: Record<string, string | string[] | boolean | undefined>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === false) continue;
    if (v === true) f.set(k, "on");
    else if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
};

describe("App Builder actions", () => {
  let clinic: string;
  let rival: string;
  let ownerId: string;
  let agencyId: string;
  let catalogStaffId: string;
  let noRoleStaffId: string;
  let rivalOwnerId: string;
  let slug: string;

  const signIn = (who: "owner" | "agency" | "staff-catalog" | "staff-none" | "rival-owner") => {
    const map = {
      owner: { id: ownerId, role: "TENANT_ADMIN", tenantId: clinic, permissions: "ALL" },
      agency: { id: agencyId, role: "PLATFORM_ADMIN", tenantId: null, permissions: "ALL" },
      "staff-catalog": { id: catalogStaffId, role: "STAFF", tenantId: clinic, permissions: ["catalog.manage"] },
      "staff-none": { id: noRoleStaffId, role: "STAFF", tenantId: clinic, permissions: [] },
      "rival-owner": { id: rivalOwnerId, role: "TENANT_ADMIN", tenantId: rival, permissions: "ALL" },
    } as const;
    authMock.auth.mockResolvedValue({ user: { email: "x@example.com", name: "x", tenantSlug: null, staffProfileId: null, customerProfileId: null, ...map[who] } });
  };

  beforeAll(async () => {
    const stamp = Date.now();
    slug = `ab-${stamp}`;
    clinic = (await rawDb.tenant.create({ data: { slug, name: "Builder Clinic" } })).id;
    rival = (await rawDb.tenant.create({ data: { slug: `ab-rival-${stamp}`, name: "Rival" } })).id;
    ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `o-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    rivalOwnerId = (await rawDb.user.create({ data: { tenantId: rival, email: `ro-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    // Staff permissions are read from the database, so these need real profiles and roles.
    const catalogRole = await rawDb.role.create({ data: { tenantId: clinic, name: "Catalogue" } });
    const catalogPermission = await rawDb.permission.findUniqueOrThrow({ where: { key: "catalog.manage" } });
    await rawDb.rolePermission.create({ data: { roleId: catalogRole.id, permissionId: catalogPermission.id } });
    catalogStaffId = (await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: catalogStaffId, firstName: "Cat", lastName: "Staff", roleId: catalogRole.id } });
    noRoleStaffId = (await rawDb.user.create({ data: { tenantId: clinic, email: `n-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: noRoleStaffId, firstName: "No", lastName: "Role" } });
    agencyId = (await rawDb.user.create({ data: { email: `a-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
  });

  afterAll(async () => {
    for (const id of [clinic, rival]) await deleteTenantCompletely(id);
    await rawDb.user.deleteMany({ where: { id: { in: [agencyId] } } });
  });

  const service = (over: Record<string, string | boolean | undefined> = {}) =>
    fd({ name: "Consultation", categoryName: "General", durationMinutes: "45", price: "60", active: true, taxable: true, ...over });

  describe("services and products", () => {
    it("creates a service, with its category, visible to the client app's query", async () => {
      signIn("owner");
      const res = await A.saveServiceAction(clinic, null, service({ price: "59,50" }));
      expect(res).toMatchObject({ ok: true });
      const id = (res as { id: string }).id;

      // Exactly what app/app/[merchantSlug]/shop/page.tsx asks for.
      const visible = await rawDb.service.findMany({ where: { tenantId: clinic, active: true } });
      const created = visible.find((s) => s.id === id)!;
      expect(created.priceCents).toBe(5950);
      expect(created.durationMinutes).toBe(45);
      const cat = await rawDb.serviceCategory.findUnique({ where: { id: created.categoryId } });
      expect(cat!.name).toBe("General");
    });

    it("reuses an existing category regardless of capitalisation", async () => {
      signIn("owner");
      await A.saveServiceAction(clinic, null, service({ name: "Follow-up", categoryName: "general" }));
      expect(await rawDb.serviceCategory.count({ where: { tenantId: clinic } })).toBe(1);
    });

    it("returns per-field messages for bad input and writes nothing", async () => {
      signIn("owner");
      const before = await rawDb.service.count({ where: { tenantId: clinic } });
      const res = await A.saveServiceAction(clinic, null, service({ name: "", durationMinutes: "abc", price: "12.345" }));
      expect(res).toMatchObject({ error: expect.any(String) });
      const { fieldErrors } = res as { fieldErrors: Record<string, string> };
      expect(Object.keys(fieldErrors).sort()).toEqual(["durationMinutes", "name", "price"].sort());
      expect(await rawDb.service.count({ where: { tenantId: clinic } })).toBe(before);
    });

    it("refuses image URLs that could run script in the client app", async () => {
      signIn("owner");
      for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "http://insecure.example/x.png"]) {
        const res = await A.saveServiceAction(clinic, null, service({ imageUrl: bad }));
        expect((res as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty("imageUrl");
      }
      expect(await A.saveServiceAction(clinic, null, service({ name: "With image", imageUrl: "/uploads/abc.png" }))).toMatchObject({ ok: true });
    });

    it("records stock changes in the inventory ledger", async () => {
      signIn("owner");
      const created = await A.saveProductAction(clinic, null, fd({ name: "Serum", categoryName: "Care", price: "30", inventoryQuantity: "10", active: true }));
      const id = (created as { id: string }).id;
      await A.saveProductAction(clinic, id, fd({ name: "Serum", categoryName: "Care", price: "30", inventoryQuantity: "7", active: true }));

      const moves = await rawDb.inventoryTransaction.findMany({ where: { productId: id }, orderBy: { createdAt: "asc" } });
      expect(moves.map((m) => m.quantityChange)).toEqual([10, -3]);
      const product = await rawDb.product.findUnique({ where: { id } });
      expect(product!.inventoryQuantity).toBe(7);
      expect(product!.sku).toMatch(/^SKU-/);
    });

    it("rejects a duplicate SKU with a field message instead of crashing", async () => {
      signIn("owner");
      await A.saveProductAction(clinic, null, fd({ name: "A", categoryName: "Care", price: "1", sku: "DUP-1", active: true }));
      const res = await A.saveProductAction(clinic, null, fd({ name: "B", categoryName: "Care", price: "1", sku: "DUP-1", active: true }));
      expect((res as { fieldErrors: Record<string, string> }).fieldErrors.sku).toMatch(/already uses/);
    });
  });

  describe("who may do what", () => {
    it("lets an agency admin create in a clinic — impersonation is no longer read-only", async () => {
      signIn("agency");
      const res = await A.saveServiceAction(clinic, null, service({ name: "Made by agency" }));
      expect(res).toMatchObject({ ok: true });
      const log = await rawDb.auditLog.findFirst({ where: { tenantId: clinic, action: "service.created", actorUserId: agencyId } });
      expect(log!.actorType).toBe("PLATFORM_ADMIN");
    });

    it("gives staff only the tabs their role allows", async () => {
      signIn("staff-catalog");
      expect(await A.saveServiceAction(clinic, null, service({ name: "Staff made" }))).toMatchObject({ ok: true });
      expect(await A.saveRewardAction(clinic, null, fd({ name: "R", pointsCost: "10", rewardType: "DISCOUNT_PERCENT", discountPercent: "5" }))).toMatchObject({
        error: expect.stringMatching(/access/),
      });
      signIn("staff-none");
      expect(await A.saveServiceAction(clinic, null, service())).toMatchObject({ error: expect.stringMatching(/access/) });
    });

    it("cannot edit another clinic's item by passing its id under your own clinic", async () => {
      signIn("owner");
      const theirs = await rawDb.service.create({
        data: { tenantId: rival, name: "Rival service", durationMinutes: 30, priceCents: 100, categoryId: (await rawDb.serviceCategory.create({ data: { tenantId: rival, name: "R" } })).id },
      });
      const res = await A.saveServiceAction(clinic, theirs.id, service({ name: "Hijacked" }));
      expect(res).toMatchObject({ error: "That item no longer exists." });
      expect((await rawDb.service.findUnique({ where: { id: theirs.id } }))!.name).toBe("Rival service");

      expect(await A.archiveItemAction(clinic, "service", theirs.id)).toMatchObject({ error: "That item no longer exists." });
      expect(await A.getAppBuilderItemAction(clinic, "service", theirs.id)).toMatchObject({ error: expect.any(String) });
    });

    it("cannot act on another clinic at all", async () => {
      signIn("rival-owner");
      expect(await A.saveServiceAction(clinic, null, service())).toMatchObject({ error: expect.stringMatching(/access/) });
    });
  });

  describe("custom plans, offers, memberships, rewards", () => {
    it("builds a custom plan only from this clinic's treatments", async () => {
      signIn("owner");
      const mine = await rawDb.service.findFirst({ where: { tenantId: clinic } });
      const theirs = await rawDb.service.findFirst({ where: { tenantId: rival } });

      const bad = await A.savePackageAction(clinic, null, fd({ name: "Bundle", price: "200", totalUses: "5", serviceIds: [mine!.id, theirs!.id], active: true }));
      expect((bad as { fieldErrors: Record<string, string> }).fieldErrors.serviceIds).toBeDefined();

      const good = await A.savePackageAction(clinic, null, fd({ name: "Bundle", price: "200", totalUses: "5", serviceIds: [mine!.id], active: true }));
      const items = await rawDb.packageItem.findMany({ where: { packageId: (good as { id: string }).id } });
      expect(items.map((i) => i.serviceId)).toEqual([mine!.id]);
    });

    it("stores offers correctly and keeps codes unique per clinic only", async () => {
      signIn("owner");
      const offer = (over: Record<string, string>) =>
        fd({ title: "Spring", startAt: "2026-10-01T09:00", endAt: "2026-10-31T18:00", discountType: "FIXED_AMOUNT", discountValue: "12.50", code: "spring", active: true, ...over });

      const res = await A.savePromotionAction(clinic, null, offer({}));
      const saved = await rawDb.promotion.findUnique({ where: { id: (res as { id: string }).id } });
      expect(saved).toMatchObject({ code: "SPRING", discountValue: 1250 });

      expect((await A.savePromotionAction(clinic, null, offer({ title: "Again" })) as { fieldErrors: Record<string, string> }).fieldErrors.code).toMatch(/already uses/);
      expect((await A.savePromotionAction(clinic, null, offer({ endAt: "2026-09-01T00:00" })) as { fieldErrors: Record<string, string> }).fieldErrors.endAt).toBeDefined();
      expect((await A.savePromotionAction(clinic, null, offer({ discountType: "PERCENT", discountValue: "150", code: "X" })) as { fieldErrors: Record<string, string> }).fieldErrors.discountValue).toBeDefined();

      signIn("rival-owner");
      expect(await A.savePromotionAction(rival, null, offer({}))).toMatchObject({ ok: true });
    });

    it("protects members: no silent price change, no archiving a plan in use", async () => {
      signIn("owner");
      const plan = await A.saveMembershipPlanAction(clinic, null, fd({ name: "Gold", price: "49", billingFrequency: "MONTHLY", benefits: "Free consult\n10% off products", active: true }));
      const planId = (plan as { id: string }).id;
      expect(await rawDb.membershipBenefit.count({ where: { membershipPlanId: planId } })).toBe(2);

      const user = await rawDb.user.create({ data: { tenantId: clinic, email: `m-${Date.now()}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
      const profile = await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: user.id, firstName: "M", lastName: "B" } });
      await rawDb.customerMembership.create({ data: { tenantId: clinic, customerProfileId: profile.id, membershipPlanId: planId, currentPeriodEnd: new Date(Date.now() + 864e5) } });

      const repriced = await A.saveMembershipPlanAction(clinic, planId, fd({ name: "Gold", price: "59", billingFrequency: "MONTHLY", active: true }));
      expect((repriced as { fieldErrors: Record<string, string> }).fieldErrors.price).toMatch(/1 client is on this plan/);
      expect((await rawDb.membershipPlan.findUnique({ where: { id: planId } }))!.priceCents).toBe(4900);

      // Renaming is fine.
      expect(await A.saveMembershipPlanAction(clinic, planId, fd({ name: "Gold Plus", price: "49", billingFrequency: "MONTHLY", active: true }))).toMatchObject({ ok: true });

      expect(await A.archiveItemAction(clinic, "membershipPlan", planId)).toMatchObject({ error: expect.stringMatching(/still on this plan/) });
      expect(await A.setItemActiveAction(clinic, "membershipPlan", planId, false)).toMatchObject({ ok: true });
    });

    it("creates rewards, keeping only the fields for the chosen type", async () => {
      signIn("owner");
      const svc = await rawDb.service.findFirst({ where: { tenantId: clinic } });
      const res = await A.saveRewardAction(clinic, null, fd({ name: "Free consult", pointsCost: "500", rewardType: "FREE_SERVICE", serviceId: svc!.id, discountPercent: "20", active: true }));
      const reward = await rawDb.loyaltyReward.findUnique({ where: { id: (res as { id: string }).id } });
      expect(reward).toMatchObject({ rewardType: "FREE_SERVICE", serviceId: svc!.id, discountPercent: null });
      // The clinic had no loyalty programme; one was created to hold the reward.
      expect(await rawDb.loyaltyProgramme.count({ where: { tenantId: clinic } })).toBe(1);

      const missing = await A.saveRewardAction(clinic, null, fd({ name: "X", pointsCost: "10", rewardType: "FREE_PRODUCT" }));
      expect((missing as { fieldErrors: Record<string, string> }).fieldErrors.productId).toBeDefined();
    });
  });

  describe("hiding and archiving", () => {
    it("hides from the client app and archives out of App Builder, keeping the row", async () => {
      signIn("owner");
      const res = await A.saveServiceAction(clinic, null, service({ name: "Short-lived" }));
      const id = (res as { id: string }).id;

      await A.setItemActiveAction(clinic, "service", id, false);
      expect((await rawDb.service.findUnique({ where: { id } }))!.active).toBe(false);

      await A.archiveItemAction(clinic, "service", id);
      const row = await rawDb.service.findUnique({ where: { id } });
      expect(row!.archivedAt).not.toBeNull();

      // An archived item can no longer be edited.
      expect(await A.saveServiceAction(clinic, id, service({ name: "Back" }))).toMatchObject({ error: "That item no longer exists." });
    });
  });
});
