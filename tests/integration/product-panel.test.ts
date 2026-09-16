import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

const B = await import("@/lib/actions/app-builder");

/**
 * The clinic's product panel is the single source of truth: everything it
 * saves has to land on the record the client app reads, with no publish step.
 */
describe("clinic product panel", () => {
  const stamp = Date.now();
  let clinic: string;
  let rival: string;
  let ownerId: string;
  let practitionerId: string;
  let rivalPractitionerId: string;

  const asOwner = () =>
    authMock.auth.mockResolvedValue({
      user: { id: ownerId, email: "o@x.com", name: "o", role: "TENANT_ADMIN", tenantId: clinic, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `panel-${stamp}`, name: "Panel Clinic" } })).id;
    rival = (await rawDb.tenant.create({ data: { slug: `panel-rival-${stamp}`, name: "Rival" } })).id;
    ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `po-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;

    const staffUser = await rawDb.user.create({ data: { tenantId: clinic, email: `ps-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } });
    practitionerId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: staffUser.id, firstName: "Nadia", lastName: "Haddad", title: "Nurse practitioner", bio: "Ten years of injectables." } })).id;

    const rivalUser = await rawDb.user.create({ data: { tenantId: rival, email: `rs-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } });
    rivalPractitionerId = (await rawDb.staffProfile.create({ data: { tenantId: rival, userId: rivalUser.id, firstName: "Someone", lastName: "Else" } })).id;
  });

  afterAll(async () => {
    for (const id of [clinic, rival]) await deleteTenantCompletely(id);
  });

  it("saves every optional field the clinic filled in, and reads it back for editing", async () => {
    asOwner();
    const created = await B.saveServiceAction(
      clinic,
      null,
      form({
        name: "Skin booster",
        categoryName: "Injectables",
        description: "A hydrating treatment.",
        price: "180",
        durationMinutes: "45",
        unitLabel: "session",
        schedulingUrl: "https://booking.example.com/skin-booster",
        maxQuantity: "3",
        practitionerId,
        prepInstructions: "No alcohol 24h before.",
        aftercareInstructions: "No make-up for 12 hours.",
        requiresConsultation: "on",
        consultationNotice: "We speak with you first.",
        cashBalanceBlocked: "on",
        active: "on",
        taxable: "on",
        pricingOptions: JSON.stringify({
          bundles: [{ label: "Course of three", quantity: 3, priceCents: 45000 }],
          variations: [{ name: "Full face", priceCents: 22000 }],
        }),
        tags: JSON.stringify([
          { name: "No downtime", icon: "clock", description: "Back to work the same day." },
          { name: "Popular", icon: "star", description: "" },
        ]),
        clientResults: JSON.stringify([
          { beforeImageUrl: "/uploads/before1.png", afterImageUrl: "/uploads/after1.png", testimonial: "My skin looks calmer." },
          { testimonial: "Worth it." },
        ]),
      }),
    );
    expect(created).toMatchObject({ ok: true });
    const id = (created as { id: string }).id;

    const saved = await rawDb.service.findUniqueOrThrow({ where: { id }, include: { itemTags: { include: { tag: true } }, clientResults: { orderBy: { sortOrder: "asc" } } } });
    expect(saved).toMatchObject({
      name: "Skin booster",
      durationMinutes: 45,
      unitLabel: "session",
      schedulingUrl: "https://booking.example.com/skin-booster",
      maxQuantity: 3,
      practitionerId,
      requiresConsultation: true,
      consultationNotice: "We speak with you first.",
      cashBalanceBlocked: true,
      prepInstructions: "No alcohol 24h before.",
      aftercareInstructions: "No make-up for 12 hours.",
    });
    expect(saved.pricingOptions).toMatchObject({ bundles: [{ quantity: 3, priceCents: 45000 }], variations: [{ name: "Full face", priceCents: 22000 }] });
    expect(saved.itemTags.map((t) => [t.tag.name, t.tag.icon])).toEqual([
      ["No downtime", "clock"],
      ["Popular", "star"],
    ]);
    expect(saved.clientResults.map((r) => r.testimonial)).toEqual(["My skin looks calmer.", "Worth it."]);

    // Editing loads exactly what was saved, tags and results included.
    const loaded = await B.getAppBuilderItemAction(clinic, "service", id);
    expect(loaded).toMatchObject({ ok: true });
    const item = (loaded as { item: Record<string, unknown> }).item;
    expect((item.itemTags as unknown[]).length).toBe(2);
    expect((item.clientResults as unknown[]).length).toBe(2);
  });

  it("replaces tags and results on the next save, and clears what was removed", async () => {
    asOwner();
    const created = await B.saveProductAction(
      clinic,
      null,
      form({
        name: "Serum",
        categoryName: "Skincare",
        price: "60",
        inventoryQuantity: "5",
        tags: JSON.stringify([{ name: "Popular", icon: "star", description: "Best seller." }]),
        clientResults: JSON.stringify([{ testimonial: "Lovely." }]),
        active: "on",
        taxable: "on",
      }),
    );
    const id = (created as { id: string }).id;

    await B.saveProductAction(
      clinic,
      id,
      form({ name: "Serum", categoryName: "Skincare", price: "60", inventoryQuantity: "5", tags: "[]", clientResults: "[]", active: "on", taxable: "on" }),
    );
    const after = await rawDb.product.findUniqueOrThrow({ where: { id }, include: { itemTags: true, clientResults: true } });
    expect(after.itemTags).toHaveLength(0);
    expect(after.clientResults).toHaveLength(0);
    // The tag itself survives for reuse by other products.
    expect(await rawDb.catalogTag.count({ where: { tenantId: clinic, name: "Popular" } })).toBe(1);
  });

  it("refuses a practitioner from another clinic", async () => {
    asOwner();
    const res = await B.saveServiceAction(
      clinic,
      null,
      form({ name: "Borrowed", categoryName: "Injectables", price: "100", practitionerId: rivalPractitionerId, active: "on", taxable: "on" }),
    );
    expect(res).toMatchObject({ fieldErrors: { practitionerId: expect.stringMatching(/no longer works here/) } });
  });

  it("rejects a scheduling link that isn't a web address", async () => {
    asOwner();
    const res = await B.saveServiceAction(
      clinic,
      null,
      form({ name: "Bad link", categoryName: "Injectables", price: "100", schedulingUrl: "javascript:alert(1)", active: "on", taxable: "on" }),
    );
    expect(res).toMatchObject({ fieldErrors: { schedulingUrl: expect.stringMatching(/https/) } });
  });

  it("keeps a product sellable when the clinic fills in nothing optional", async () => {
    asOwner();
    const res = await B.saveProductAction(clinic, null, form({ name: "Plain", categoryName: "Skincare", price: "25", inventoryQuantity: "1", active: "on", taxable: "on" }));
    expect(res).toMatchObject({ ok: true });
    const saved = await rawDb.product.findUniqueOrThrow({ where: { id: (res as { id: string }).id } });
    expect(saved).toMatchObject({ durationMinutes: null, unitLabel: null, maxQuantity: null, requiresConsultation: false, cashBalanceBlocked: false, practitionerId: null, pricingOptions: null });
  });
});
