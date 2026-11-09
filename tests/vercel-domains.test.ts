import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { describeError, vercelConfig, vercelDomainsApi, VercelApiError } = await import("@/lib/vercel-domains");

const TOKEN = "vercel-token-should-never-be-seen";
const config = { token: TOKEN, projectId: "prj_123", teamId: "team_456" };

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(answers: { status: number; body?: unknown }[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const impl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const next = answers.shift() ?? { status: 500 };
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status });
  };
  return { impl: impl as never, calls };
}

describe("whether Vercel is configured at all", () => {
  it("needs both a token and a project", () => {
    expect(vercelConfig({ VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "p" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ token: "t", projectId: "p" });
    expect(vercelConfig({ VERCEL_API_TOKEN: "t" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(vercelConfig({ VERCEL_PROJECT_ID: "p" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(vercelConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    // Whitespace is not configuration.
    expect(vercelConfig({ VERCEL_API_TOKEN: "  ", VERCEL_PROJECT_ID: "p" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("carries a team only when there is one", () => {
    expect(vercelConfig({ VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "p", VERCEL_TEAM_ID: "team" } as unknown as NodeJS.ProcessEnv)).toHaveProperty("teamId", "team");
    expect(vercelConfig({ VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "p", VERCEL_TEAM_ID: "" } as unknown as NodeJS.ProcessEnv)).not.toHaveProperty("teamId");
  });
});

describe("attaching a domain", () => {
  it("posts it to the project, on the team, with the token", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { name: "app.clinicname.nl", verified: false, verification: [] } }]);
    const result = await vercelDomainsApi(config, impl).add("app.clinicname.nl");

    expect(result).toEqual({ name: "app.clinicname.nl", verified: false, verification: [] });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://api.vercel.com/v10/projects/prj_123/domains?teamId=team_456");
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ name: "app.clinicname.nl" });
  });

  it("leaves the team out when the project is personal", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { verified: true } }]);
    await vercelDomainsApi({ token: TOKEN, projectId: "prj_123" }, impl).add("app.clinicname.nl");
    expect(calls[0]!.url).not.toContain("teamId");
  });

  it("hands back the ownership challenge when Vercel wants one", async () => {
    const verification = [{ type: "TXT", domain: "_vercel.clinicname.nl", value: "vc-domain-verify=abc", reason: "pending_domain_verification" }];
    const { impl } = fakeFetch([{ status: 200, body: { name: "app.clinicname.nl", verified: false, verification } }]);
    expect(await vercelDomainsApi(config, impl).add("app.clinicname.nl")).toMatchObject({ verified: false, verification });
  });

  it("treats a domain already on this project as the state we wanted", async () => {
    // Retrying an attach that half-succeeded must not look like a failure.
    const { impl, calls } = fakeFetch([
      { status: 409, body: { error: { code: "domain_already_exists", message: "already" } } },
      { status: 200, body: { name: "app.clinicname.nl", verified: true, verification: [] } },
    ]);
    expect(await vercelDomainsApi(config, impl).add("app.clinicname.nl")).toMatchObject({ verified: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.method).toBe("GET");
  });

  it("throws Vercel's own code when it refuses", async () => {
    const { impl } = fakeFetch([{ status: 409, body: { error: { code: "domain_already_in_use", message: "used elsewhere" } } }, { status: 404 }]);
    await expect(vercelDomainsApi(config, impl).add("app.clinicname.nl")).rejects.toThrow(VercelApiError);
  });
});

describe("looking at, verifying and removing", () => {
  it("reads a domain back", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { name: "app.clinicname.nl", verified: true } }]);
    expect(await vercelDomainsApi(config, impl).get("app.clinicname.nl")).toMatchObject({ verified: true });
    expect(calls[0]!.url).toContain("/v9/projects/prj_123/domains/app.clinicname.nl");
  });

  it("says null for a domain that is not on the project", async () => {
    const { impl } = fakeFetch([{ status: 404, body: { error: { code: "not_found", message: "no" } } }]);
    expect(await vercelDomainsApi(config, impl).get("app.clinicname.nl")).toBeNull();
  });

  it("asks for a fresh look", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { verified: true } }]);
    expect(await vercelDomainsApi(config, impl).verify("app.clinicname.nl")).toMatchObject({ verified: true });
    expect(calls[0]!.url).toContain("/verify");
    expect(calls[0]!.method).toBe("POST");
  });

  it("removes it, and removing it twice is not a failure", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: {} }, { status: 404, body: { error: { code: "not_found" } } }]);
    const api = vercelDomainsApi(config, impl);
    await expect(api.remove("app.clinicname.nl")).resolves.toBeUndefined();
    await expect(api.remove("app.clinicname.nl")).resolves.toBeUndefined();
    expect(calls[0]!.method).toBe("DELETE");
  });

  it("survives a reply that is not JSON at all", async () => {
    // A gateway error page is somebody else's HTML; it must not crash the call.
    const impl = (async () => new Response("<html>502</html>", { status: 502 })) as never;
    await expect(vercelDomainsApi(config, impl).get("app.clinicname.nl")).rejects.toThrow(/502/);
  });
});

describe("what an administrator is shown", () => {
  it("explains the failures that have a human cause", () => {
    expect(describeError(new VercelApiError("x", "domain_already_in_use", 409))).toMatch(/another Vercel project/);
    expect(describeError(new VercelApiError("x", "forbidden", 403))).toMatch(/VERCEL_API_TOKEN/);
    expect(describeError(new VercelApiError("x", "invalid_domain", 400))).toMatch(/does not accept/);
  });

  it("falls back to Vercel's message, then to a plain sentence", () => {
    expect(describeError(new VercelApiError("something specific", "odd_code", 400))).toBe("something specific");
    expect(describeError(new TypeError("fetch failed"))).toMatch(/Could not reach Vercel/);
  });

  it("never leaks the token, even through a message we did not write", () => {
    // One branch shows Vercel's own text. We do not control what goes in it,
    // so the token is taken back out on the way to the screen.
    process.env.VERCEL_API_TOKEN = TOKEN;
    try {
      const leaky = new VercelApiError(`request failed with Bearer ${TOKEN}`, "odd_code", 500);
      expect(describeError(leaky)).not.toContain(TOKEN);
      expect(describeError(leaky)).toContain("[redacted]");
      expect(describeError(new TypeError(`connect ECONNREFUSED ${TOKEN}`))).not.toContain(TOKEN);
    } finally {
      delete process.env.VERCEL_API_TOKEN;
    }
  });
});
