import { describe, it, expect, vi, afterEach } from "vitest";
import { buildErrorReport, buildSentryEnvelope, parseSentryDsn, reportError } from "@/lib/observability";

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

describe("Sentry, with no SDK", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses a real DSN into where to send the envelope and the key to send it with", () => {
    const target = parseSentryDsn("https://abc123@o456.ingest.sentry.io/789");
    expect(target).toEqual({ ingestUrl: "https://o456.ingest.sentry.io/api/789/envelope/", publicKey: "abc123", dsn: "https://abc123@o456.ingest.sentry.io/789" });
  });

  it("handles a self-hosted DSN with a path prefix before the project id", () => {
    const target = parseSentryDsn("https://abc123@sentry.example.com/sentry/789");
    expect(target?.ingestUrl).toBe("https://sentry.example.com/api/789/envelope/");
  });

  it("is null for anything unset, empty or malformed — Sentry reporting is simply off", () => {
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn("")).toBeNull();
    expect(parseSentryDsn("not a url")).toBeNull();
    expect(parseSentryDsn("https://o456.ingest.sentry.io/789")).toBeNull(); // no public key
  });

  it("builds an envelope Sentry's ingest API accepts: two JSON lines, the DSN and the event carrying no PII", () => {
    const target = parseSentryDsn("https://abc123@o456.ingest.sentry.io/789")!;
    const report = buildErrorReport(new TypeError("boom"), { path: "/m/abc/shop", method: "POST" }, { routePath: "/m/[merchantId]/shop", routeType: "render" });
    const lines = buildSentryEnvelope(report, target).split("\n");
    expect(lines).toHaveLength(3);
    const [header, item, event] = lines.map((l) => JSON.parse(l));
    expect(header.dsn).toBe(target.dsn);
    expect(item).toEqual({ type: "event" });
    expect(event.message.formatted).toBe("TypeError: boom");
    expect(event.tags).toMatchObject({ route: "/m/[merchantId]/shop", method: "POST" });
    expect(JSON.stringify(event)).not.toMatch(/password|cookie|authorization/i);
  });

  it("sends to Sentry's ingest API only when SENTRY_DSN is set, with the Sentry auth header", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const report = buildErrorReport(new Error("x"), { path: "/", method: "GET" });

    await reportError(report, {});
    expect(fetchMock).not.toHaveBeenCalled();

    await reportError(report, { SENTRY_DSN: "https://abc123@o456.ingest.sentry.io/789" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://o456.ingest.sentry.io/api/789/envelope/",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "X-Sentry-Auth": expect.stringContaining("sentry_key=abc123") }) }),
    );
  });

  it("tags the environment it ran in, which lands in the envelope's event too", () => {
    vi.stubEnv("APP_ENV", "staging");
    const report = buildErrorReport(new Error("x"), { path: "/", method: "GET" });
    expect(report.environment).toBe("staging");
    const target = parseSentryDsn("https://abc123@o456.ingest.sentry.io/789")!;
    const event = JSON.parse(buildSentryEnvelope(report, target).split("\n")[2]!);
    expect(event.environment).toBe("staging");
    vi.unstubAllEnvs();
  });

  it("never throws when Sentry is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(
      reportError(buildErrorReport(new Error("x"), { path: "/", method: "GET" }), { SENTRY_DSN: "https://abc123@o456.ingest.sentry.io/789" }),
    ).resolves.toBeUndefined();
  });
});
