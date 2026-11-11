/**
 * The install nudge's server half: what gets remembered, who it belongs to,
 * and what the clinic's tally counts.
 *
 * The same shape as tests/integration/notification-prompt.test.ts, because it
 * is the same shape of feature.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const session = vi.hoisted(() => ({ current: null as { tenantId: string; customerProfileId: string; id: string } | null }));
vi.mock("@/lib/rbac", () => ({
  requireCustomerContext: async () => {
    if (!session.current) throw new Error("not signed in");
    const { getTenantDb: scoped } = await import("@/lib/tenant-db");
    return { db: scoped(session.current.tenantId), user: session.current };
  },
}));
let requestHost = "login.deza.ai";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-host": requestHost, "x-forwarded-proto": "https" }),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const { getNudgeHistory, getInstallStats, hasOpenedInstalled, recordInstallEvent } = await import("@/lib/install-nudge-data");
const { clientRecordInstallEventAction } = await import("@/lib/actions/client-app");

const stamp = Date.now();
const ORIGIN = "https://login.deza.ai";
const OTHER_ORIGIN = "https://app.clinicname.example";

describe("remembering what the install nudge did", () => {
  let tenantId: string;
  let otherTenantId: string;
  let alice: string;
  let bob: string;
  let stranger: string;

  const newClient = async (into: string, tag: string) => {
    const user = await rawDb.user.create({ data: { tenantId: into, email: `in-${tag}-${stamp}@example.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profile = await rawDb.customerProfile.create({ data: { tenantId: into, userId: user.id, firstName: tag, lastName: "Client" } });
    return profile.id;
  };
  const actAs = (customerProfileId: string, into = tenantId) => {
    session.current = { id: `user-${customerProfileId}`, tenantId: into, customerProfileId };
  };
  const db = () => getTenantDb(tenantId);

  const write = (customerProfileId: string, kind: "SHOWN" | "STARTED" | "ACCEPTED" | "OPENED" | "DISMISSED" | "NEVER", over: Partial<{ origin: string; stage: number; into: string }> = {}) =>
    recordInstallEvent(getTenantDb(over.into ?? tenantId), {
      tenantId: over.into ?? tenantId,
      customerProfileId,
      kind,
      os: "IOS",
      browser: "SAFARI",
      origin: over.origin ?? ORIGIN,
      stage: over.stage ?? 0,
    });

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug: `in-${stamp}`, name: "Install Clinic" } })).id;
    otherTenantId = (await rawDb.tenant.create({ data: { slug: `in-other-${stamp}`, name: "Other Install Clinic" } })).id;
    alice = await newClient(tenantId, "alice");
    bob = await newClient(tenantId, "bob");
    stranger = await newClient(otherTenantId, "stranger");
  });

  afterAll(async () => {
    session.current = null;
    for (const id of [tenantId, otherTenantId]) await deleteTenantCompletely(id).catch(() => undefined);
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: "install-event:" } } });
  });

  describe("what a client has already said", () => {
    it("is nothing at all to begin with", async () => {
      expect(await getNudgeHistory(db(), alice, ORIGIN)).toEqual({ dismissals: 0, lastDismissedAt: null, neverAgain: false });
    });

    it("counts the noes and remembers the last one", async () => {
      await write(alice, "DISMISSED", { stage: 0 });
      await write(alice, "DISMISSED", { stage: 1 });
      const history = await getNudgeHistory(db(), alice, ORIGIN);
      expect(history.dismissals).toBe(2);
      expect(Date.parse(history.lastDismissedAt!)).toBeGreaterThan(0);
    });

    it("does not count being shown, or installing, as a no", async () => {
      await write(alice, "SHOWN");
      await write(alice, "OPENED");
      expect((await getNudgeHistory(db(), alice, ORIGIN)).dismissals).toBe(2);
    });

    it("remembers don't-ask-again", async () => {
      expect((await getNudgeHistory(db(), bob, ORIGIN)).neverAgain).toBe(false);
      await write(bob, "NEVER");
      expect((await getNudgeHistory(db(), bob, ORIGIN)).neverAgain).toBe(true);
    });

    it("keeps one client's answers away from another's", async () => {
      const aliceHistory = await getNudgeHistory(db(), alice, ORIGIN);
      expect(aliceHistory.neverAgain).toBe(false);
      expect((await getNudgeHistory(db(), bob, ORIGIN)).dismissals).toBe(0);
    });

    it("treats the clinic's own domain as a different app from the shared one", async () => {
      // Two addresses, two icons, two storage areas: saying no on one says
      // nothing about the other.
      expect(await getNudgeHistory(db(), alice, OTHER_ORIGIN)).toEqual({ dismissals: 0, lastDismissedAt: null, neverAgain: false });
      expect(await getNudgeHistory(db(), bob, OTHER_ORIGIN)).toMatchObject({ neverAgain: false });
    });
  });

  describe("the action", () => {
    it("records what the browser reports, against the signed-in client", async () => {
      actAs(alice);
      expect(await clientRecordInstallEventAction(`in-${stamp}`, { kind: "STARTED", os: "ANDROID", browser: "CHROME", stage: 0 })).toEqual({ ok: true });
      const row = await rawDb.installPromptEvent.findFirstOrThrow({ where: { customerProfileId: alice, kind: "STARTED" } });
      expect(row).toMatchObject({ tenantId, os: "ANDROID", browser: "CHROME", origin: ORIGIN });
    });

    it("takes the address from the request, not from the caller", async () => {
      // A browser claiming an install on an address the client never visited
      // would silence the nudge there.
      actAs(alice);
      requestHost = "app.clinicname.example";
      try {
        await clientRecordInstallEventAction(`in-${stamp}`, { kind: "OPENED", os: "IOS", browser: "SAFARI", stage: 0 });
        const row = await rawDb.installPromptEvent.findFirstOrThrow({
          where: { customerProfileId: alice, kind: "OPENED", origin: OTHER_ORIGIN },
        });
        expect(row.origin).toBe(OTHER_ORIGIN);
      } finally {
        requestHost = "login.deza.ai";
      }
    });

    it("writes under the session's own clinic, whatever slug it is handed", async () => {
      actAs(stranger, otherTenantId);
      await clientRecordInstallEventAction(`in-${stamp}`, { kind: "SHOWN", os: "IOS", browser: "SAFARI", stage: 0 });
      const row = await rawDb.installPromptEvent.findFirstOrThrow({ where: { customerProfileId: stranger } });
      expect(row.tenantId).toBe(otherTenantId);
    });

    it("refuses a kind, an os or a browser it does not know, writing nothing", async () => {
      actAs(bob);
      const before = await rawDb.installPromptEvent.count({ where: { customerProfileId: bob } });
      for (const bad of [
        { kind: "INSTALLED", os: "IOS", browser: "SAFARI", stage: 0 },
        { kind: "SHOWN", os: "SYMBIAN", browser: "SAFARI", stage: 0 },
        { kind: "SHOWN", os: "IOS", browser: "NETSCAPE", stage: 0 },
        { kind: "SHOWN", os: "IOS", browser: "SAFARI", stage: -1 },
        { kind: "SHOWN", os: "IOS", browser: "SAFARI", stage: 99 },
      ]) {
        expect(await clientRecordInstallEventAction(`in-${stamp}`, bad as never), JSON.stringify(bad)).toEqual({ error: "invalid" });
      }
      expect(await rawDb.installPromptEvent.count({ where: { customerProfileId: bob } })).toBe(before);
    });
  });

  describe("the clinic's tally", () => {
    it("counts clients, not events", async () => {
      // Opening the installed app every morning is one install, not thirty.
      const keen = await newClient(tenantId, "keen");
      await write(keen, "OPENED");
      await write(keen, "OPENED");
      await write(keen, "OPENED");
      const stats = await getInstallStats(db());
      expect(stats.installed).toBeGreaterThanOrEqual(1);
      const everyone = await rawDb.installPromptEvent.count({ where: { tenantId, kind: "OPENED" } });
      expect(everyone).toBeGreaterThan(stats.installed);
    });

    it("counts a browser-reported install as an install too", async () => {
      const android = await newClient(tenantId, "android");
      await write(android, "ACCEPTED");
      const stats = await getInstallStats(db());
      const installedIds = await rawDb.installPromptEvent.findMany({
        where: { tenantId, kind: { in: ["OPENED", "ACCEPTED"] } },
        select: { customerProfileId: true },
        distinct: ["customerProfileId"],
      });
      expect(stats.installed).toBe(installedIds.length);
    });

    it("stays inside one clinic", async () => {
      await write(stranger, "SHOWN", { into: otherTenantId });
      const mine = await getInstallStats(db());
      const theirs = await getInstallStats(getTenantDb(otherTenantId));
      expect(theirs.shown).toBeGreaterThan(0);
      expect(theirs.installed).toBe(0);
      expect(mine.installed).toBeGreaterThan(0);
    });

    it("can be asked about a window of time", async () => {
      const future = new Date(Date.now() + 60_000);
      expect(await getInstallStats(db(), future)).toEqual({ shown: 0, started: 0, installed: 0 });
    });
  });

  it("knows whether this client has opened the installed app here", async () => {
    const fresh = await newClient(tenantId, "fresh");
    expect(await hasOpenedInstalled(db(), fresh, ORIGIN)).toBe(false);
    await write(fresh, "OPENED");
    expect(await hasOpenedInstalled(db(), fresh, ORIGIN)).toBe(true);
    // Opening it on one address says nothing about the other.
    expect(await hasOpenedInstalled(db(), fresh, OTHER_ORIGIN)).toBe(false);
  });

  it("goes with the clinic when the clinic is deleted", async () => {
    const temp = await rawDb.tenant.create({ data: { slug: `in-temp-${stamp}`, name: "Temp" } });
    const client = await newClient(temp.id, "temp");
    await write(client, "SHOWN", { into: temp.id });
    await deleteTenantCompletely(temp.id);
    expect(await rawDb.installPromptEvent.count({ where: { tenantId: temp.id } })).toBe(0);
  });
});
