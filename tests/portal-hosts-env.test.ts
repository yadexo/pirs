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
    const { isClientHost, clientHosts, clientAppScope } = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "example.test" });

    expect(isClientHost("login.example.test")).toBe(true);
    expect(clientAppScope("login.example.test")).toBe("/");
    // The whole composition, not just one member: this is what catches an
    // extra host nobody meant to add as well as a missing one.
    expect(clientHosts()).toEqual(["login.example.test"]);

    // The shipped default must not survive a configured domain — these are the
    // assertions that fail if a literal was left behind somewhere.
    expect(isClientHost("login.deza.ai")).toBe(false);
    expect(isClientHost("deza.ai")).toBe(false);

    // The apex and www are somebody else's website on every domain.
    expect(isClientHost("example.test")).toBe(false);
    expect(isClientHost("www.example.test")).toBe(false);
    expect(clientAppScope("example.test")).toBe("/app/");
  });

  it("derives each subdomain login from it", async () => {
    const { loginForHost, CLINIC_LOGIN, ADMIN_LOGIN } = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "example.test" });

    expect(loginForHost("app.example.test")).toBe(CLINIC_LOGIN);
    expect(loginForHost("admin.example.test")).toBe(ADMIN_LOGIN);
    expect(loginForHost("app.deza.ai")).toBeNull();
    // The host the portal used to live on is not special any more.
    expect(loginForHost("clinic.example.test")).toBeNull();
  });

  it("lets a single host be overridden without moving the others", async () => {
    const { loginForHost, isClientHost, CLINIC_LOGIN, ADMIN_LOGIN } = await withEnv({
      NEXT_PUBLIC_ROOT_DOMAIN: "example.test",
      CLINIC_HOST: "portal.example.test",
    });

    expect(loginForHost("portal.example.test")).toBe(CLINIC_LOGIN);
    expect(loginForHost("app.example.test")).toBeNull();
    // The admin and client hosts still follow the root domain.
    expect(loginForHost("admin.example.test")).toBe(ADMIN_LOGIN);
    expect(isClientHost("login.example.test")).toBe(true);
  });

  it("moves the client host on its own", async () => {
    const { isClientHost, clientHosts, loginForHost, ADMIN_LOGIN } = await withEnv({
      NEXT_PUBLIC_ROOT_DOMAIN: "example.test",
      NEXT_PUBLIC_CLIENT_HOST: "clients.example.test",
    });

    expect(clientHosts()).toEqual(["clients.example.test"]);
    expect(isClientHost("login.example.test")).toBe(false);
    expect(loginForHost("admin.example.test")).toBe(ADMIN_LOGIN);
  });

  it("adds extra client hosts, normalised, ignoring the blanks", async () => {
    // The shape a white-label clinic domain has: the client app answers on it
    // identically to the default host, with no further code change.
    const { isClientHost, clientHosts, clientAppScope } = await withEnv({
      NEXT_PUBLIC_ROOT_DOMAIN: "example.test",
      NEXT_PUBLIC_EXTRA_CLIENT_HOSTS: " App.Riverside-Clinic.test , ,my.glowstudio.test",
    });

    expect(isClientHost("app.riverside-clinic.test")).toBe(true);
    expect(isClientHost("my.glowstudio.test")).toBe(true);
    expect(clientAppScope("app.riverside-clinic.test")).toBe("/");
    // The default host stays alongside them, not replaced by them.
    expect(clientHosts()).toEqual(["login.example.test", "app.riverside-clinic.test", "my.glowstudio.test"]);
    // Staging serves the long /app/<clinic> form and must not end up in here.
    expect(isClientHost("staging.example.test")).toBe(false);
    // An empty entry must not become a host that matches everything.
    expect(isClientHost("")).toBe(false);
    expect(isClientHost(null)).toBe(false);
  });

  it("falls back to the default rather than matching nothing, or everything", async () => {
    // A variable set to an empty string in a dashboard is still a string: with
    // `??` instead of `||` the root domain would be "" and every host below it
    // a bare label — "login.", "app." — that resolves to nothing at all.
    const { isClientHost, loginForHost, CLINIC_LOGIN } = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "" });

    expect(isClientHost("login.deza.ai")).toBe(true);
    expect(loginForHost("app.deza.ai")).toBe(CLINIC_LOGIN);
    expect(isClientHost("login.")).toBe(false);
    expect(isClientHost("")).toBe(false);
    expect(isClientHost(null)).toBe(false);
    expect(isClientHost(undefined)).toBe(false);
  });

  it("accepts a root domain pasted with a scheme, port or stray case", async () => {
    const { isClientHost } = await withEnv({ NEXT_PUBLIC_ROOT_DOMAIN: "Example.Test:443" });
    expect(isClientHost("login.example.test")).toBe(true);
  });
});
