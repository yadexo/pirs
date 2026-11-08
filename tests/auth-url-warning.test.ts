import { describe, it, expect, afterEach, vi } from "vitest";
import { authUrlWarning } from "@/lib/auth-url-warning";

describe("the AUTH_URL / NEXTAUTH_URL warning", () => {
  it("says nothing when neither is set — the supported setup", () => {
    expect(authUrlWarning({})).toBeNull();
    // A variable set to an empty or blank string in a dashboard is still a string.
    expect(authUrlWarning({ AUTH_URL: "", NEXTAUTH_URL: "   " })).toBeNull();
  });

  it("warns for AUTH_URL, naming the origin it pins", () => {
    const text = authUrlWarning({ AUTH_URL: "https://app.deza.ai" })!;
    expect(text).toContain("AUTH_URL is set (https://app.deza.ai)");
    expect(text).toMatch(/other host/);
    expect(text).toMatch(/Unset it/);
  });

  it("warns for NEXTAUTH_URL too — Auth.js reads either", () => {
    expect(authUrlWarning({ NEXTAUTH_URL: "https://app.deza.ai" })).toContain("NEXTAUTH_URL is set (https://app.deza.ai)");
  });

  it("says so once, in the plural, when both are set", () => {
    const text = authUrlWarning({ AUTH_URL: "https://app.deza.ai", NEXTAUTH_URL: "https://app.deza.ai" })!;
    expect(text).toContain("AUTH_URL and NEXTAUTH_URL are set (https://app.deza.ai)");
    // Same origin twice is not listed twice.
    expect(text.match(/https:\/\/app\.deza\.ai/g)).toHaveLength(1);
  });

  it("lists both origins when they differ", () => {
    const text = authUrlWarning({ AUTH_URL: "https://app.deza.ai", NEXTAUTH_URL: "http://localhost:3000" })!;
    expect(text).toContain("https://app.deza.ai");
    expect(text).toContain("http://localhost:3000");
  });

  it("prints the origin only — never a path, query or credentials that came with it", () => {
    const text = authUrlWarning({ AUTH_URL: "https://someone:hunter2@app.deza.ai/api/auth?token=abc123#frag" })!;
    expect(text).toContain("(https://app.deza.ai)");
    for (const leak of ["hunter2", "someone", "abc123", "/api/auth", "frag"]) expect(text).not.toContain(leak);
  });

  it("doesn't throw on a value that isn't a URL, and doesn't echo it", () => {
    const text = authUrlWarning({ AUTH_URL: "not a url, but secret-ish" })!;
    expect(text).toContain("an unreadable value");
    expect(text).not.toContain("secret-ish");
  });

  it("only warns: it takes the environment and changes nothing in it", () => {
    const env = { AUTH_URL: "https://app.deza.ai" };
    authUrlWarning(env);
    expect(env).toEqual({ AUTH_URL: "https://app.deza.ai" });
  });
});

describe("the startup hook", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  async function startUp(env: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { register } = await import("@/instrumentation");
    register();
    return warn;
  }

  it("warns once in the Node runtime when the variable is set", async () => {
    const warn = await startUp({ NEXT_RUNTIME: "nodejs", AUTH_URL: undefined, NEXTAUTH_URL: "https://app.deza.ai" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("NEXTAUTH_URL is set");
  });

  it("stays quiet in the Edge runtime, which starts as well, so it isn't said twice", async () => {
    const warn = await startUp({ NEXT_RUNTIME: "edge", AUTH_URL: "https://app.deza.ai" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet when nothing is set", async () => {
    const warn = await startUp({ NEXT_RUNTIME: "nodejs", AUTH_URL: undefined, NEXTAUTH_URL: undefined });
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves the variable in place — Auth.js still sees exactly what was set", async () => {
    await startUp({ NEXT_RUNTIME: "nodejs", AUTH_URL: "https://app.deza.ai" });
    expect(process.env.AUTH_URL).toBe("https://app.deza.ai");
  });
});
