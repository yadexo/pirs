/**
 * Closing a client account ends their membership first.
 *
 * Deleting the account used to disable the login and leave the membership —
 * and its Stripe subscription — running: the client kept being charged and
 * could no longer sign in to stop it. Now every live membership is cancelled
 * immediately on the clinic's Stripe account before anything else changes;
 * if Stripe refuses, nothing changes and the client is told. No refund is
 * made for the current period (D1–D2), unused credit, items and package
 * sessions lapse with the account (D3), and one last email confirms it (D4).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);

/** Stripe is faked at the module boundary; everything below it is the real code. */
const billing = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("@/lib/memberships-billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memberships-billing")>();
  return { ...actual, cancelMembershipSubscription: (...args: unknown[]) => billing.cancel(...args) };
});
const emails = vi.hoisted(() => ({ sent: [] as { to: string; subject?: string; body: string }[] }));
vi.mock("@/lib/providers/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEmailProvider: () => ({
    send: async (m: { to: string; subject?: string; body: string }) => {
      emails.sent.push(m);
      return { providerMessageId: "t", status: "SENT" };
    },
  }),
}));

const { clientDeleteAccountAction } = await import("@/lib/actions/client-app");
const { isDeleteConfirmation } = await import("@/lib/account-closure");

describe("closing a client account", () => {
  const stamp = Date.now();
  const ACCOUNT = `acct_close_${stamp}`;
  const SLUG = `close-${stamp}`;
  let clinic: string;
  let planId: string;
  let n = 0;

  /** A fresh client, signed in, optionally with a live membership on Stripe. */
  async function client(opts: { membership?: "stripe" | "none"; status?: "ACTIVE" | "PAST_DUE" | "PAUSED" } = {}) {
    n += 1;
    const email = `close-${stamp}-${n}@example.com`;
    const user = await rawDb.user.create({ data: { tenantId: clinic, email, passwordHash: "x", role: "CUSTOMER", locale: "nl" } });
    const profile = await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: user.id, firstName: "Cleo", lastName: "Close" } });
    let membershipId: string | null = null;
    if ((opts.membership ?? "stripe") === "stripe") {
      membershipId = (
        await rawDb.customerMembership.create({
          data: {
            tenantId: clinic,
            customerProfileId: profile.id,
            membershipPlanId: planId,
            status: opts.status ?? "ACTIVE",
            currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
            stripeSubscriptionId: `sub_${stamp}_${n}`,
          },
        })
      ).id;
    }
    clientAuthMock.clientAuth.mockResolvedValue({
      user: { id: user.id, email, name: "Cleo", role: "CUSTOMER", tenantId: clinic, tenantSlug: SLUG, staffProfileId: null, customerProfileId: profile.id, permissions: [] },
    });
    return { userId: user.id, email, membershipId, subscriptionId: `sub_${stamp}_${n}` };
  }

  const userStatus = async (id: string) => (await rawDb.user.findUniqueOrThrow({ where: { id } })).status;
  const membershipStatus = async (id: string) => (await rawDb.customerMembership.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_closure";
    clinic = (
      await rawDb.tenant.create({ data: { slug: SLUG, name: "Closure Clinic", stripeAccountId: ACCOUNT, stripeStatus: "ACTIVE", stripeChargesEnabled: true } })
    ).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Closure Clinic", currency: "EUR" } });
    planId = (await rawDb.membershipPlan.create({ data: { tenantId: clinic, name: "Gold", billingFrequency: "MONTHLY", priceCents: 4900 } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(() => {
    billing.cancel.mockReset();
    billing.cancel.mockResolvedValue({ status: "canceled" });
    emails.sent.length = 0;
  });

  it("cancels the Stripe subscription now, ends the membership, then closes the account", async () => {
    const c = await client();
    expect(await clientDeleteAccountAction(SLUG, "delete")).toEqual({ ok: true });
    expect(billing.cancel).toHaveBeenCalledWith(ACCOUNT, c.subscriptionId);
    expect(await membershipStatus(c.membershipId!)).toBe("CANCELLED");
    expect(await userStatus(c.userId)).toBe("DISABLED");
  });

  it("ends a past-due or paused membership too — anything that could still bill", async () => {
    for (const status of ["PAST_DUE", "PAUSED"] as const) {
      const c = await client({ status });
      expect(await clientDeleteAccountAction(SLUG, "DELETE"), status).toEqual({ ok: true });
      expect(billing.cancel, status).toHaveBeenCalledWith(ACCOUNT, c.subscriptionId);
      expect(await membershipStatus(c.membershipId!), status).toBe("CANCELLED");
    }
  });

  it("changes nothing when Stripe refuses, and says so", async () => {
    const c = await client();
    billing.cancel.mockRejectedValueOnce(new Error("Stripe is down"));
    const res = await clientDeleteAccountAction(SLUG, "delete");
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(await membershipStatus(c.membershipId!)).toBe("ACTIVE");
    expect(await userStatus(c.userId)).toBe("ACTIVE");
  });

  it("closes an account with no membership as before", async () => {
    const c = await client({ membership: "none" });
    expect(await clientDeleteAccountAction(SLUG, "verwijder")).toEqual({ ok: true });
    expect(billing.cancel).not.toHaveBeenCalled();
    expect(await userStatus(c.userId)).toBe("DISABLED");
  });

  it("refuses without the confirmation word, and changes nothing", async () => {
    const c = await client();
    expect(await clientDeleteAccountAction(SLUG, "yes please")).toMatchObject({ error: expect.any(String) });
    expect(billing.cancel).not.toHaveBeenCalled();
    expect(await userStatus(c.userId)).toBe("ACTIVE");
  });

  it("sends one last email saying the account is closed and nothing more will be charged", async () => {
    const c = await client();
    await clientDeleteAccountAction(SLUG, "Delete");
    expect(emails.sent.map((e) => e.to)).toEqual([c.email]);
    expect(emails.sent[0]!.body).toMatch(/Gold/);
    expect(emails.sent[0]!.body).toMatch(/niets meer afgeschreven/);
  });

  it("accepts the confirmation word in either language and any capitalisation", () => {
    for (const ok of ["delete", "Delete", "DELETE", " delete ", "verwijder", "Verwijder", "VERWIJDER"]) expect(isDeleteConfirmation(ok), ok).toBe(true);
    for (const no of ["", "del", "deleted", "verwijderen?", "yes"]) expect(isDeleteConfirmation(no), no).toBe(false);
  });
});
