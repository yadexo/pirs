import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * The host tables against a domain this codebase has never seen.
 *
 * tests/portal-hosts.test.ts derives its hosts from the same environment the
 * code reads, which makes its membership assertions tautological — fine
 * there, because its subject is the normalisation. This file is the other
 * half: it sets a domain nothing could have hardcoded and proves the tables
 * actually follow it, which is what catches a literal left behind in a
 * rename.
 *
 * The tables are module-level consts evaluated at import, so each case needs
 * a fresh module registry. Confined to this one file so only it pays for the
 * dynamic imports.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function withEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return import("@/lib/portal-hosts");
}

describe("the host tables follow the configured root domain", () => {
  it("serves the client app on a root domain the code has never heard of", async () => {
    const { isClientHost, clientAppScope } = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "example.test" });

    expect(isClientHost("example.test")).toBe(true);
    expect(isClientHost("www.example.test")).toBe(true);
    expect(clientAppScope("example.test")).toBe("/");

    // The shipped default must not survive a configured domain — this is the
    // assertion that fails if a literal was left behind somewhere.
    expect(isClientHost("deza.ai")).toBe(false);
    expect(isClientHost("www.deza.ai")).toBe(false);
  });

  it("derives each subdomain login from it", async () => {
    const { loginForHost, CLINIC_LOGIN, ADMIN_LOGIN } = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "example.test" });

    expect(loginForHost("clinic.example.test")).toBe(CLINIC_LOGIN);
    expect(loginForHost("admin.example.test")).toBe(ADMIN_LOGIN);
    expect(loginForHost("clinic.deza.ai")).toBeNull();
  });

  it("lets a single host be overridden without moving the others", async () => {
    const { loginForHost, CLINIC_LOGIN, ADMIN_LOGIN } = await withEnv({
      NEXT_PUBLIC_ROOT_DOMAIN: "example.test",
      CLINIC_HOST: "portal.example.test",
    });

    expect(loginForHost("portal.example.test")).toBe(CLINIC_LOGIN);
    expect(loginForHost("clinic.example.test")).toBeNull();
    // The admin host still follows the root domain.
    expect(loginForHost("admin.example.test")).toBe(ADMIN_LOGIN);
  });

  it("treats the login subdomain as a host only when one is configured", async () => {
    const off = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "example.test", LOGIN_HOST: undefined });
    expect(off.loginForHost("login.example.test")).toBeNull();

    const on = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "example.test", LOGIN_HOST: "login.example.test" });
    expect(on.loginForHost("login.example.test")).toBe(on.CLINIC_LOGIN);
  });

  it("adds extra client hosts, normalised, ignoring the blanks", async () => {
    const { isClientHost, clientAppScope } = await withEnv({
      NEXT_PUBLIC_ROOT_DOMAIN: "example.test",
      NEXT_PUBLIC_EXTRA_CLIENT_HOSTS: " Staging.Example.Test , ,preview.example.test",
    });

    expect(isClientHost("staging.example.test")).toBe(true);
    expect(isClientHost("preview.example.test")).toBe(true);
    expect(clientAppScope("staging.example.test")).toBe("/");
    // An empty entry must not become a host that matches everything.
    expect(isClientHost("")).toBe(false);
    expect(isClientHost(null)).toBe(false);
  });

  it("falls back to the default rather than matching nothing, or everything", async () => {
    // A variable set to an empty string in a dashboard is still a string: with
    // `??` instead of `||` the root domain would be "", CLIENT_HOSTS would be
    // {"", "www."}, and since normaliseHost(null) is also "" every request
    // without a host header would look like the client app.
    const { isClientHost } = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "" });

    expect(isClientHost("deza.ai")).toBe(true);
    expect(isClientHost("")).toBe(false);
    expect(isClientHost(null)).toBe(false);
    expect(isClientHost(undefined)).toBe(false);
  });

  it("accepts a root domain pasted with a scheme, port or stray case", async () => {
    const { isClientHost } = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "Example.Test:443" });
    expect(isClientHost("example.test")).toBe(true);
  });
});
