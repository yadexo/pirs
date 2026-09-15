import { describe, it, expect, vi, afterEach } from "vitest";
import { buildErrorReport, reportError } from "@/lib/observability";

const NOW = new Date("2026-09-15T12:00:00Z");

describe("error reporting", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps what is needed to fix a bug", () => {
    const report = buildErrorReport(new TypeError("boom"), { path: "/m/abc/shop", method: "POST" }, { routePath: "/m/[merchantId]/shop", routeType: "render" }, NOW);
    expect(report).toMatchObject({
      level: "error",
      name: "TypeError",
      message: "boom",
      method: "POST",
      path: "/m/abc/shop",
      routePath: "/m/[merchantId]/shop",
      timestamp: NOW.toISOString(),
    });
    expect(report.stack).toContain("boom");
  });

  it("drops the query string, which can carry tokens", () => {
    const report = buildErrorReport(new Error("x"), { path: "/app/riverside?token=secret-token&q=client@example.com", method: "GET" });
    expect(report.path).toBe("/app/riverside");
    expect(JSON.stringify(report)).not.toMatch(/secret-token|client@example/);
  });

  it("has no field that could carry headers, cookies, bodies or identity", () => {
    const report = buildErrorReport(new Error("x"), { path: "/", method: "GET" });
    expect(Object.keys(report).sort()).toEqual(
      ["digest", "environment", "level", "message", "method", "name", "path", "routePath", "routeType", "stack", "timestamp"].sort(),
    );
  });

  it("handles thrown non-Error values", () => {
    expect(buildErrorReport("plain string", { path: "/", method: "GET" }).message).toBe("plain string");
  });

  it("logs always, and forwards only when a webhook is configured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const report = buildErrorReport(new Error("x"), { path: "/", method: "GET" });

    await reportError(report, {});
    expect(log).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    await reportError(report, { ERROR_WEBHOOK_URL: "https://alerts.example/hook" });
    expect(fetchMock).toHaveBeenCalledWith("https://alerts.example/hook", expect.objectContaining({ method: "POST" }));
  });

  it("never throws when the webhook is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(
      reportError(buildErrorReport(new Error("x"), { path: "/", method: "GET" }), { ERROR_WEBHOOK_URL: "https://alerts.example/hook" }),
    ).resolves.toBeUndefined();
  });
});
