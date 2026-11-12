/**
 * Client-side actions, called with arguments the app would never send.
 *
 * tests/action-args-coverage.test.ts proves every action *has* a check. This
 * proves the checks do something, against the real actions and database, for
 * the cases that matter most — and keeps the second attack found while
 * writing them: an unchecked object, spread into an update, let a client set
 * any column on their own profile (docs/security/review-2026-11.md, R-2).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { INVALID_REQUEST, InvalidActionArgsError, arg, args, validArgs } from "@/lib/action-args";

const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);

const clientApp = await import("@/lib/actions/client-app");
const { searchCatalogAction } = await import("@/lib/actions/client-catalog");

/** Calls an action with whatever it is handed, the way a hand-made request does. */
const call = (action: (...a: never[]) => unknown, ...given: unknown[]) => (action as (...a: unknown[]) => Promise<unknown>)(...given);

describe("the shapes arguments come in", () => {
  it("an id is a short token, never a pattern, a path or an object", () => {
    const ok = (value: unknown) => validArgs(args([arg.id]), [value]);
    expect(ok("cmvo6e71o002n91e4to7doi81")).toBe(true);
    for (const bad of ["", "a".repeat(65), "../etc", "a b", "%", { contains: "" }, ["x"], null, undefined, 7]) expect(ok(bad), String(bad)).toBe(false);
  });

  it("a slug, an order number and a date are what they say", () => {
    expect(validArgs(args([arg.slug, arg.orderNumber, arg.isoDate]), ["riverside-wellness", "ORD-MWC49P8Y-DWB_", "2026-11-12T09:00:00.000Z"])).toBe(true);
    expect(validArgs(args([arg.slug]), ["Riverside/../admin"])).toBe(false);
    expect(validArgs(args([arg.orderNumber]), ["ORD 1; DROP"])).toBe(false);
    expect(validArgs(args([arg.isoDate]), ["not a date"])).toBe(false);
  });

  it("a number is a whole one in range, with nothing coerced", () => {
    const ok = (value: unknown) => validArgs(args([arg.int(1, 999)]), [value]);
    expect(ok(5)).toBe(true);
    for (const bad of [0, -1, 1000, 1.5, NaN, Infinity, "5", null]) expect(ok(bad), String(bad)).toBe(false);
  });

  it("too few arguments is a refusal, not a crash", () => {
    expect(validArgs(args([arg.slug, arg.id]), ["riverside-wellness"])).toBe(false);
  });
});

describe("client actions refuse what the app would never send", () => {
  const stamp = Date.now();
  const slug = `args-${stamp}`;
  let clinic: string;
  let userId: string;
  let profileId: string;

  const profile = () => rawDb.customerProfile.findUniqueOrThrow({ where: { id: profileId } });

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug, name: "Args Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Args Clinic", currency: "EUR" } });
    await rawDb.tenantSettings.create({ data: { tenantId: clinic } });
    const user = await rawDb.user.create({ data: { tenantId: clinic, email: `args-${stamp}@example.com`, passwordHash: "x", role: "CUSTOMER" } });
    userId = user.id;
    profileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: user.id, firstName: "Ada", lastName: "Client" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(() => {
    clientAuthMock.clientAuth.mockResolvedValue({
      user: { id: userId, email: `args-${stamp}@example.com`, name: "A", role: "CUSTOMER", tenantId: clinic, tenantSlug: slug, staffProfileId: null, customerProfileId: profileId, permissions: [] },
    });
  });

  describe("the preferences switches", () => {
    const four = { emailConsent: true, smsConsent: false, pushConsent: true, marketingConsent: false };

    it("cannot be used to write anything else onto the client's own profile", async () => {
      const before = await profile();
      for (const extra of [{ accountCreditBalanceCents: 1_000_000 }, { loyaltyPointsBalance: 99_999 }, { tenantId: "another-clinic" }, { firstName: "Changed" }]) {
        await expect(call(clientApp.clientSaveConsentAction, slug, { ...four, ...extra }), JSON.stringify(extra)).rejects.toBeInstanceOf(InvalidActionArgsError);
      }
      const after = await profile();
      expect(after.accountCreditBalanceCents).toBe(before.accountCreditBalanceCents);
      expect(after.loyaltyPointsBalance).toBe(before.loyaltyPointsBalance);
      expect(after.tenantId).toBe(clinic);
      expect(after.firstName).toBe("Ada");
    });

    it("refuses a switch that is not a boolean, or a missing one", async () => {
      await expect(call(clientApp.clientSaveConsentAction, slug, { ...four, marketingConsent: "yes" })).rejects.toBeInstanceOf(InvalidActionArgsError);
      await expect(call(clientApp.clientSaveConsentAction, slug, { emailConsent: true })).rejects.toBeInstanceOf(InvalidActionArgsError);
      await expect(call(clientApp.clientSaveConsentAction, slug, null)).rejects.toBeInstanceOf(InvalidActionArgsError);
    });

    it("still saves the four it is for", async () => {
      expect(await clientApp.clientSaveConsentAction(slug, four)).toEqual({ ok: true });
      expect(await profile()).toMatchObject({ ...four, marketingConsentSource: "preferences" });
    });
  });

  it("an id that is an object never reaches a query", async () => {
    // `{ contains: "" }` in a where clause would match every row.
    const anything = { contains: "" };
    expect(await call(clientApp.clientCancelAppointmentAction, slug, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(clientApp.clientRedeemRewardAction, slug, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(clientApp.clientJoinPlanAction, slug, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(clientApp.clientOrderStatusAction, slug, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(clientApp.clientOrderReceiptAction, anything)).toEqual({ error: INVALID_REQUEST });
    await expect(call(clientApp.getBookingOptionsForServiceAction, anything)).rejects.toBeInstanceOf(InvalidActionArgsError);
    await expect(call(clientApp.clientAbandonOrderAction, slug, anything)).rejects.toBeInstanceOf(InvalidActionArgsError);
  });

  it("checkout takes only the option it knows, as a boolean", async () => {
    expect(await call(clientApp.clientCheckoutAction, slug, null, { useCredit: "true" })).toEqual({ error: INVALID_REQUEST });
    expect(await call(clientApp.clientCheckoutAction, slug, null, { useCredit: true, totalCents: 0 })).toEqual({ error: INVALID_REQUEST });
    expect(await call(clientApp.clientCheckoutAction, slug, { id: "x" }, {})).toEqual({ error: INVALID_REQUEST });
    // A well-formed call gets past the check and fails for an honest reason.
    expect(await clientApp.clientCheckoutAction(slug, null, {})).toEqual({ error: "Your cart is empty." });
    expect(await clientApp.clientCheckoutAction(slug, null)).toEqual({ error: "Your cart is empty." });
  });

  it("giving sessions needs a whole, positive number of them", async () => {
    for (const sessions of [-1, 0, 0.5, "2", null, 1000]) {
      expect(await call(clientApp.clientGiveSessionsAction, slug, "somepackageid", sessions, "friend@example.com"), String(sessions)).toEqual({ error: INVALID_REQUEST });
    }
  });

  it("asking for slots needs real ids, a sane duration and a real date", async () => {
    const good = ["staffid", "locationid", 30, "2026-11-12"] as const;
    for (const [index, bad] of [
      [0, { not: null }],
      [1, ""],
      [2, -30],
      [2, 100_000],
      [3, "tomorrow-ish"],
    ] as const) {
      const given: unknown[] = [...good];
      given[index] = bad;
      await expect(call(clientApp.getClientSlotsAction, ...given), JSON.stringify(given)).rejects.toBeInstanceOf(InvalidActionArgsError);
    }
  });

  it("a slug that is not a slug is refused everywhere it is taken", async () => {
    for (const bad of ["../../agency", "", "A".repeat(200), 7, null, ["riverside"]]) {
      expect(await call(clientApp.clientReviewAction, bad), String(bad)).toEqual({ error: INVALID_REQUEST });
      expect(await call(clientApp.clientCancelPlanAction, bad), String(bad)).toEqual({ error: INVALID_REQUEST });
      await expect(call(clientApp.clientDeleteAccountAction, bad), String(bad)).rejects.toBeInstanceOf(InvalidActionArgsError);
    }
    // The account was not closed by any of those.
    expect((await rawDb.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe("ACTIVE");
  });

  it("a search that is not a short piece of text finds nothing, quietly", async () => {
    expect(await call(searchCatalogAction, { contains: "" })).toEqual([]);
    expect(await call(searchCatalogAction, "x".repeat(101))).toEqual([]);
    expect(await call(searchCatalogAction, null)).toEqual([]);
    expect(Array.isArray(await searchCatalogAction("facial"))).toBe(true);
  });

  it("the language and the recorded events keep their own refusals", async () => {
    expect(await call(clientApp.clientSaveLocaleAction, slug, { $ne: null })).toEqual({ error: INVALID_REQUEST });
    expect(await call(clientApp.clientRecordInstallEventAction, slug, "SHOWN")).toEqual({ error: "invalid" });
    expect(await call(clientApp.clientRecordNotificationPromptAction, slug, null)).toEqual({ error: "invalid" });
  });
});
