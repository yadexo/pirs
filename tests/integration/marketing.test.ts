import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const sent: { userId: string; title: string }[] = [];
vi.mock("@/lib/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/web-push")>();
  return {
    ...actual,
    // One device per client, always accepted: this file is about the rules,
    // not about talking to a push service.
    sendToClient: async (userId: string, message: { title: string }) => {
      sent.push({ userId, title: message.title });
      return { sent: 1, removed: 0, failed: 0 };
    },
    notifyClientQuietly: async () => {},
  };
});

const { sendMarketingTo, sentTodayCount, marketingAudience } = await import("@/lib/marketing");
const { runMarketing } = await import("@/lib/cron/marketing");
const { resolveDiscount, candidatesFor } = await import("@/lib/discounts");

/**
 * The rules a clinic could otherwise talk itself out of: consent, the quiet
 * hours, one marketing message a day, one birthday a year — and a discount
 * that is decided by the server whatever the browser says.
 */
describe("discounts and marketing", () => {
  const stamp = Date.now();
  let clinic: string;
  let otherClinic: string;
  let client: { profileId: string; userId: string };
  let quiet: { profileId: string; userId: string };
  let productId: string;
  let categoryId: string;

  /** 10:00 Amsterdam, well inside the sendable window. */
  const daytime = new Date("2026-07-01T08:00:00Z");
  /** 23:00 Amsterdam. */
  const night = new Date("2026-07-01T21:00:00Z");

  async function makeClient(prefix: string, opts: { consent?: boolean; dob?: Date | null } = {}) {
    const user = await rawDb.user.create({
      data: { tenantId: clinic, email: `${prefix}-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" },
    });
    const profile = await rawDb.customerProfile.create({
      data: {
        tenantId: clinic,
        userId: user.id,
        firstName: "Cara",
        lastName: prefix,
        marketingConsent: opts.consent ?? true,
        dateOfBirth: opts.dob ?? null,
      },
    });
    // Every test client has a device, so "no-devices" never hides a result.
    await rawDb.pushSubscription.create({
      data: { tenantId: clinic, userId: user.id, endpoint: `https://push.example/${prefix}-${stamp}`, p256dh: "k", auth: "a" },
    });
    return { profileId: profile.id, userId: user.id };
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `mkt-${stamp}`, name: "Marketing Clinic" } })).id;
    otherClinic = (await rawDb.tenant.create({ data: { slug: `mkt-other-${stamp}`, name: "Other Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Marketing Clinic", currency: "EUR" } });

    client = await makeClient("c1");
    quiet = await makeClient("c2", { consent: false });

    const category = await rawDb.productCategory.create({ data: { tenantId: clinic, name: "Skincare" } });
    categoryId = category.id;
    productId = (
      await rawDb.product.create({
        data: { tenantId: clinic, categoryId, name: "Serum", priceCents: 10_000, sku: `SER-${stamp}`, inventoryQuantity: 9 },
      })
    ).id;
  });

  afterAll(async () => {
    for (const id of [clinic, otherClinic]) await deleteTenantCompletely(id);
  });

  beforeEach(async () => {
    sent.length = 0;
    await rawDb.notificationDelivery.deleteMany({ where: { tenantId: clinic } });
    await rawDb.notificationCampaign.deleteMany({ where: { tenantId: clinic } });
    await rawDb.birthdayGreeting.deleteMany({ where: { tenantId: clinic } });
    await rawDb.promotion.deleteMany({ where: { tenantId: clinic } });
  });

  // -------------------------------------------------------------- consent --

  it("sends to a client who wants offers", async () => {
    const outcome = await sendMarketingTo(
      { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true },
      { tenantId: clinic, now: daytime, message: { title: "Sale", body: "20% off" } },
    );
    expect(outcome).toMatchObject({ sent: 1, skipped: null });
    expect(sent).toHaveLength(1);
  });

  it("refuses a client who has offers switched off", async () => {
    const outcome = await sendMarketingTo(
      { customerProfileId: quiet.profileId, userId: quiet.userId, marketingConsent: false },
      { tenantId: clinic, now: daytime, message: { title: "Sale", body: "20% off" } },
    );
    expect(outcome).toMatchObject({ sent: 0, skipped: "no-consent" });
    expect(sent).toHaveLength(0);
  });

  it("leaves a client without consent out of the audience entirely", async () => {
    const audience = await marketingAudience(clinic);
    expect(audience.map((a) => a.customerProfileId)).toContain(client.profileId);
    expect(audience.map((a) => a.customerProfileId)).not.toContain(quiet.profileId);
  });

  // ---------------------------------------------------------- quiet hours --

  it("holds a message that would land at 23:00", async () => {
    const outcome = await sendMarketingTo(
      { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true },
      { tenantId: clinic, now: night, message: { title: "Sale", body: "20% off" } },
    );
    expect(outcome).toMatchObject({ sent: 0, skipped: "quiet-hours" });
    expect(sent).toHaveLength(0);
  });

  // ------------------------------------------------------------ daily cap --

  it("sends one marketing message per client per day, then stops", async () => {
    const target = { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true };
    const first = await sendMarketingTo(target, { tenantId: clinic, now: daytime, message: { title: "One", body: "a" } });
    const second = await sendMarketingTo(target, { tenantId: clinic, now: daytime, message: { title: "Two", body: "b" } });

    expect(first).toMatchObject({ sent: 1 });
    expect(second).toMatchObject({ sent: 0, skipped: "already-today" });
    expect(sent.map((s) => s.title)).toEqual(["One"]);
  });

  it("sends as many a day as the clinic allows, and stops there", async () => {
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, marketingDailyLimit: 3 } });
    const target = { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true };

    for (const n of [1, 2, 3]) {
      expect(await sendMarketingTo(target, { tenantId: clinic, now: daytime, message: { title: `#${n}`, body: "x" } })).toMatchObject({ sent: 1 });
    }
    expect(await sendMarketingTo(target, { tenantId: clinic, now: daytime, message: { title: "#4", body: "x" } })).toMatchObject({
      sent: 0,
      skipped: "already-today",
    });
    expect(sent.map((s) => s.title)).toEqual(["#1", "#2", "#3"]);

    await rawDb.tenantSettings.deleteMany({ where: { tenantId: clinic } });
  });

  it("never stops anyone when the clinic set no limit", async () => {
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, marketingDailyLimit: 0 } });
    const target = { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true };

    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(await sendMarketingTo(target, { tenantId: clinic, now: daytime, message: { title: `#${n}`, body: "x" } })).toMatchObject({ sent: 1 });
    }
    expect(sent).toHaveLength(6);

    await rawDb.tenantSettings.deleteMany({ where: { tenantId: clinic } });
  });

  it("lets one marked notification past the limit, without touching consent", async () => {
    await rawDb.notificationCampaign.create({
      data: {
        tenantId: clinic,
        name: "Everyone, please",
        channel: "PUSH",
        subject: "Everyone",
        body: "Even if you've heard from us",
        ignoreDailyLimit: true,
        scheduledAt: new Date(daytime.getTime() - 60_000),
        status: "SCHEDULED",
      },
    });

    // The client has already had today's one.
    await sendMarketingTo(
      { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true },
      { tenantId: clinic, now: daytime, message: { title: "Earlier", body: "x" } },
    );
    expect(sent).toHaveLength(1);

    const result = await runMarketing(daytime);
    expect(result.campaigns).toBe(1);
    expect(sent.map((s) => s.title)).toEqual(["Earlier", "Everyone"]);

    // The client who never wanted offers is still left alone.
    expect(sent.some((s) => s.userId === quiet.userId)).toBe(false);
  });

  it("lets a discount meant for one client past the limit", async () => {
    // The shape a personal discount creates: a campaign addressed to one
    // client. It goes through the same sender whether it is sent at once or
    // picked up later by the job.
    await rawDb.notificationCampaign.create({
      data: {
        tenantId: clinic,
        name: "Just for you",
        channel: "PUSH",
        subject: "Your clinic",
        body: "10% off for you",
        customerProfileId: client.profileId,
        scheduledAt: new Date(daytime.getTime() - 60_000),
        status: "SCHEDULED",
      },
    });

    await sendMarketingTo(
      { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true },
      { tenantId: clinic, now: daytime, message: { title: "Earlier", body: "x" } },
    );

    const result = await runMarketing(daytime);
    expect(result.campaigns).toBe(1);
    expect(sent.map((s) => s.title)).toEqual(["Earlier", "Your clinic"]);
  });

  it("lets a birthday through on a day the client already had an offer", async () => {
    const target = { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true };
    await sendMarketingTo(target, { tenantId: clinic, now: daytime, message: { title: "Offer", body: "a" } });
    const birthday = await sendMarketingTo(target, {
      tenantId: clinic,
      now: daytime,
      exemptFromDailyCap: true,
      message: { title: "Birthday", body: "b" },
    });

    expect(birthday).toMatchObject({ sent: 1, skipped: null });
    expect(sent.map((s) => s.title)).toEqual(["Offer", "Birthday"]);
  });

  it("counts the cap per clinic, not across the platform", async () => {
    await sendMarketingTo(
      { customerProfileId: client.profileId, userId: client.userId, marketingConsent: true },
      { tenantId: clinic, now: daytime, message: { title: "Ours", body: "a" } },
    );
    expect(await sentTodayCount(clinic, client.profileId, daytime)).toBe(1);
    expect(await sentTodayCount(otherClinic, client.profileId, daytime)).toBe(0);
  });

  // ------------------------------------------------------------ campaigns --

  it("sends a scheduled campaign once, however often the job runs", async () => {
    await rawDb.notificationCampaign.create({
      data: {
        tenantId: clinic,
        name: "Winter sale",
        channel: "PUSH",
        body: "Everything 20% off",
        subject: "Winter sale",
        scheduledAt: new Date(daytime.getTime() - 60_000),
        status: "SCHEDULED",
      },
    });

    const first = await runMarketing(daytime);
    const second = await runMarketing(daytime);

    expect(first.campaigns).toBe(1);
    expect(second.campaigns).toBe(0);
    expect(sent).toHaveLength(1);

    const campaign = await rawDb.notificationCampaign.findFirstOrThrow({ where: { tenantId: clinic } });
    expect(campaign).toMatchObject({ status: "SENT", devicesReached: 1 });
  });

  it("judges an already-scheduled campaign against the window as it is at send time", async () => {
    // Scheduled while the clinic sent until 22:00, and due at 19:00 local.
    await rawDb.notificationCampaign.create({
      data: {
        tenantId: clinic,
        name: "Evening offer",
        channel: "PUSH",
        body: "Tonight only",
        scheduledAt: new Date("2026-07-01T17:00:00Z"), // 19:00 Amsterdam
        status: "SCHEDULED",
      },
    });

    // The clinic then decides it stops at 18:00.
    await rawDb.tenantSettings.create({
      data: { tenantId: clinic, marketingWindowStartMinutes: 9 * 60, marketingWindowEndMinutes: 18 * 60 },
    });

    const evening = new Date("2026-07-01T17:30:00Z"); // 19:30 local, past the new close
    const held = await runMarketing(evening);
    expect(held.campaigns).toBe(0);
    expect(held.heldForQuietHours).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);
    expect(await rawDb.notificationCampaign.findFirstOrThrow({ where: { tenantId: clinic } })).toMatchObject({ status: "SCHEDULED" });

    // Widen it again, same instant: the campaign that was already scheduled
    // now goes, because the window is read when sending, not when scheduling.
    await rawDb.tenantSettings.updateMany({ where: { tenantId: clinic }, data: { marketingWindowEndMinutes: 22 * 60 } });
    const later = await runMarketing(evening);
    expect(later.campaigns).toBe(1);
    expect(sent).toHaveLength(1);

    await rawDb.tenantSettings.deleteMany({ where: { tenantId: clinic } });
  });

  it("holds a campaign that comes due at night until the morning", async () => {
    await rawDb.notificationCampaign.create({
      data: { tenantId: clinic, name: "Late", channel: "PUSH", body: "Late night", scheduledAt: night, status: "SCHEDULED" },
    });

    const held = await runMarketing(night);
    expect(held.campaigns).toBe(0);
    expect(held.heldForQuietHours).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);

    // Nine the next morning: it goes.
    const morning = new Date("2026-07-02T07:00:00Z");
    const later = await runMarketing(morning);
    expect(later.campaigns).toBe(1);
    expect(sent).toHaveLength(1);
  });

  // ------------------------------------------------------------ birthdays --

  it("sends a birthday greeting once a year, whatever the job does", async () => {
    // Born on the first of July, some years ago.
    const birthdayClient = await makeClient("bday", { dob: new Date(Date.UTC(1990, 6, 1)) });
    await rawDb.tenantSettings.create({
      data: { tenantId: clinic, birthdayMessageEnabled: true, birthdayMessage: "Happy birthday!", birthdayDiscountPercent: 15, birthdayDiscountDays: 10 },
    });

    const first = await runMarketing(daytime);
    const second = await runMarketing(daytime);

    expect(first.birthdays).toBe(1);
    expect(second.birthdays).toBe(0);
    expect(sent.filter((s) => s.userId === birthdayClient.userId)).toHaveLength(1);

    const greetings = await rawDb.birthdayGreeting.findMany({ where: { tenantId: clinic } });
    expect(greetings).toHaveLength(1);
    expect(greetings[0]!.year).toBe(2026);

    // The present: a personal discount, for this client only.
    const promotion = await rawDb.promotion.findFirstOrThrow({ where: { tenantId: clinic, customerProfileId: birthdayClient.profileId } });
    expect(promotion).toMatchObject({ discountType: "PERCENT", discountValue: 15, autoApply: true, perCustomerLimit: 1 });

    await rawDb.tenantSettings.deleteMany({ where: { tenantId: clinic } });
  });

  it("says nothing on a day that isn't the client's birthday", async () => {
    const january = await makeClient("notbday", { dob: new Date(Date.UTC(1990, 0, 20)) });
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, birthdayMessageEnabled: true } });

    await runMarketing(daytime);

    // Asked about this client rather than counting the clinic's greetings:
    // other tests leave clients behind whose birthday is today, and this is
    // about the one whose birthday isn't.
    const greeting = await rawDb.birthdayGreeting.findFirst({ where: { tenantId: clinic, customerProfileId: january.profileId } });
    expect(greeting).toBeNull();
    expect(sent.filter((s) => s.userId === january.userId)).toHaveLength(0);

    await rawDb.tenantSettings.deleteMany({ where: { tenantId: clinic } });
  });

  // ------------------------------------------------------- discounts, live --

  it("works out the discount from the database, not from the caller", async () => {
    await rawDb.promotion.create({
      data: {
        tenantId: clinic,
        title: "Skincare 20%",
        startAt: new Date(daytime.getTime() - 86_400_000),
        endAt: new Date(daytime.getTime() + 86_400_000),
        discountType: "PERCENT",
        discountValue: 20,
        autoApply: true,
        eligibility: { create: [{ productCategoryId: categoryId }] },
      },
    });

    const applied = await resolveDiscount({
      tenantId: clinic,
      customerProfileId: client.profileId,
      now: daytime,
      // Whatever a browser might claim, the price used is the one stored.
      lines: [{ kind: "PRODUCT", id: productId, categoryId, unitPriceCents: 10_000, quantity: 1 }],
    });

    expect(applied).toMatchObject({ discountCents: 2_000, title: "Skincare 20%" });
  });

  it("keeps one client's personal discount away from everyone else", async () => {
    const other = await makeClient("personal");
    await rawDb.promotion.create({
      data: {
        tenantId: clinic,
        title: "Just for you",
        startAt: new Date(daytime.getTime() - 86_400_000),
        endAt: new Date(daytime.getTime() + 86_400_000),
        discountType: "PERCENT",
        discountValue: 50,
        autoApply: true,
        customerProfileId: other.profileId,
      },
    });

    const mine = await candidatesFor(clinic, other.profileId, daytime);
    const theirs = await candidatesFor(clinic, client.profileId, daytime);

    expect(mine.map((c) => c.title)).toContain("Just for you");
    expect(theirs.map((c) => c.title)).not.toContain("Just for you");
  });

  it("stops offering a discount once the client has used it as often as allowed", async () => {
    const promotion = await rawDb.promotion.create({
      data: {
        tenantId: clinic,
        title: "Once only",
        startAt: new Date(daytime.getTime() - 86_400_000),
        endAt: new Date(daytime.getTime() + 86_400_000),
        discountType: "PERCENT",
        discountValue: 10,
        autoApply: true,
        perCustomerLimit: 1,
      },
    });

    expect((await candidatesFor(clinic, client.profileId, daytime)).map((c) => c.id)).toContain(promotion.id);

    await rawDb.promotionRedemption.create({
      data: { tenantId: clinic, promotionId: promotion.id, customerProfileId: client.profileId, discountAppliedCents: 1_000 },
    });

    expect((await candidatesFor(clinic, client.profileId, daytime)).map((c) => c.id)).not.toContain(promotion.id);
  });

  it("ignores a discount that hasn't started or has finished", async () => {
    await rawDb.promotion.create({
      data: {
        tenantId: clinic,
        title: "Next month",
        startAt: new Date(daytime.getTime() + 86_400_000),
        endAt: new Date(daytime.getTime() + 2 * 86_400_000),
        discountType: "PERCENT",
        discountValue: 30,
        autoApply: true,
      },
    });

    expect(await candidatesFor(clinic, client.profileId, daytime)).toHaveLength(0);
  });

  it("ignores a code-only discount, which is the clinic's own till to apply", async () => {
    await rawDb.promotion.create({
      data: {
        tenantId: clinic,
        title: "Typed code",
        code: `CODE${stamp}`.slice(0, 20),
        startAt: new Date(daytime.getTime() - 86_400_000),
        endAt: new Date(daytime.getTime() + 86_400_000),
        discountType: "PERCENT",
        discountValue: 30,
        autoApply: false,
      },
    });

    expect(await candidatesFor(clinic, client.profileId, daytime)).toHaveLength(0);
  });
});
