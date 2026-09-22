import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import type { StripeConnectClient, V2AccountCreateBody, V2AccountLinkBody } from "@/lib/stripe-connect";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

const { handleConnect, handleRefresh, handleReturn } = await import("@/lib/stripe-connect-http");
const webhook = await import("@/app/api/webhooks/stripe/route");

const ORIGIN = "https://clinic.pirs.io";

/** A Stripe client that records the v2 calls and returns accounts we control. */
function fakeStripe() {
  let n = 0;
  const accounts = new Map<string, Stripe.Account>();
  const calls = { create: [] as { body: V2AccountCreateBody; key: string }[], links: [] as V2AccountLinkBody[] };
  const byKey = new Map<string, { id: string; identity: { country: string } }>();
  const client: StripeConnectClient = {
    async createAccount(body, key) {
      calls.create.push({ body, key });
      const existing = byKey.get(key);
      if (existing) return existing;
      const created = { id: `acct_test_${++n}`, identity: { country: body.identity.country.toUpperCase() } };
      accounts.set(created.id, { id: created.id, country: created.identity.country, charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { disabled_reason: "requirements.past_due" } } as unknown as Stripe.Account);
      byKey.set(key, created);
      return created;
    },
    async createAccountLink(body) {
      calls.links.push(body);
      return { url: `https://connect.stripe.com/setup/s/${body.account}/${calls.links.length}` };
    },
    async retrieveAccount(id) {
      return accounts.get(id)!;
    },
  };
  return { client, calls, accounts };
}

describe("Stripe Connect onboarding", () => {
  const stamp = Date.now();
  let clinic: string;
  let ownerId: string;
  let staffId: string;
  let agencyId: string;

  const as = (id: string, role: string, tenantId: string | null) =>
    authMock.auth.mockResolvedValue({
      user: { id, email: `${role.toLowerCase()}-${stamp}@x.com`, name: "x", role, tenantId, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });

  const post = (fields: Record<string, string>, origin = ORIGIN) => {
    const body = new URLSearchParams(fields);
    return new NextRequest(`${ORIGIN}/m/${clinic}/stripe/connect`, {
      method: "POST",
      body,
      headers: { origin, host: "clinic.pirs.io", "x-forwarded-proto": "https", "content-type": "application/x-www-form-urlencoded" },
    });
  };
  const get = (path: string) => new NextRequest(`${ORIGIN}/m/${clinic}/stripe/${path}`, { headers: { host: "clinic.pirs.io", "x-forwarded-proto": "https" } });
  const notice = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("stripe");

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `stripe-${stamp}`, name: "Stripe Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Stripe Clinic BV", country: "Nederland", contactEmail: "hello@clinic.example" } });
    ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `so-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    staffId = (await rawDb.user.create({ data: { tenantId: clinic, email: `ss-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: staffId, firstName: "S", lastName: "Taff" } });
    agencyId = (await rawDb.user.create({ data: { email: `sa-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
  });

  afterAll(async () => {
    await rawDb.processedStripeEvent.deleteMany({ where: { id: { contains: String(stamp) } } });
    await deleteTenantCompletely(clinic);
    await rawDb.user.delete({ where: { id: agencyId } });
  });

  beforeEach(() => as(ownerId, "TENANT_ADMIN", clinic));

  it("refuses agency admins and staff, even though they can otherwise act in the clinic", async () => {
    const { client, calls } = fakeStripe();
    for (const [id, role] of [
      [agencyId, "PLATFORM_ADMIN"],
      [staffId, "STAFF"],
    ] as const) {
      as(id, role, role === "STAFF" ? clinic : null);
      const res = await handleConnect(post({ country: "NL", confirmed: "on" }), clinic, client);
      expect(notice(res)).toBe("owner-only");
      expect(notice(await handleRefresh(get("refresh"), clinic, client))).toBe("owner-only");
      expect(notice(await handleReturn(get("return"), clinic, client))).toBe("owner-only");
    }
    expect(calls.create).toHaveLength(0);
  });

  it("refuses a form posted from another site", async () => {
    const { client, calls } = fakeStripe();
    const res = await handleConnect(post({ country: "NL", confirmed: "on" }, "https://evil.example"), clinic, client);
    expect(res.status).toBe(403);
    expect(calls.create).toHaveLength(0);
  });

  it("needs the owner to confirm the country from the address before creating anything", async () => {
    const { client, calls } = fakeStripe();
    expect(notice(await handleConnect(post({ country: "NL" }), clinic, client))).toBe("not-confirmed");
    expect(notice(await handleConnect(post({ country: "DE", confirmed: "on" }), clinic, client))).toBe("country-changed");
    expect(calls.create).toHaveLength(0);
  });

  it("creates one Standard account in the confirmed country and sends the owner to Stripe", async () => {
    const { client, calls } = fakeStripe();
    const res = await handleConnect(post({ country: "NL", confirmed: "on" }), clinic, client);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^https:\/\/connect\.stripe\.com\/setup\//);

    // Accounts v2: the Standard-account equivalent, in the confirmed country.
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]!.body).toEqual({
      contact_email: "hello@clinic.example",
      display_name: "Stripe Clinic BV",
      dashboard: "full",
      identity: { country: "nl" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      metadata: { tenantId: clinic },
      include: ["identity"],
    });
    expect(calls.create[0]!.key).toBe(`connect-account-v2-${clinic}-NL`);
    expect(calls.links[0]).toEqual({
      account: calls.links[0]!.account,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          refresh_url: `${ORIGIN}/m/${clinic}/stripe/refresh`,
          return_url: `${ORIGIN}/m/${clinic}/stripe/return`,
        },
      },
    });

    const saved = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } });
    expect(saved).toMatchObject({ stripeAccountId: calls.links[0]!.account, stripeCountry: "NL", stripeStatus: "ONBOARDING" });

    // "Continue setup" reuses the account; it never makes a second one.
    const again = await handleConnect(post({}), clinic, client);
    expect(again.status).toBe(303);
    expect(calls.create).toHaveLength(1);
    expect(calls.links).toHaveLength(2);
  });

  it("refresh_url issues a fresh onboarding link for the same account", async () => {
    const { client, calls } = fakeStripe();
    const { stripeAccountId } = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } });
    const res = await handleRefresh(get("refresh"), clinic, client);
    expect(res.headers.get("location")).toContain(stripeAccountId!);
    expect(calls.links[0]).toMatchObject({ account: stripeAccountId, use_case: { type: "account_onboarding" } });
  });

  it("return_url reads Stripe and shows pending verification, not verified", async () => {
    const { stripeAccountId } = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } });
    const stripe: StripeConnectClient = {
      createAccount: async () => {
        throw new Error("not used");
      },
      createAccountLink: async () => ({ url: "unused" }),
      retrieveAccount: async () =>
        ({ id: stripeAccountId, country: "NL", charges_enabled: false, payouts_enabled: false, details_submitted: true, requirements: { disabled_reason: "requirements.pending_verification" } }) as unknown as Stripe.Account,
    };
    const res = await handleReturn(get("return"), clinic, stripe);
    expect(notice(res)).toBe("returned");
    expect(await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } })).toMatchObject({ stripeStatus: "PENDING_VERIFICATION", stripeChargesEnabled: false, stripeDetailsSubmitted: true });
  });

  describe("account.updated webhook", () => {
    const secret = "whsec_test_secret";
    const signer = new Stripe("sk_test_signing_only");

    beforeAll(() => {
      process.env.STRIPE_WEBHOOK_SECRET = secret;
      process.env.STRIPE_SECRET_KEY = "sk_test_signing_only";
    });
    afterAll(() => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_SECRET_KEY;
    });

    const send = async (event: Record<string, unknown>, sign = true) => {
      const payload = JSON.stringify(event);
      const signature = sign ? signer.webhooks.generateTestHeaderString({ payload, secret }) : "t=1,v1=forged";
      return webhook.POST(new NextRequest(`${ORIGIN}/api/webhooks/stripe`, { method: "POST", body: payload, headers: { "stripe-signature": signature } }));
    };
    const accountEvent = (accountId: string, created: number, flags: { charges: boolean; payouts: boolean }) => ({
      id: `evt_${stamp}_${created}`,
      object: "event",
      type: "account.updated",
      created,
      account: accountId,
      data: { object: { id: accountId, object: "account", country: "NL", charges_enabled: flags.charges, payouts_enabled: flags.payouts, details_submitted: true, requirements: { disabled_reason: null } } },
    });

    it("rejects unsigned events", async () => {
      const { stripeAccountId } = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } });
      const res = await send(accountEvent(stripeAccountId!, Math.floor(Date.now() / 1000) + 60, { charges: true, payouts: true }), false);
      expect(res.status).toBe(400);
      expect((await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } })).stripeStatus).toBe("PENDING_VERIFICATION");
    });

    it("marks the clinic ACTIVE when Stripe enables payments, and ignores an older event arriving late", async () => {
      const { stripeAccountId } = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } });
      const now = Math.floor(Date.now() / 1000) + 120;
      expect((await send(accountEvent(stripeAccountId!, now, { charges: true, payouts: true }))).status).toBe(200);
      expect(await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } })).toMatchObject({ stripeStatus: "ACTIVE", stripeChargesEnabled: true, stripePayoutsEnabled: true });

      await send(accountEvent(stripeAccountId!, now - 60, { charges: false, payouts: false }));
      expect((await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } })).stripeStatus).toBe("ACTIVE");
    });

    it("disconnects the clinic when it revokes the platform's access", async () => {
      const { stripeAccountId } = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } });
      await send({ id: `evt_deauth_${stamp}`, object: "event", type: "account.application.deauthorized", created: Math.floor(Date.now() / 1000), account: stripeAccountId, data: { object: { id: "ca_x", object: "application" } } });
      expect(await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } })).toMatchObject({ stripeAccountId: null, stripeStatus: "NOT_CONNECTED" });
    });
  });
});
