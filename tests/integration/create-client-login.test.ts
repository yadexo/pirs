import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { createClientLogin } from "../../prisma/create-client-login";

describe("create-client-login script", () => {
  const stamp = Date.now();
  const slug = `cl-${stamp}`;
  const email = `Client-${stamp}@Example.com`;
  const db = rawDb as unknown as PrismaClient;
  let clinic: string;
  let suspended: string;
  let ownerEmail: string;

  beforeAll(async () => {
    clinic = (await rawDb.tenant.create({ data: { slug, name: "Client Login Clinic" } })).id;
    suspended = (await rawDb.tenant.create({ data: { slug: `cl-off-${stamp}`, name: "Closed Clinic", status: "SUSPENDED" } })).id;
    ownerEmail = `owner-${stamp}@example.com`;
    await rawDb.user.create({ data: { tenantId: clinic, email: ownerEmail, passwordHash: "x", role: "TENANT_ADMIN" } });
  });

  afterAll(async () => {
    for (const id of [clinic, suspended]) await deleteTenantCompletely(id);
  });

  it("creates a client who can sign in at that clinic", async () => {
    const result = await createClientLogin(db, { clinicSlug: slug.toUpperCase(), email, password: "a-long-enough-password" });
    expect(result).toMatchObject({ created: true, email: email.toLowerCase(), clinic: "Client Login Clinic" });

    const user = await rawDb.user.findFirstOrThrow({ where: { id: result.id }, include: { customerProfile: true } });
    expect(user).toMatchObject({ role: "CUSTOMER", tenantId: clinic, status: "ACTIVE" });
    expect(await verifyPassword("a-long-enough-password", user.passwordHash)).toBe(true);
    expect(user.customerProfile).toMatchObject({ firstName: "Test", lastName: "Client" });
  });

  it("resets the password when the client already exists, instead of failing", async () => {
    const now = new Date();
    const result = await createClientLogin(db, { clinicSlug: slug, email, password: "another-long-password" }, now);
    expect(result.created).toBe(false);
    const user = await rawDb.user.findFirstOrThrow({ where: { id: result.id } });
    expect(await verifyPassword("another-long-password", user.passwordHash)).toBe(true);
    expect(user.sessionsValidAfter?.getTime()).toBe(now.getTime());
    expect(await rawDb.user.count({ where: { tenantId: clinic, role: "CUSTOMER" } })).toBe(1);
  });

  it("refuses an unknown clinic, a suspended one, and a staff email", async () => {
    await expect(createClientLogin(db, { clinicSlug: "no-such-clinic", email: `x-${stamp}@example.com`, password: "a-long-enough-password" })).rejects.toThrow(/no clinic with the address/);
    await expect(createClientLogin(db, { clinicSlug: `cl-off-${stamp}`, email: `y-${stamp}@example.com`, password: "a-long-enough-password" })).rejects.toThrow(/SUSPENDED/);
    await expect(createClientLogin(db, { clinicSlug: slug, email: ownerEmail, password: "a-long-enough-password" })).rejects.toThrow(/already a TENANT_ADMIN/);
  });

  it("rejects short passwords and bad emails before touching the database", async () => {
    await expect(createClientLogin(db, { clinicSlug: slug, email: `z-${stamp}@example.com`, password: "short" })).rejects.toThrow(/at least 12/);
    await expect(createClientLogin(db, { clinicSlug: slug, email: "not-an-email", password: "a-long-enough-password" })).rejects.toThrow(/valid email/);
  });
});
