import { describe, it, expect } from "vitest";
import { applySecurityHeaders, buildCsp } from "@/lib/security-headers";

describe("security headers", () => {
  it("the CSP carries the given nonce, in script-src only", () => {
    const csp = buildCsp("abc123");
    expect(csp).toContain("'nonce-abc123'");
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("extends trust to scripts Next's own runtime injects for code-split chunks (strict-dynamic)", () => {
    const scriptSrc = buildCsp("abc123")
      .split(";")
      .find((d) => d.trim().startsWith("script-src"))!;
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("lets the client app's service worker register — worker-src, not just script-src", () => {
    expect(buildCsp("n")).toMatch(/worker-src 'self'/);
  });

  it("allows Stripe to run: script, connect and frame", () => {
    const csp = buildCsp("n");
    expect(csp).toContain("https://js.stripe.com");
    expect(csp).toContain("https://api.stripe.com");
    expect(csp).toMatch(/frame-src[^;]*js\.stripe\.com/);
  });

  it("blocks framing by anyone — the CSP-native and the legacy header both", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "n", true);
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets HSTS only when the connection is actually HTTPS", () => {
    const https = new Headers();
    applySecurityHeaders(https, "n", true);
    expect(https.get("Strict-Transport-Security")).toMatch(/max-age=\d+/);

    const http = new Headers();
    applySecurityHeaders(http, "n", false);
    expect(http.get("Strict-Transport-Security")).toBeNull();
  });

  it("can skip the CSP entirely — for the service worker script, which registers no nonce and is refused by Chrome if its own response carries one", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "n", true, { skipCsp: true });
    expect(headers.get("Content-Security-Policy")).toBeNull();
    expect(headers.get("X-Frame-Options")).toBe("DENY"); // everything else still applies
  });

  it("sets a referrer policy and nosniff on every response", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "n", false);
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
