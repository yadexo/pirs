import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

const push = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/lib/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/web-push")>();
  return { ...actual, notifyClientQuietly: (...args: unknown[]) => push.notify(...args) };
});

const { clientAccountAction, adjustClientCreditAction } = await import("@/lib/actions/client-account");

/**
 * Staff moving a client's account credit.
 *
 * This is somebody deciding something about another person's money, so the
 * tests are mostly about accountability: a reason is required, the staff
 * member is on the row, the audit log has it, and the client is told. The
 * arithmetic matters too — a balance must never go below zero.
 */
describe("a client's account credit", () => {
  const stamp = Date.now();
  let clinic: string;
  let staffUserId: string;
  let staffProfileId: string;
  let clientProfileId: string;
  let clientUserId: string;

  const asStaff = (permissions: "ALL" | string[] = "ALL", role: "TENANT_ADMIN" | "STAFF" = "TENANT_ADMIN", tenantId?: string) =>
    authMock.auth.mockResolvedValue({
      user: {
        id: staffUserId,
        email: `s-${stamp}@x.com`,
        name: "Sam Staff",
        role,
        tenantId: tenantId ?? clinic,
        tenantSlug: null,
        staffProfileId,
        customerProfileId: null,
        permissions,
      },
    });

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `acct-${stamp}`, name: "Account Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Account Clinic", currency: "EUR" } });

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Sam", lastName: "Staff" } })).id;

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientUserId = cu.id;
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Cara", lastName: "Client" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    asStaff();
    await rawDb.accountCreditTransaction.deleteMany({ where: { tenantId: clinic } });
    await rawDb.customerProfile.update({ where: { id: clientProfileId }, data: { accountCreditBalanceCents: 0 } });
  });

  it("adds credit, and records who decided it and why", async () => {
    const res = await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "25.50", reason: "Goodwill after a late appointment" });
    expect(res).toMatchObject({ ok: true, balanceCents: 2_550 });

    expect(await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).toMatchObject({ accountCreditBalanceCents: 2_550 });

    const row = await rawDb.accountCreditTransaction.findFirstOrThrow({ where: { tenantId: clinic } });
    expect(row).toMatchObject({
      amountCents: 2_550,
      balanceAfterCents: 2_550,
      type: "MANUAL_ADJUSTMENT",
      reason: "Goodwill after a late appointment",
      performedByStaffProfileId: staffProfileId,
    });
  });

  it("writes it to the audit log as well as the ledger", async () => {
    await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "10", reason: "Apology" });

    const audit = await rawDb.auditLog.findFirstOrThrow({ where: { tenantId: clinic, action: "credit.adjusted" } });
    expect(audit).toMatchObject({ entityType: "CustomerProfile", entityId: clientProfileId, actorUserId: staffUserId });
  });

  it("tells the client, with the reason the staff member gave", async () => {
    await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "10", reason: "Sorry about the wait" });

    expect(push.notify).toHaveBeenCalledTimes(1);
    const [userId, message] = push.notify.mock.calls[0] as [string, { body: string }];
    expect(userId).toBe(clientUserId);
    expect(message.body).toContain("Credit added");
    expect(message.body).toContain("Sorry about the wait");
  });

  it("takes credit back", async () => {
    await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "40", reason: "Goodwill" });

    expect(await adjustClientCreditAction(clinic, clientProfileId, { direction: "remove", amount: "15", reason: "Applied in person" })).toMatchObject({
      ok: true,
      balanceCents: 2_500,
    });
    const rows = await rawDb.accountCreditTransaction.findMany({ where: { tenantId: clinic }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.amountCents)).toEqual([4_000, -1_500]);
  });

  it("refuses to take more than the client has, and says how much that is", async () => {
    await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "10", reason: "Goodwill" });

    const res = await adjustClientCreditAction(clinic, clientProfileId, { direction: "remove", amount: "25", reason: "Too much" });
    expect(res).toMatchObject({ error: expect.stringContaining("10.00") });

    // Nothing moved, and nothing was written.
    expect(await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).toMatchObject({ accountCreditBalanceCents: 1_000 });
    expect(await rawDb.accountCreditTransaction.count({ where: { tenantId: clinic } })).toBe(1);
  });

  it("insists on a reason", async () => {
    const res = await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "10", reason: "  " });
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(await rawDb.accountCreditTransaction.count({ where: { tenantId: clinic } })).toBe(0);
  });

  it("insists on a real amount", async () => {
    for (const amount of ["0", "-5", "abc", ""]) {
      expect(await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount, reason: "Test" }), amount).toMatchObject({
        error: expect.any(String),
      });
    }
    expect(await rawDb.accountCreditTransaction.count({ where: { tenantId: clinic } })).toBe(0);
  });

  it("accepts a comma as a decimal point, which is how half of Europe types it", async () => {
    expect(await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "12,50", reason: "Goodwill" })).toMatchObject({
      balanceCents: 1_250,
    });
  });

  it("refuses a staff member who may not edit clients", async () => {
    const limited = await rawDb.user.create({ data: { tenantId: clinic, email: `l-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } });
    const role = await rawDb.role.create({ data: { tenantId: clinic, name: `Reception ${stamp}` } });
    const viewOnly = await rawDb.permission.upsert({
      where: { key: "customers.view" },
      create: { key: "customers.view", label: "View customers", category: "Customers" },
      update: {},
    });
    await rawDb.rolePermission.create({ data: { roleId: role.id, permissionId: viewOnly.id } });
    const profile = await rawDb.staffProfile.create({
      data: { tenantId: clinic, userId: limited.id, firstName: "Fran", lastName: "Desk", roleId: role.id },
    });

    authMock.auth.mockResolvedValue({
      user: {
        id: limited.id,
        email: limited.email,
        name: "Fran",
        role: "STAFF",
        tenantId: clinic,
        tenantSlug: null,
        staffProfileId: profile.id,
        customerProfileId: null,
        permissions: ["customers.view"],
      },
    });

    expect(await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "10", reason: "Nope" })).toMatchObject({
      error: expect.any(String),
    });
    expect(await rawDb.accountCreditTransaction.count({ where: { tenantId: clinic } })).toBe(0);

    // Reading is still allowed: the panel shows, the buttons do not.
    expect(await clientAccountAction(clinic, clientProfileId)).toMatchObject({ ok: true });
  });

  it("refuses another clinic's client", async () => {
    const other = await rawDb.tenant.create({ data: { slug: `acct-other-${stamp}`, name: "Other Clinic" } });
    try {
      asStaff("ALL", "TENANT_ADMIN", other.id);
      expect(await adjustClientCreditAction(other.id, clientProfileId, { direction: "add", amount: "10", reason: "Not mine" })).toMatchObject({
        error: expect.any(String),
      });
      expect(await rawDb.accountCreditTransaction.count({ where: { tenantId: clinic } })).toBe(0);
    } finally {
      await deleteTenantCompletely(other.id);
    }
  });

  it("shows the balance with the whole story behind it", async () => {
    await adjustClientCreditAction(clinic, clientProfileId, { direction: "add", amount: "30", reason: "Goodwill" });
    await adjustClientCreditAction(clinic, clientProfileId, { direction: "remove", amount: "10", reason: "Used in person" });

    const res = await clientAccountAction(clinic, clientProfileId);
    if ("error" in res) throw new Error(res.error);

    expect(res.account.creditCents).toBe(2_000);
    expect(res.account.credit).toHaveLength(2);
    // Newest first, each naming the staff member who decided it.
    expect(res.account.credit[0]).toMatchObject({ amountCents: -1_000, balanceAfterCents: 2_000, reason: "Used in person", by: "Sam Staff" });
    expect(res.account.credit[1]).toMatchObject({ amountCents: 3_000, balanceAfterCents: 3_000, by: "Sam Staff" });
  });
});
