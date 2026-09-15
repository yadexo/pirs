import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { mintCheckinToken } from "@/lib/checkin-token";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);

const C = await import("@/lib/actions/check-in");
const clientApp = await import("@/lib/actions/client-app");

describe("clinic check-in", () => {
  const stamp = Date.now();
  let clinic: string;
  let rival: string;
  let ownerId: string;
  let noRoleStaffId: string;
  let agencyId: string;
  let clientProfileId: string;
  let rivalClientProfileId: string;

  const as = (id: string, role: string, tenantId: string | null) =>
    authMock.auth.mockResolvedValue({ user: { id, email: "x@x.com", name: "x", role, tenantId, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" } });

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `ci-${stamp}`, name: "Check-in Clinic" } })).id;
    rival = (await rawDb.tenant.create({ data: { slug: `ci-rival-${stamp}`, name: "Rival" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Check-in Clinic", timeZone: "Europe/Amsterdam" } });
    await rawDb.loyaltyProgramme.create({ data: { tenantId: clinic, pointsPerVisit: 60 } });

    ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `o-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    agencyId = (await rawDb.user.create({ data: { email: `a-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
    noRoleStaffId = (await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: noRoleStaffId, firstName: "No", lastName: "Role" } });

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `mira-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Mira", lastName: "Visitor" } })).id;
    const ru = await rawDb.user.create({ data: { tenantId: rival, email: `rc-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    rivalClientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: rival, userId: ru.id, firstName: "Mira", lastName: "Elsewhere" } })).id;
  });

  afterAll(async () => {
    for (const id of [clinic, rival]) await deleteTenantCompletely(id);
    await rawDb.user.delete({ where: { id: agencyId } });
  });

  it("clients can no longer check themselves in", () => {
    expect("clientCheckInAction" in clientApp).toBe(false);
  });

  it("scans a client's code, shows who they are, and records one visit", async () => {
    as(ownerId, "TENANT_ADMIN", clinic);
    const token = mintCheckinToken(clinic, clientProfileId);

    const looked = await C.lookupClientForCheckInAction(clinic, { token });
    expect(looked).toMatchObject({ ok: true, client: { name: "Mira Visitor", checkedInToday: false, pointsPerVisit: 60 } });

    const done = await C.checkInClientAction(clinic, { token });
    expect(done).toMatchObject({ ok: true, points: 60, alreadyToday: false, client: { visits: 1, points: 60, checkedInToday: true } });

    const activity = await rawDb.activityEvent.findFirst({ where: { tenantId: clinic, type: "CHECK_IN" } });
    expect(activity).toMatchObject({ customerProfileId: clientProfileId, points: 60 });
    const audit = await rawDb.auditLog.findFirst({ where: { tenantId: clinic, action: "client.checked_in" } });
    expect(audit?.metadata).toMatchObject({ method: "scan", points: 60 });

    // The same day, again: no second visit, no second award.
    const again = await C.checkInClientAction(clinic, { token });
    expect(again).toMatchObject({ ok: true, points: 0, alreadyToday: true });
    const profile = await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } });
    expect(profile).toMatchObject({ visitCount: 1, loyaltyPointsBalance: 60 });
  });

  it("records one visit when two staff scan the same client at the same moment", async () => {
    as(ownerId, "TENANT_ADMIN", clinic);
    await rawDb.customerProfile.update({ where: { id: clientProfileId }, data: { lastVisitAt: new Date(Date.now() - 3 * 864e5) } });
    const token = mintCheckinToken(clinic, clientProfileId);
    const before = await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } });

    const results = await Promise.all([C.checkInClientAction(clinic, { token }), C.checkInClientAction(clinic, { token }), C.checkInClientAction(clinic, { token })]);
    expect(results.filter((r) => "ok" in r && !r.alreadyToday)).toHaveLength(1);

    const after = await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } });
    expect(after.visitCount).toBe(before.visitCount + 1);
    expect(after.loyaltyPointsBalance).toBe(before.loyaltyPointsBalance + 60);
  });

  it("refuses codes from another clinic, expired codes and forgeries", async () => {
    as(ownerId, "TENANT_ADMIN", clinic);
    const fromRival = mintCheckinToken(rival, rivalClientProfileId);
    const expired = mintCheckinToken(clinic, clientProfileId, Date.now() - 10 * 60_000);
    const forged = `${clinic}.${clientProfileId}.${Math.floor(Date.now() / 1000) + 60}.not-a-signature`;
    for (const token of [fromRival, expired, forged]) {
      expect(await C.checkInClientAction(clinic, { token })).toMatchObject({ error: expect.stringMatching(/isn't valid here/) });
    }
  });

  it("cannot check in another clinic's client by id", async () => {
    as(ownerId, "TENANT_ADMIN", clinic);
    expect(await C.checkInClientAction(clinic, { customerProfileId: rivalClientProfileId })).toMatchObject({ error: expect.stringMatching(/isn't registered/) });
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: rivalClientProfileId } })).visitCount).toBe(0);
  });

  it("finds clients by name or email within this clinic only", async () => {
    as(ownerId, "TENANT_ADMIN", clinic);
    const byName = await C.searchClientsForCheckInAction(clinic, "mira");
    expect(byName).toMatchObject({ ok: true, results: [{ name: "Mira Visitor" }] });
    const byEmail = await C.searchClientsForCheckInAction(clinic, `mira-${stamp}@`);
    expect((byEmail as { results: unknown[] }).results).toHaveLength(1);
    expect(await C.searchClientsForCheckInAction(clinic, "m")).toMatchObject({ ok: true, results: [] });
    // Full names, in either order, and names that don't match together.
    expect((await C.searchClientsForCheckInAction(clinic, "Mira Visitor")) as { results: unknown[] }).toMatchObject({ results: [{ name: "Mira Visitor" }] });
    expect((await C.searchClientsForCheckInAction(clinic, "visitor mira")) as { results: unknown[] }).toMatchObject({ results: [{ name: "Mira Visitor" }] });
    expect((await C.searchClientsForCheckInAction(clinic, "Mira Nobody")) as { results: unknown[] }).toMatchObject({ results: [] });
  });

  it("needs the customers.view permission; agency admins can always", async () => {
    as(noRoleStaffId, "STAFF", clinic);
    expect(await C.searchClientsForCheckInAction(clinic, "mira")).toMatchObject({ error: expect.stringMatching(/access/) });
    as(agencyId, "PLATFORM_ADMIN", null);
    expect(await C.searchClientsForCheckInAction(clinic, "mira")).toMatchObject({ ok: true });
  });
});
