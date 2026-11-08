import { describe, it, expect, afterEach, vi } from "vitest";
import { formatSignInLine, logSignIn, type SignInOutcome } from "@/lib/signin-log";

afterEach(() => vi.restoreAllMocks());

describe("the sign-in log line", () => {
  it("is one searchable line with a reason code", () => {
    expect(formatSignInLine("wrong_password", { audience: "staff", portal: "unified", role: "PLATFORM_ADMIN" })).toBe(
      "[signin] outcome=wrong_password audience=staff portal=unified role=PLATFORM_ADMIN",
    );
  });

  it("is just the code when there is nothing else to say", () => {
    expect(formatSignInLine("session_refused_no_auth_time")).toBe("[signin] outcome=session_refused_no_auth_time");
  });

  it("lists the roles an address is on, sorted, so the same case always reads the same", () => {
    expect(formatSignInLine("multiple_accounts_for_email", { roles: ["CUSTOMER", "PLATFORM_ADMIN"] })).toBe(
      "[signin] outcome=multiple_accounts_for_email roles=CUSTOMER+PLATFORM_ADMIN",
    );
    expect(formatSignInLine("multiple_accounts_for_email", { roles: ["PLATFORM_ADMIN", "CUSTOMER"] })).toBe(
      "[signin] outcome=multiple_accounts_for_email roles=CUSTOMER+PLATFORM_ADMIN",
    );
  });

  it("shows how far ahead a refused session's cut-off was, in whole seconds", () => {
    expect(formatSignInLine("session_refused_after_reset", { ahead_s: 187.6 })).toBe("[signin] outcome=session_refused_after_reset ahead_s=188");
    // Zero is a real answer, not an absent one.
    expect(formatSignInLine("session_refused_after_reset", { ahead_s: 0 })).toContain("ahead_s=0");
  });
});

describe("nothing that identifies anyone can reach a log line", () => {
  // These are not values the code passes today. They are the values that would
  // be a leak if a future change passed the wrong variable.
  const leaks = [
    "someone@example.com",
    "pat@clinic.example.test",
    "a very long free-form sentence with spaces",
    "203.0.113.7",
    "2001:db8::1",
    "https://admin.deza.ai/agency",
    "/m/abc123",
    "x".repeat(65),
    "line\nbreak",
    "tab\tseparated",
  ];

  it.each(leaks)("prints %j as a question mark", (value) => {
    const line = formatSignInLine("wrong_password", { audience: value as never, portal: value, role: value });
    expect(line).toBe("[signin] outcome=wrong_password audience=? portal=? role=?");
    expect(line).not.toContain(value);
  });

  it("leaves out a value that is empty rather than printing a question mark for nothing", () => {
    expect(formatSignInLine("wrong_password", { portal: "", role: "" })).toBe("[signin] outcome=wrong_password");
  });

  it("applies the same rule to each role in a list", () => {
    expect(formatSignInLine("ambiguous_email", { roles: ["PLATFORM_ADMIN", "me@example.com"] })).toBe("[signin] outcome=ambiguous_email roles=?");
  });

  it("can never span two lines, so a value cannot forge a second log entry", () => {
    const line = formatSignInLine("wrong_password", { portal: "unified\n[signin] outcome=success" });
    expect(line).not.toContain("\n");
    expect(line.match(/\[signin\]/g)).toHaveLength(1);
  });
});

describe("logging a sign-in", () => {
  it("warns for a failure", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logSignIn("wrong_password", { audience: "staff" });
    expect(warn).toHaveBeenCalledWith("[signin] outcome=wrong_password audience=staff");
    expect(info).not.toHaveBeenCalled();
  });

  it("only informs for what is expected in normal use", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    for (const outcome of ["success", "two_factor_required", "multiple_accounts_for_email"] as SignInOutcome[]) logSignIn(outcome);
    expect(info).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats every refused session as a warning — it is the thing being hunted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcomes: SignInOutcome[] = ["session_refused_account_inactive", "session_refused_staff_blocked", "session_refused_after_reset", "session_refused_no_auth_time"];
    for (const outcome of outcomes) logSignIn(outcome);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("never lets logging be the reason a sign-in fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("the log sink is down");
    });
    expect(() => logSignIn("wrong_password")).not.toThrow();
  });
});
