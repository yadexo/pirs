import { describe, it, expect } from "vitest";
import { checkoutDomains, registerApplePayDomains, type PaymentMethodDomainsApi } from "@/lib/apple-pay-domains";

describe("Apple Pay checkout domains", () => {
  const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

  it("registers the client app domain and this deployment, once each", () => {
    expect(checkoutDomains(env({ CLIENT_APP_URL: "https://pirs.io", APP_URL: "https://clinic.pirs.io" }))).toEqual(["pirs.io", "clinic.pirs.io"]);
    expect(checkoutDomains(env({ CLIENT_APP_URL: "https://pirs.io/", APP_URL: "https://pirs.io" }))).toEqual(["pirs.io"]);
  });

  it("takes extra domains from APPLE_PAY_DOMAINS, with or without a scheme", () => {
    expect(checkoutDomains(env({ APP_URL: "https://clinic.pirs.io", APPLE_PAY_DOMAINS: "www.pirs.io, https://preview.pirs.io" }))).toEqual([
      "clinic.pirs.io",
      "www.pirs.io",
      "preview.pirs.io",
    ]);
  });

  it("leaves out what Apple can never verify — localhost, an IP, or nothing at all", () => {
    expect(checkoutDomains(env({ APP_URL: "http://localhost:3000", CLIENT_APP_URL: "", APPLE_PAY_DOMAINS: "127.0.0.1, ,app.localhost" }))).toEqual([]);
  });
});

describe("registering domains on a connected account", () => {
  function fakeApi(existing: string[] = [], failOn?: string) {
    const created: { domain: string; account: string }[] = [];
    const api: PaymentMethodDomainsApi = {
      list: async ({ domain_name }, { stripeAccount }) => {
        void stripeAccount;
        return { data: existing.includes(domain_name) ? [{ id: "pmd_1" }] : [] };
      },
      create: async ({ domain_name, enabled }, { stripeAccount }) => {
        if (domain_name === failOn) throw new Error("This domain isn't reachable.");
        expect(enabled).toBe(true);
        created.push({ domain: domain_name, account: stripeAccount });
        return { id: "pmd_new" };
      },
    };
    return { api, created };
  }

  it("registers each domain on the clinic's own account", async () => {
    const { api, created } = fakeApi();
    const results = await registerApplePayDomains(api, "acct_clinic", ["pirs.io", "clinic.pirs.io"]);
    expect(results.every((r) => r.status === "registered")).toBe(true);
    expect(created).toEqual([
      { domain: "pirs.io", account: "acct_clinic" },
      { domain: "clinic.pirs.io", account: "acct_clinic" },
    ]);
  });

  it("is safe to run twice — an existing domain is left alone", async () => {
    const { api, created } = fakeApi(["pirs.io"]);
    const results = await registerApplePayDomains(api, "acct_clinic", ["pirs.io", "clinic.pirs.io"]);
    expect(results.map((r) => r.status)).toEqual(["already", "registered"]);
    expect(created).toEqual([{ domain: "clinic.pirs.io", account: "acct_clinic" }]);
  });

  it("one domain failing doesn't stop the rest", async () => {
    const { api, created } = fakeApi([], "pirs.io");
    const results = await registerApplePayDomains(api, "acct_clinic", ["pirs.io", "clinic.pirs.io"]);
    expect(results[0]).toMatchObject({ domain: "pirs.io", status: "failed", error: "This domain isn't reachable." });
    expect(results[1]).toMatchObject({ status: "registered" });
    expect(created).toEqual([{ domain: "clinic.pirs.io", account: "acct_clinic" }]);
  });
});
