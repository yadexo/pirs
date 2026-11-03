import { describe, it, expect } from "vitest";
import { checkoutDomains, registerApplePayDomains, type PaymentMethodDomainsApi } from "@/lib/apple-pay-domains";

describe("Apple Pay checkout domains", () => {
  const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

  it("registers the client app domain and this deployment, once each", () => {
    expect(checkoutDomains(env({ CLIENT_APP_URL: "https://login.deza.ai", APP_URL: "https://app.deza.ai" }))).toEqual(["login.deza.ai", "app.deza.ai"]);
    expect(checkoutDomains(env({ CLIENT_APP_URL: "https://login.deza.ai/", APP_URL: "https://login.deza.ai" }))).toEqual(["login.deza.ai"]);
  });

  it("takes extra domains from APPLE_PAY_DOMAINS, with or without a scheme", () => {
    expect(checkoutDomains(env({ APP_URL: "https://app.deza.ai", APPLE_PAY_DOMAINS: "my.riverside-clinic.test, https://preview.deza.ai" }))).toEqual([
      "app.deza.ai",
      "my.riverside-clinic.test",
      "preview.deza.ai",
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
    const results = await registerApplePayDomains(api, "acct_clinic", ["login.deza.ai", "app.deza.ai"]);
    expect(results.every((r) => r.status === "registered")).toBe(true);
    expect(created).toEqual([
      { domain: "login.deza.ai", account: "acct_clinic" },
      { domain: "app.deza.ai", account: "acct_clinic" },
    ]);
  });

  it("is safe to run twice — an existing domain is left alone", async () => {
    const { api, created } = fakeApi(["login.deza.ai"]);
    const results = await registerApplePayDomains(api, "acct_clinic", ["login.deza.ai", "app.deza.ai"]);
    expect(results.map((r) => r.status)).toEqual(["already", "registered"]);
    expect(created).toEqual([{ domain: "app.deza.ai", account: "acct_clinic" }]);
  });

  it("one domain failing doesn't stop the rest", async () => {
    const { api, created } = fakeApi([], "login.deza.ai");
    const results = await registerApplePayDomains(api, "acct_clinic", ["login.deza.ai", "app.deza.ai"]);
    expect(results[0]).toMatchObject({ domain: "login.deza.ai", status: "failed", error: "This domain isn't reachable." });
    expect(results[1]).toMatchObject({ status: "registered" });
    expect(created).toEqual([{ domain: "app.deza.ai", account: "acct_clinic" }]);
  });
});
