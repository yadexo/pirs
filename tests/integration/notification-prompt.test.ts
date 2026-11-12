/**
 * The server half of the notifications prompt: what is remembered about a
 * client, what the clinic's tally counts, and the one rule that must survive
 * all of it — turning notifications on opts a client into offers only if they
 * have never decided about offers themselves.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { hashPassword } from "@/lib/password";

const rbacMocks = vi.hoisted(() => ({
  requireCustomerContext: vi.fn(),
  requireStaffContext: vi.fn(),
  requirePermission: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/rbac", () => rbacMocks);

// The route sends a welcome push after subscribing; the endpoints here are fake.
vi.mock("@/lib/web-push", () => ({
  vapidConfigured: () => true,
  vapidPublicKey: () => "test-public-key",
  notifyClientQuietly: vi.fn(async () => {}),
  sendToClient: vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { getPromptHistory, getPromptStats, recordPromptEvent } = await import("@/lib/notification-prompt-data");
const { clientRecordNotificationPromptAction } = await import("@/lib/actions/client-app");
const route = await import("@/app/api/push/route");

interface Client {
  userId: string;
  profileId: string;
}

describe("the notifications prompt, on the server", () => {
  const stamp = Date.now();
  let tenantId: string;
  let otherTenantId: string;
  let db: TenantDb;
  let otherDb: TenantDb;
  let slug: string;

  async function newClient(into: string, tag: string, profile: Record<string, unknown> = {}): Promise<Client> {
    const user = await rawDb.user.create({
      data: { tenantId: into, email: `${tag}-${stamp}@example.com`, passwordHash: await hashPassword("Password123!"), role: "CUSTOMER" },
    });
    const p = await rawDb.customerProfile.create({ data: { tenantId: into, userId: user.id, firstName: tag, lastName: "Client", ...profile } });
    return { userId: user.id, profileId: p.id };
  }

  function actAs(c: Client, tenant = tenantId, theDb = db) {
    rbacMocks.requireCustomerContext.mockResolvedValue({
      db: theDb,
      user: { id: c.userId, role: "CUSTOMER", tenantId: tenant, customerProfileId: c.profileId, permissions: [] },
    });
  }

  const subscribe = (endpoint: string, surface?: string, extra: Record<string, unknown> = {}) =>
    route.POST(
      new Request("http://localhost/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.1` },
        body: JSON.stringify({ action: "subscribe", endpoint, keys: { p256dh: "p", auth: "a" }, ...(surface ? { surface } : {}), ...extra }),
      }),
    );

  beforeAll(async () => {
    slug = `prompt-${stamp}`;
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Prompt Clinic" } })).id;
    otherTenantId = (await rawDb.tenant.create({ data: { slug: `${slug}-other`, name: "Other Clinic" } })).id;
    db = getTenantDb(tenantId);
    otherDb = getTenantDb(otherTenantId);
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
    await deleteTenantCompletely(otherTenantId);
  });

  describe("what is remembered about a client", () => {
    it("starts empty: a brand-new client has never been asked and has never decided", async () => {
      const c = await newClient(tenantId, "fresh");
      expect(await getPromptHistory(db, c.profileId)).toEqual({ declines: 0, lastDeclinedAt: null, offersDecided: false });
    });

    it("counts both kinds of no, with the time of the latest", async () => {
      const c = await newClient(tenantId, "declined");
      await recordPromptEvent(db, { tenantId, customerProfileId: c.profileId, kind: "NOT_NOW", surface: "SHEET", stage: 0 });
      const first = await getPromptHistory(db, c.profileId);
      expect(first.declines).toBe(1);

      await recordPromptEvent(db, { tenantId, customerProfileId: c.profileId, kind: "BLOCKED", surface: "CARD", stage: 1 });
      const second = await getPromptHistory(db, c.profileId);
      expect(second.declines).toBe(2);
      expect(Date.parse(second.lastDeclinedAt!)).toBeGreaterThanOrEqual(Date.parse(first.lastDeclinedAt!));
    });

    it("does not count being shown, or saying yes, as a no", async () => {
      const c = await newClient(tenantId, "shown");
      await recordPromptEvent(db, { tenantId, customerProfileId: c.profileId, kind: "SHOWN", surface: "SHEET", stage: 0 });
      await recordPromptEvent(db, { tenantId, customerProfileId: c.profileId, kind: "TURNED_ON", surface: "SHEET", stage: 0 });
      expect((await getPromptHistory(db, c.profileId)).declines).toBe(0);
    });

    it("keeps one client's answers out of another's", async () => {
      const a = await newClient(tenantId, "own-a");
      const b = await newClient(tenantId, "own-b");
      await recordPromptEvent(db, { tenantId, customerProfileId: a.profileId, kind: "NOT_NOW", surface: "SHEET", stage: 0 });
      expect((await getPromptHistory(db, b.profileId)).declines).toBe(0);
    });

    it("reports offers as decided only once the client has chosen for themselves", async () => {
      const undecided = await newClient(tenantId, "offers-undecided");
      const decided = await newClient(tenantId, "offers-decided", { marketingConsentChosenAt: new Date(), marketingConsentSource: "preferences" });
      expect((await getPromptHistory(db, undecided.profileId)).offersDecided).toBe(false);
      expect((await getPromptHistory(db, decided.profileId)).offersDecided).toBe(true);
    });
  });

  describe("being shown", () => {
    it("is written once per surface and step, however many times Home opens", async () => {
      const c = await newClient(tenantId, "once");
      const event = { tenantId, customerProfileId: c.profileId, kind: "SHOWN" as const, surface: "SHEET" as const, stage: 0 };
      expect(await recordPromptEvent(db, event)).toEqual({ recorded: true });
      expect(await recordPromptEvent(db, event)).toEqual({ recorded: false });
      expect(await recordPromptEvent(db, event)).toEqual({ recorded: false });
      expect(await rawDb.notificationPromptEvent.count({ where: { customerProfileId: c.profileId, kind: "SHOWN" } })).toBe(1);
    });

    it("is written again for the next step of the schedule", async () => {
      const c = await newClient(tenantId, "steps");
      const base = { tenantId, customerProfileId: c.profileId, kind: "SHOWN" as const, surface: "CARD" as const };
      expect((await recordPromptEvent(db, { ...base, stage: 1 })).recorded).toBe(true);
      expect((await recordPromptEvent(db, { ...base, stage: 2 })).recorded).toBe(true);
      expect(await rawDb.notificationPromptEvent.count({ where: { customerProfileId: c.profileId } })).toBe(2);
    });
  });

  describe("the browser's report", () => {
    it("records a decline, which the next read of the history sees", async () => {
      const c = await newClient(tenantId, "action");
      actAs(c);
      expect(await clientRecordNotificationPromptAction(slug, { kind: "NOT_NOW", surface: "SHEET", stage: 0 })).toEqual({ ok: true });
      expect((await getPromptHistory(db, c.profileId)).declines).toBe(1);
    });

    it("cannot claim that notifications were turned on — only a subscription can", async () => {
      const c = await newClient(tenantId, "forge");
      actAs(c);
      const forged = await clientRecordNotificationPromptAction(slug, { kind: "TURNED_ON", surface: "SHEET", stage: 0 } as never);
      expect(forged).toEqual({ error: "invalid" });
      expect(await rawDb.notificationPromptEvent.count({ where: { customerProfileId: c.profileId } })).toBe(0);
    });

    it("refuses a surface or step it doesn't know", async () => {
      const c = await newClient(tenantId, "junk");
      actAs(c);
      expect(await clientRecordNotificationPromptAction(slug, { kind: "NOT_NOW", surface: "NOWHERE" as never, stage: 0 })).toEqual({ error: "invalid" });
      expect(await clientRecordNotificationPromptAction(slug, { kind: "NOT_NOW", surface: "SHEET", stage: -1 })).toEqual({ error: "invalid" });
      expect(await clientRecordNotificationPromptAction(slug, { kind: "NOT_NOW", surface: "SHEET", stage: 99 })).toEqual({ error: "invalid" });
    });

    it("writes under the signed-in client's own clinic, whatever the page claims", async () => {
      const c = await newClient(otherTenantId, "elsewhere");
      actAs(c, otherTenantId, otherDb);
      // The slug in the call is only used to refresh a page; it picks no tenant.
      await clientRecordNotificationPromptAction(slug, { kind: "NOT_NOW", surface: "CARD", stage: 1 });
      const row = await rawDb.notificationPromptEvent.findFirstOrThrow({ where: { customerProfileId: c.profileId } });
      expect(row.tenantId).toBe(otherTenantId);
    });
  });

  describe("turning notifications on", () => {
    it("is recorded once per device, with where the client tapped", async () => {
      const c = await newClient(tenantId, "on-once");
      actAs(c);
      const endpoint = `https://push.example.test/${stamp}/on-once`;

      expect((await subscribe(endpoint, "SHEET")).status).toBe(200);
      // The same device saying it again — a page that re-registers, a second tap.
      expect((await subscribe(endpoint, "SHEET")).status).toBe(200);

      const rows = await rawDb.notificationPromptEvent.findMany({ where: { customerProfileId: c.profileId, kind: "TURNED_ON" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ surface: "SHEET", stage: 0 });
    });

    it("counts a second device as its own", async () => {
      const c = await newClient(tenantId, "on-two");
      actAs(c);
      await subscribe(`https://push.example.test/${stamp}/two-a`, "SETTINGS");
      await subscribe(`https://push.example.test/${stamp}/two-b`, "SETTINGS");
      expect(await rawDb.notificationPromptEvent.count({ where: { customerProfileId: c.profileId, kind: "TURNED_ON" } })).toBe(2);
    });

    it("notes how many times they had said no first", async () => {
      const c = await newClient(tenantId, "on-late");
      actAs(c);
      await recordPromptEvent(db, { tenantId, customerProfileId: c.profileId, kind: "NOT_NOW", surface: "SHEET", stage: 0 });
      await subscribe(`https://push.example.test/${stamp}/late`, "CARD");
      const row = await rawDb.notificationPromptEvent.findFirstOrThrow({ where: { customerProfileId: c.profileId, kind: "TURNED_ON" } });
      expect(row).toMatchObject({ surface: "CARD", stage: 1 });
    });

    it("falls back to the settings surface for a client that doesn't say", async () => {
      const c = await newClient(tenantId, "on-default");
      actAs(c);
      await subscribe(`https://push.example.test/${stamp}/default`);
      const row = await rawDb.notificationPromptEvent.findFirstOrThrow({ where: { customerProfileId: c.profileId, kind: "TURNED_ON" } });
      expect(row.surface).toBe("SETTINGS");
    });

    it("turning notifications on is not consent to offers", async () => {
      // docs/security/review-2026-11.md, N-2. This used to switch offers on
      // for anyone who had not decided, recorded as "push-opt-in".
      const c = await newClient(tenantId, "consent-new");
      actAs(c);
      await subscribe(`https://push.example.test/${stamp}/consent-new`, "SHEET");
      const after = await rawDb.customerProfile.findUniqueOrThrow({ where: { id: c.profileId } });
      expect(after).toMatchObject({ pushConsent: true, marketingConsent: false, marketingConsentSource: null });
      // Nothing was decided, so they can still be asked.
      expect(after.marketingConsentChosenAt).toBeNull();
    });

    it("offers are switched on only by the box on the prompt, ticked", async () => {
      const ticked = await newClient(tenantId, "consent-ticked");
      actAs(ticked);
      await subscribe(`https://push.example.test/${stamp}/consent-ticked`, "SHEET", { offers: true });
      const after = await rawDb.customerProfile.findUniqueOrThrow({ where: { id: ticked.profileId } });
      expect(after).toMatchObject({ pushConsent: true, marketingConsent: true, marketingConsentSource: "notifications-prompt" });
      expect(after.marketingConsentChosenAt).not.toBeNull();

      // An unticked box is not a decision either way.
      const unticked = await newClient(tenantId, "consent-unticked");
      actAs(unticked);
      await subscribe(`https://push.example.test/${stamp}/consent-unticked`, "CARD", { offers: false });
      expect(await rawDb.customerProfile.findUniqueOrThrow({ where: { id: unticked.profileId } })).toMatchObject({
        marketingConsent: false,
        marketingConsentChosenAt: null,
      });

      // And anything that is not a boolean is not a tick.
      const odd = await newClient(tenantId, "consent-odd");
      actAs(odd);
      const res = await subscribe(`https://push.example.test/${stamp}/consent-odd`, "SHEET", { offers: "true" });
      expect(res.status).toBe(400);
      expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: odd.profileId } })).marketingConsent).toBe(false);
    });

    it("never undoes a no the client once gave to offers", async () => {
      const chosenAt = new Date("2026-10-01T09:00:00Z");
      const c = await newClient(tenantId, "consent-no", {
        marketingConsent: false,
        marketingConsentChosenAt: chosenAt,
        marketingConsentSource: "preferences",
      });
      actAs(c);
      // Even with the box ticked: a choice made in Settings is never overridden from the prompt.
      await subscribe(`https://push.example.test/${stamp}/consent-no`, "SHEET", { offers: true });

      const after = await rawDb.customerProfile.findUniqueOrThrow({ where: { id: c.profileId } });
      // Push is on — that is what they just agreed to — but offers stay off.
      expect(after).toMatchObject({ pushConsent: true, marketingConsent: false, marketingConsentSource: "preferences" });
      expect(after.marketingConsentChosenAt?.toISOString()).toBe(chosenAt.toISOString());
    });
  });

  describe("the clinic's tally", () => {
    it("counts shown, turned on and declined for that clinic alone", async () => {
      const tallyTenant = (await rawDb.tenant.create({ data: { slug: `${slug}-tally`, name: "Tally Clinic" } })).id;
      try {
        const tallyDb = getTenantDb(tallyTenant);
        const a = await newClient(tallyTenant, "tally-a");
        const b = await newClient(tallyTenant, "tally-b");
        const rows: [string, "SHOWN" | "TURNED_ON" | "NOT_NOW" | "BLOCKED", "SHEET" | "CARD"][] = [
          [a.profileId, "SHOWN", "SHEET"],
          [b.profileId, "SHOWN", "SHEET"],
          [a.profileId, "NOT_NOW", "SHEET"],
          [b.profileId, "TURNED_ON", "SHEET"],
          [a.profileId, "SHOWN", "CARD"],
          [a.profileId, "BLOCKED", "CARD"],
        ];
        for (const [customerProfileId, kind, surface] of rows) {
          await recordPromptEvent(tallyDb, { tenantId: tallyTenant, customerProfileId, kind, surface, stage: surface === "CARD" ? 1 : 0 });
        }

        expect(await getPromptStats(tallyDb)).toEqual({ shown: 3, turnedOn: 1, declined: 2 });
        // Another clinic's tally knows nothing of it.
        const other = await getPromptStats(otherDb);
        expect(other.shown + other.turnedOn + other.declined).toBe(
          await rawDb.notificationPromptEvent.count({ where: { tenantId: otherTenantId } }),
        );
      } finally {
        await deleteTenantCompletely(tallyTenant);
      }
    });

    it("can be limited to a period", async () => {
      const c = await newClient(tenantId, "since");
      await recordPromptEvent(db, { tenantId, customerProfileId: c.profileId, kind: "NOT_NOW", surface: "SHEET", stage: 0 });
      const future = new Date(Date.now() + 60_000);
      expect(await getPromptStats(db, future)).toEqual({ shown: 0, turnedOn: 0, declined: 0 });
    });
  });

  it("is removed with the clinic, and with the client", async () => {
    const t = (await rawDb.tenant.create({ data: { slug: `${slug}-gone`, name: "Gone Clinic" } })).id;
    const c = await newClient(t, "gone");
    await recordPromptEvent(getTenantDb(t), { tenantId: t, customerProfileId: c.profileId, kind: "NOT_NOW", surface: "SHEET", stage: 0 });
    await deleteTenantCompletely(t);
    expect(await rawDb.notificationPromptEvent.count({ where: { tenantId: t } })).toBe(0);
  });
});
