import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));
const { authorizeCredentials } = await import("@/lib/auth-credentials");

describe("staff and client sign-in are separate", () => {
  const stamp = Date.now();
  let tenantId: string;
  const password = "Password123!";
  const admin = `aud-admin-${stamp}@x.com`;
  const client = `aud-client-${stamp}@x.com`;
  const slug = `aud-${stamp}`;

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Audience Clinic" } })).id;
    const passwordHash = await hashPassword(password);
    await rawDb.user.create({ data: { tenantId, email: admin, passwordHash, role: "TENANT_ADMIN" } });
    const u = await rawDb.user.create({ data: { tenantId, email: client, passwordHash, role: "CUSTOMER" } });
    await rawDb.customerProfile.create({ data: { tenantId, userId: u.id, firstName: "Cara", lastName: "Client" } });
  });

  afterAll(() => deleteTenantCompletely(tenantId));

  it("the staff session accepts clinic accounts only", async () => {
    expect(await authorizeCredentials({ portal: "clinic", email: admin, password }, "staff")).toMatchObject({ role: "TENANT_ADMIN", tenantSlug: slug });
    expect(await authorizeCredentials({ portal: "staff", email: admin, password }, "staff")).toMatchObject({ role: "TENANT_ADMIN", tenantSlug: slug });
    // No staff door looks at a client account, whichever one is used.
    for (const portal of ["clinic", "staff", "admin"]) {
      expect(await authorizeCredentials({ portal, email: client, password }, "staff")).toBeNull();
    }
    // And a client door can never issue a staff session.
    expect(await authorizeCredentials({ portal: "customer", tenantSlug: slug, email: client, password }, "staff")).toBeNull();
  });

  it("the client session accepts clients only, at a client door", async () => {
    expect(await authorizeCredentials({ portal: "customer", tenantSlug: slug, email: client, password }, "client")).toMatchObject({
      role: "CUSTOMER",
      tenantSlug: slug,
      customerProfileId: expect.any(String),
    });
    expect(await authorizeCredentials({ portal: "customer", tenantSlug: slug, email: admin, password }, "client")).toBeNull();
    expect(await authorizeCredentials({ portal: "customer", tenantSlug: slug, email: client, password: "wrong-password" }, "client")).toBeNull();
    // A staff door can never issue a client session, even for a real client.
    for (const portal of ["clinic", "staff", "admin"]) {
      expect(await authorizeCredentials({ portal, email: client, password }, "client")).toBeNull();
    }
  });
});
