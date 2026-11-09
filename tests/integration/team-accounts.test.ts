/**
 * Employee accounts: who an owner can switch off, what that does to a session
 * already open, and what the clinic can never be left without.
 *
 * The invite flow, the role/permission matrix and the cross-clinic rules are
 * covered by clinic-settings.test.ts and merchant-action.test.ts; this is
 * about the account controls themselves.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));
vi.mock("@/lib/providers/notifications", () => ({ getEmailProvider: () => ({ send: async () => ({ status: "SENT" }) }) }));

const S = await import("@/lib/actions/clinic-settings");
const { loadLiveAccount } = await import("@/lib/live-account");

describe("team accounts", () => {
  const stamp = Date.now();
  let clinic: string;
  let otherClinic: string;
  let ownerId: string;
  let ownerProfileId: string;
  let coOwnerId: string;
  let coOwnerProfileId: string;
  let staffId: string;
  let staffProfileId: string;
  let outsiderProfileId: string;

  const asOwner = (id = ownerId) =>
    authMock.auth.mockResolvedValue({
      user: { id, email: "o@x.com", name: "o", role: "TENANT_ADMIN", tenantId: clinic, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL", authTime: Date.now() },
    });

  const member = async (tenantId: string, role: "TENANT_ADMIN" | "STAFF", name: string) => {
    const user = await rawDb.user.create({ data: { tenantId, email: `${name}-${stamp}@x.com`, passwordHash: "x", role } });
    const profile = await rawDb.staffProfile.create({ data: { tenantId, userId: user.id, firstName: name, lastName: "Person" } });
    return { userId: user.id, profileId: profile.id };
  };

  beforeAll(async () => {
    clinic = (await rawDb.tenant.create({ data: { slug: `team-${stamp}`, name: "Team Clinic" } })).id;
    otherClinic = (await rawDb.tenant.create({ data: { slug: `team-other-${stamp}`, name: "Other Team Clinic" } })).id;
    ({ userId: ownerId, profileId: ownerProfileId } = await member(clinic, "TENANT_ADMIN", "owner"));
    ({ userId: coOwnerId, profileId: coOwnerProfileId } = await member(clinic, "TENANT_ADMIN", "coowner"));
    ({ userId: staffId, profileId: staffProfileId } = await member(clinic, "STAFF", "staff"));
    ({ profileId: outsiderProfileId } = await member(otherClinic, "STAFF", "outsider"));
  });

  afterAll(async () => {
    for (const id of [clinic, otherClinic]) await deleteTenantCompletely(id).catch(() => undefined);
    await rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "team-invite:" } }, { key: { startsWith: "team-write:" } }] } });
  });

  beforeEach(async () => {
    asOwner();
    await rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "team-invite:" } }, { key: { startsWith: "team-write:" } }] } });
  });

  /** Put everyone back on, without going through the actions. */
  const restore = async () => {
    await rawDb.staffProfile.updateMany({ where: { tenantId: clinic }, data: { active: true, deactivatedAt: null } });
    await rawDb.user.updateMany({ where: { tenantId: clinic }, data: { sessionsValidAfter: null } });
  };

  describe("switching an account off", () => {
    it("ends a session that is already open, not just the next sign-in", async () => {
      const sessionStarted = Date.now();
      expect(await loadLiveAccount(staffId, sessionStarted)).not.toBeNull();

      expect(await S.setStaffActiveAction(clinic, staffProfileId, false)).toMatchObject({ ok: true });
      expect(await loadLiveAccount(staffId, sessionStarted)).toBeNull();
      const user = await rawDb.user.findUniqueOrThrow({ where: { id: staffId } });
      expect(user.sessionsValidAfter).not.toBeNull();
      await restore();
    });

    it("works on an owner, whose access the profile flag alone would not stop", async () => {
      const sessionStarted = Date.now();
      // An owner's permissions do not come from the staff profile, so without
      // the session cut-off a deactivated owner would keep working.
      expect(await S.setStaffActiveAction(clinic, coOwnerProfileId, false)).toMatchObject({ ok: true });
      expect(await loadLiveAccount(coOwnerId, sessionStarted)).toBeNull();
      await restore();
    });

    it("refuses your own account", async () => {
      expect(await S.setStaffActiveAction(clinic, ownerProfileId, false)).toMatchObject({ error: expect.stringMatching(/your own access/i) });
      expect((await rawDb.staffProfile.findUniqueOrThrow({ where: { id: ownerProfileId } })).active).toBe(true);
    });

    it("refuses the last active owner, so a clinic is never left without one", async () => {
      // Switch the co-owner off first; the remaining owner is then the last.
      expect(await S.setStaffActiveAction(clinic, coOwnerProfileId, false)).toMatchObject({ ok: true });
      // Acting as the co-owner (now off) is not how this is reached in the UI,
      // so act as the owner on the only other owner there is: themselves.
      asOwner(coOwnerId);
      expect(await S.setStaffActiveAction(clinic, ownerProfileId, false)).toMatchObject({
        error: expect.stringMatching(/at least one active owner/i),
      });
      expect((await rawDb.staffProfile.findUniqueOrThrow({ where: { id: ownerProfileId } })).active).toBe(true);
      await restore();
    });

    it("holds when two owners switch each other off at the same moment", async () => {
      // The case the count is really for. Both read "one will be left" and
      // both are right until the other commits, so the check has to lock the
      // clinic's active owners and hold that lock through the write.
      const actors = [ownerId, coOwnerId];
      authMock.auth.mockImplementation(async () => ({
        user: {
          id: actors.shift() ?? ownerId,
          email: "o@x.com",
          name: "o",
          role: "TENANT_ADMIN",
          tenantId: clinic,
          tenantSlug: null,
          staffProfileId: null,
          customerProfileId: null,
          permissions: "ALL",
          authTime: Date.now(),
        },
      }));

      const results = await Promise.all([
        S.setStaffActiveAction(clinic, coOwnerProfileId, false),
        S.setStaffActiveAction(clinic, ownerProfileId, false),
      ]);

      expect(results.filter((r) => "ok" in r).length).toBeLessThanOrEqual(1);
      // Whatever either call was told, this is the invariant.
      const ownersLeft = await rawDb.user.count({
        where: { tenantId: clinic, role: "TENANT_ADMIN", status: "ACTIVE", staffProfile: { active: true } },
      });
      expect(ownersLeft).toBeGreaterThanOrEqual(1);
      await restore();
    });

    it("leaves the session cut-off alone when switching back on", async () => {
      await S.setStaffActiveAction(clinic, staffProfileId, false);
      const after = (await rawDb.user.findUniqueOrThrow({ where: { id: staffId } })).sessionsValidAfter;
      expect(await S.setStaffActiveAction(clinic, staffProfileId, true)).toMatchObject({ ok: true });
      // Clearing it would resurrect the sessions this just ended — and undo a
      // password reset's own cut-off along with them.
      expect((await rawDb.user.findUniqueOrThrow({ where: { id: staffId } })).sessionsValidAfter).toEqual(after);
      expect((await rawDb.staffProfile.findUniqueOrThrow({ where: { id: staffProfileId } })).active).toBe(true);
      await restore();
    });

    it("cannot reach a team member at another clinic", async () => {
      expect(await S.setStaffActiveAction(clinic, outsiderProfileId, false)).toMatchObject({ error: expect.any(String) });
      expect((await rawDb.staffProfile.findUniqueOrThrow({ where: { id: outsiderProfileId } })).active).toBe(true);
    });
  });

  describe("rights", () => {
    it("refuses to give an owner a role, which would change nothing", async () => {
      const role = await rawDb.role.create({ data: { tenantId: clinic, name: `Role ${stamp}` } });
      expect(await S.setStaffRoleAction(clinic, coOwnerProfileId, role.id)).toMatchObject({
        error: expect.stringMatching(/already has full access/i),
      });
      expect((await rawDb.staffProfile.findUniqueOrThrow({ where: { id: coOwnerProfileId } })).roleId).toBeNull();
    });

    it("records who changed what", async () => {
      const role = await rawDb.role.create({ data: { tenantId: clinic, name: `Audited ${stamp}` } });
      expect(await S.setStaffRoleAction(clinic, staffProfileId, role.id)).toMatchObject({ ok: true });
      const audit = await rawDb.auditLog.findFirstOrThrow({
        where: { tenantId: clinic, action: "staff.role_changed", entityId: staffProfileId },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toMatchObject({ actorUserId: ownerId, actorType: "STAFF" });
      expect(audit.metadata).toMatchObject({ roleId: role.id });
    });

    it("records a deactivation with the role it applied to", async () => {
      await S.setStaffActiveAction(clinic, staffProfileId, false);
      const audit = await rawDb.auditLog.findFirstOrThrow({
        where: { tenantId: clinic, action: "staff.deactivated", entityId: staffProfileId },
        orderBy: { createdAt: "desc" },
      });
      expect(audit.metadata).toMatchObject({ userId: staffId, role: "STAFF" });
      await restore();
    });
  });

  describe("how much one person may change in an hour", () => {
    it("stops a run of invitations", async () => {
      const fd = (n: number) => {
        const f = new FormData();
        f.set("firstName", "Many");
        f.set("lastName", `Invite${n}`);
        f.set("email", `many-${stamp}-${n}@x.com`);
        return f;
      };
      let last: unknown;
      for (let i = 0; i < 25; i++) {
        last = await S.inviteStaffAction(clinic, fd(i));
        if (last && typeof last === "object" && "error" in last) break;
      }
      expect(last).toMatchObject({ error: expect.stringMatching(/a lot of invitations/i) });
      await rawDb.user.deleteMany({ where: { email: { startsWith: `many-${stamp}-` } } });
    }, 60000);

    it("stops a run of rights changes", async () => {
      let last: unknown;
      for (let i = 0; i < 65; i++) {
        last = await S.setStaffRoleAction(clinic, staffProfileId, null);
        if (last && typeof last === "object" && "error" in last) break;
      }
      expect(last).toMatchObject({ error: expect.stringMatching(/a lot of changes/i) });
    }, 60000);
  });
});
