/**
 * Every link in every email a client gets opens a page that is served on the
 * host it points to.
 *
 * For a clinic with its own verified domain, client links go to that domain
 * (lib/clinic-app-link.ts). That domain serves the clinic's app and a short
 * list of shared pages, and refuses everything else — sign-in, the portal,
 * the admin console (clinicDomainRoute, lib/portal-hosts.ts). A link built
 * for one host but only served on another is a dead end the client meets in
 * their inbox, which is how the reset link on a clinic's domain went
 * unnoticed. Each email here is produced by the real code that sends it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { clinicDomainRoute } from "@/lib/portal-hosts";

vi.mock("server-only", () => ({}));
const emails = vi.hoisted(() => ({ sent: [] as { to: string; subject?: string; body: string; html?: string }[] }));
vi.mock("@/lib/providers/notifications", () => ({
  getEmailProvider: () => ({
    send: async (message: { to: string; subject?: string; body: string; html?: string }) => {
      emails.sent.push(message);
      return { providerMessageId: "t", status: "SENT" };
    },
  }),
  getPushProvider: () => ({ send: async () => ({ providerMessageId: "t", status: "SENT" }) }),
}));
vi.mock("@/lib/web-push", async (importOriginal) => ({ ...(await importOriginal<object>()), notifyClientQuietly: async () => undefined }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn() }));
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` }),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const { forgetClinicHosts } = await import("@/lib/clinic-hosts");
const { requestPasswordResetAction } = await import("@/lib/actions/password");
const { customerRegisterAction } = await import("@/lib/actions/auth");
const notify = await import("@/lib/client-notifications");

/**
 * Shared pages a clinic's domain serves as they are ("as-is"), and that are
 * built to work there: bound to that clinic's clients
 * (tests/integration/clinic-host-passwords.test.ts). Adding a link to any
 * other as-is path in a client email means making that page work on a
 * clinic's domain first, and adding it here.
 */
const CLINIC_HOST_PAGES = new Set(["set-password", "forgot-password"]);

/** Every absolute URL in an email, from its HTML links and its plain text. */
function urlsIn(message: { body: string; html?: string }): string[] {
  const found = new Set<string>();
  for (const m of (message.html ?? "").matchAll(/href="([^"]+)"/g)) found.add(m[1]!.replace(/&amp;/g, "&"));
  for (const m of message.body.matchAll(/https?:\/\/[^\s<>"')]+/g)) found.add(m[0]!.replace(/[.,]$/, ""));
  return [...found].filter((u) => /^https?:\/\//.test(u));
}

/** Whether `path` is a page this app serves on a clinic's own domain. */
function servedOnClinicHost(path: string): { ok: boolean; why: string } {
  const pathname = path.split(/[?#]/)[0]!;
  const route = clinicDomainRoute(pathname);
  if (route.kind === "deny") return { ok: false, why: "refused on a clinic's domain" };
  const segments = pathname.split("/").filter(Boolean);
  if (route.kind === "as-is") {
    if (!CLINIC_HOST_PAGES.has(segments[0]!)) return { ok: false, why: `served as-is, but /${segments[0]} is not built to work on a clinic's domain` };
    return existsSync(`app/${segments[0]}/page.tsx`) ? { ok: true, why: "" } : { ok: false, why: "no such page" };
  }
  // "app": rewritten to /app/<slug><path>.
  const page = ["app", "app", "[merchantSlug]", ...segments, "page.tsx"].join("/");
  return existsSync(page) ? { ok: true, why: "" } : { ok: false, why: `no page at ${page}` };
}

describe("links in client emails, for a clinic with its own domain", () => {
  const stamp = Date.now();
  const slug = `cel-${stamp}`;
  const host = `app.cel-${stamp}.example`;
  let tenantId: string;
  let profileId: string;
  let orderId: string;
  let membershipId: string;
  const clientEmail = `cel-client-${stamp}@example.com`;
  const byEmail = new Map<string, string[]>();

  const capture = async (name: string, send: () => Promise<unknown>) => {
    const before = emails.sent.length;
    await send();
    // Some notices are sent after the action has answered.
    for (let i = 0; i < 50 && emails.sent.length === before; i++) await new Promise((r) => setTimeout(r, 20));
    const sent = emails.sent.slice(before);
    expect(sent.length, `${name} sent no email`).toBeGreaterThan(0);
    byEmail.set(name, sent.flatMap(urlsIn));
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Link Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId, businessName: "Link Clinic", currency: "EUR" } });
    await rawDb.tenantSettings.create({ data: { tenantId } });
    await rawDb.clinicDomain.create({ data: { tenantId, host, type: "CLIENT", status: "VERIFIED" } });
    forgetClinicHosts();
    const user = await rawDb.user.create({ data: { tenantId, email: clientEmail, passwordHash: "!", role: "CUSTOMER", locale: "en" } });
    profileId = (await rawDb.customerProfile.create({ data: { tenantId, userId: user.id, firstName: "Lena", lastName: "Link" } })).id;
    orderId = (
      await rawDb.order.create({
        data: {
          tenantId,
          customerProfileId: profileId,
          orderNumber: `CEL-${stamp}`,
          status: "PAID",
          subtotalCents: 5_000,
          totalCents: 5_000,
          currency: "EUR",
          items: { create: [{ itemType: "SERVICE", name: "Facial", quantity: 1, unitPriceCents: 5_000, totalCents: 5_000, taxCents: 0 }] },
        } as never,
      })
    ).id;
    const plan = await rawDb.membershipPlan.create({ data: { tenantId, name: "Basic", billingFrequency: "MONTHLY", priceCents: 4900 } });
    membershipId = (await rawDb.customerMembership.create({ data: { tenantId, customerProfileId: profileId, membershipPlanId: plan.id, currentPeriodEnd: new Date(Date.now() + 864e5) } })).id;

    const register = (email: string) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ firstName: "Lena", lastName: "Link", email, password: "register-Password-1!", consent: "on" })) fd.set(k, v);
      return customerRegisterAction(slug, undefined, fd).catch(() => undefined);
    };

    await capture("password reset", async () => {
      const fd = new FormData();
      fd.set("email", clientEmail);
      fd.set("clinic", slug);
      await requestPasswordResetAction(undefined, fd);
    });
    await capture("account-exists notice", () => register(clientEmail));
    await capture("welcome", () => register(`cel-new-${stamp}@example.com`));
    await capture("order receipt", () => notify.notifyOrderConfirmation(orderId));
    await capture("refund", () => notify.notifyRefundProcessed(orderId, 5_000, true));
    await capture("price change", () => notify.notifyPriceChange(profileId, { planName: "Basic", newPriceCents: 5_900, currency: "EUR", effectiveAt: new Date(Date.now() + 30 * 864e5) }));
    await capture("membership payment failed", () => notify.notifyMembershipPaymentFailed(membershipId, new Date(Date.now() + 7 * 864e5)));
    await capture("membership payment received", () => notify.notifyMembershipActive(membershipId, 4_900, "EUR"));
    await capture("sessions expiring", () => notify.notifySessionsExpiring(profileId, "Facial x5", 2, "1 December"));
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
    forgetClinicHosts();
  });

  it("found links to check in the emails that have them", () => {
    for (const name of ["password reset", "account-exists notice", "welcome", "order receipt", "price change", "membership payment failed", "sessions expiring"]) {
      expect(byEmail.get(name)?.length, `${name} has no link`).toBeGreaterThan(0);
    }
  });

  it("every link goes to the clinic's own domain, and opens a page that is served there", () => {
    const problems: string[] = [];
    for (const [name, urls] of byEmail) {
      for (const raw of urls) {
        const url = new URL(raw);
        if (url.host !== host) {
          problems.push(`${name}: ${raw} is not on the clinic's domain`);
          continue;
        }
        const served = servedOnClinicHost(url.pathname + url.search);
        if (!served.ok) problems.push(`${name}: ${raw} — ${served.why}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the checker itself refuses what a clinic's domain does not serve", () => {
    for (const path of ["/login", "/m/abc", "/agency", "/register", "/account", "/no-such-page"]) {
      expect(servedOnClinicHost(path).ok, path).toBe(false);
    }
    for (const path of ["/", "/profile?tab=items", "/shop", "/set-password?token=x", "/forgot-password?clinic=x"]) {
      expect(servedOnClinicHost(path).ok, path).toBe(true);
    }
  });
});
