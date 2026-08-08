import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";

describe("tenant isolation", () => {
  let tenantA: { id: string };
  let tenantB: { id: string };
  let serviceA: { id: string };
  let serviceB: { id: string };

  beforeAll(async () => {
    tenantA = await rawDb.tenant.create({ data: { slug: `test-tenant-a-${Date.now()}`, name: "Test Tenant A" } });
    tenantB = await rawDb.tenant.create({ data: { slug: `test-tenant-b-${Date.now()}`, name: "Test Tenant B" } });

    const catA = await rawDb.serviceCategory.create({ data: { tenantId: tenantA.id, name: "Category A" } });
    const catB = await rawDb.serviceCategory.create({ data: { tenantId: tenantB.id, name: "Category B" } });

    serviceA = await rawDb.service.create({
      data: { tenantId: tenantA.id, categoryId: catA.id, name: "Service A", durationMinutes: 30, priceCents: 5000 },
    });
    serviceB = await rawDb.service.create({
      data: { tenantId: tenantB.id, categoryId: catB.id, name: "Service B", durationMinutes: 30, priceCents: 5000 },
    });
  });

  afterAll(async () => {
    await rawDb.tenant.delete({ where: { id: tenantA.id } });
    await rawDb.tenant.delete({ where: { id: tenantB.id } });
  });

  it("only returns the bound tenant's rows from findMany", async () => {
    const dbA = getTenantDb(tenantA.id);
    const services = await dbA.service.findMany({});
    expect(services.map((s) => s.id)).toEqual([serviceA.id]);
    expect(services.map((s) => s.id)).not.toContain(serviceB.id);
  });

  it("cannot read another tenant's row by id via findFirst", async () => {
    const dbA = getTenantDb(tenantA.id);
    const result = await dbA.service.findFirst({ where: { id: serviceB.id } });
    expect(result).toBeNull();
  });

  it("cannot mutate another tenant's row via updateMany", async () => {
    const dbA = getTenantDb(tenantA.id);
    const result = await dbA.service.updateMany({ where: { id: serviceB.id }, data: { name: "Hijacked" } });
    expect(result.count).toBe(0);

    const untouched = await rawDb.service.findUnique({ where: { id: serviceB.id } });
    expect(untouched?.name).toBe("Service B");
  });

  it("cannot delete another tenant's row via deleteMany", async () => {
    const dbA = getTenantDb(tenantA.id);
    const result = await dbA.service.deleteMany({ where: { id: serviceB.id } });
    expect(result.count).toBe(0);

    const stillThere = await rawDb.service.findUnique({ where: { id: serviceB.id } });
    expect(stillThere).not.toBeNull();
  });

  it("auto-scopes created rows to the bound tenant", async () => {
    const dbA = getTenantDb(tenantA.id);
    const catA = await rawDb.serviceCategory.findFirst({ where: { tenantId: tenantA.id } });
    const created = await dbA.service.create({
      data: { categoryId: catA!.id, name: "Auto-scoped Service", durationMinutes: 15, priceCents: 1000 } as never,
    });
    expect(created.tenantId).toBe(tenantA.id);
  });

  it("refuses raw findUnique on a tenant-scoped model (must use findFirst)", async () => {
    const dbA = getTenantDb(tenantA.id);
    await expect(dbA.service.findUnique({ where: { id: serviceA.id } })).rejects.toThrow(/Refusing to run unscoped/);
  });
});
