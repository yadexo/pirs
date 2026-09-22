import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ rawDb: {} }));
const { stripeClient, STRIPE_V2_API_VERSION } = await import("@/lib/stripe-connect");

/**
 * The real Stripe client, pointed at a local server, to prove what actually goes
 * over the wire: Accounts v2 endpoints, JSON bodies, the pinned API version and
 * the idempotency key. (The SDK's rawRequest is marked experimental.)
 */
describe("Stripe Connect requests on the wire", () => {
  interface Seen {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }
  const seen: Seen[] = [];
  let server: Server;
  let port: number;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_wire_only";
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method!, path: req.url!, headers: req.headers, body });
        res.setHeader("content-type", "application/json");
        res.setHeader("request-id", "req_test");
        if (req.url === "/v2/core/accounts") return res.end(JSON.stringify({ id: "acct_v2_test", object: "v2.core.account", identity: { country: "NL" } }));
        if (req.url === "/v2/core/account_links") return res.end(JSON.stringify({ object: "v2.core.account_link", url: "https://accounts.stripe.com/r/acct_v2_test#alu_test" }));
        if (req.url?.startsWith("/v1/accounts/")) return res.end(JSON.stringify({ id: "acct_v2_test", object: "account", charges_enabled: false, details_submitted: false }));
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: "unexpected path" } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("creates the account with POST /v2/core/accounts as JSON, on the pinned API version", async () => {
    const client = stripeClient({ host: "127.0.0.1", port, protocol: "http" });
    const created = await client.createAccount(
      {
        display_name: "Clinic",
        contact_email: "owner@clinic.example",
        dashboard: "full",
        identity: { country: "nl" },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        metadata: { tenantId: "t1" },
        include: ["identity"],
      },
      "connect-account-v2-t1-NL",
    );
    expect(created).toMatchObject({ id: "acct_v2_test", identity: { country: "NL" } });

    const req = seen.find((s) => s.path === "/v2/core/accounts")!;
    expect(req.method).toBe("POST");
    expect(req.headers["stripe-version"]).toBe(STRIPE_V2_API_VERSION);
    expect(req.headers["idempotency-key"]).toBe("connect-account-v2-t1-NL");
    expect(String(req.headers["content-type"])).toContain("application/json");
    expect(JSON.parse(req.body)).toMatchObject({
      dashboard: "full",
      identity: { country: "nl" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    });
  });

  it("creates onboarding links with POST /v2/core/account_links", async () => {
    const client = stripeClient({ host: "127.0.0.1", port, protocol: "http" });
    const link = await client.createAccountLink({
      account: "acct_v2_test",
      use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], refresh_url: "https://x/r", return_url: "https://x/d" } },
    });
    expect(link.url).toBe("https://accounts.stripe.com/r/acct_v2_test#alu_test");

    const req = seen.find((s) => s.path === "/v2/core/account_links")!;
    expect(req.method).toBe("POST");
    expect(req.headers["stripe-version"]).toBe(STRIPE_V2_API_VERSION);
    expect(JSON.parse(req.body)).toEqual({
      account: "acct_v2_test",
      use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], refresh_url: "https://x/r", return_url: "https://x/d" } },
    });
  });

  it("reads the account through GET /v1/accounts/:id", async () => {
    const client = stripeClient({ host: "127.0.0.1", port, protocol: "http" });
    const account = await client.retrieveAccount("acct_v2_test");
    expect(account).toMatchObject({ id: "acct_v2_test", charges_enabled: false });
    expect(seen.some((s) => s.method === "GET" && s.path === "/v1/accounts/acct_v2_test")).toBe(true);
  });
});
