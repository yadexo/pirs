/**
 * One log line per transactional email, saying whether it went.
 *
 * Until this existed a reset, welcome or invite that never left the building
 * left nothing behind: the provider's answer was thrown away, and the person
 * was told "sent" either way. The line carries what kind of email it was and,
 * on failure, why — never who it was for.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { logEmailSend } from "@/lib/emails/send-log";

afterEach(() => vi.restoreAllMocks());

describe("logging an email send", () => {
  it("says sent, as info, with the kind and nothing else", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logEmailSend("password_reset", { providerMessageId: "re_1", status: "SENT" });
    expect(info).toHaveBeenCalledWith("[email] kind=password_reset outcome=sent");
  });

  it("says failed, as an error, with the reason code and the provider's words", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logEmailSend("welcome_client", { providerMessageId: "", status: "FAILED", code: "http_403", error: "The mail.example.com domain is not verified." });
    expect(error).toHaveBeenCalledWith("[email] kind=welcome_client outcome=failed reason=http_403 detail=The mail.example.com domain is not verified.");
  });

  it("never prints an address, even one inside the provider's message", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logEmailSend("staff_invite", { providerMessageId: "", status: "FAILED", code: "http_422", error: "Invalid `to` field: someone.private@example.org is not allowed" });
    const line = error.mock.calls.flat().join(" ");
    expect(line).not.toContain("someone.private@example.org");
    expect(line).toContain("<address>");
  });

  it("prints ? for a reason that is not a plain code, and caps the detail", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logEmailSend("client_notice", { providerMessageId: "", status: "FAILED", code: "user@example.org", error: "x".repeat(500) });
    const line = String(error.mock.calls[0]![0]);
    expect(line).toContain("reason=? ");
    expect(line.length).toBeLessThan(300);
  });

  it("calls a failure without a code unknown", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logEmailSend("account_exists", { providerMessageId: "", status: "FAILED" });
    expect(error).toHaveBeenCalledWith("[email] kind=account_exists outcome=failed reason=unknown");
  });

  it("never lets logging be the reason something fails", () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("console gone");
    });
    expect(() => logEmailSend("platform_admin_invite", { providerMessageId: "x", status: "SENT" })).not.toThrow();
  });
});

describe("the Resend provider's reason codes", () => {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
  afterEach(() => {
    process.env.RESEND_API_KEY = saved.key;
    process.env.EMAIL_FROM = saved.from;
    if (saved.key === undefined) delete process.env.RESEND_API_KEY;
    if (saved.from === undefined) delete process.env.EMAIL_FROM;
  });

  it("not_configured without a key, http_<status> when refused, network when unreachable", async () => {
    const { ResendEmailProvider } = await import("@/lib/providers/notifications/email");
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "no-reply@mail.example.com";
    expect(await new ResendEmailProvider().send({ to: "a@example.org", body: "x" })).toMatchObject({ status: "FAILED", code: "not_configured" });

    process.env.RESEND_API_KEY = "re_test";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 }));
    expect(await new ResendEmailProvider().send({ to: "a@example.org", body: "x" })).toMatchObject({ status: "FAILED", code: "http_403", error: "domain is not verified" });

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await new ResendEmailProvider().send({ to: "a@example.org", body: "x" })).toMatchObject({ status: "FAILED", code: "network" });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id: "re_123" }), { status: 200 }));
    expect(await new ResendEmailProvider().send({ to: "a@example.org", body: "x" })).toEqual({ providerMessageId: "re_123", status: "SENT" });
  });
});
