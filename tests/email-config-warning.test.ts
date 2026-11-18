/**
 * The email settings are checked once at startup, so a deployment that cannot
 * send email says so in its first log lines instead of when someone asks for
 * a password reset and nothing arrives.
 */
import { describe, it, expect } from "vitest";
import { emailConfigWarning } from "@/lib/email-config-warning";

const KEY = "re_SuperSecretKey123";
const good = { EMAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, EMAIL_FROM: "no-reply@mail.example.com" };
const prod = (over: Record<string, string | undefined> = {}) => ({ VERCEL_ENV: "production", ...good, ...over });

describe("the startup check of the email settings", () => {
  it("says nothing when everything is set", () => {
    expect(emailConfigWarning(prod())).toBeNull();
    expect(emailConfigWarning(prod({ EMAIL_FROM: "Deza <no-reply@mail.example.com>" }))).toBeNull();
  });

  it("says nothing on a developer's machine, where the mock is the point", () => {
    expect(emailConfigWarning({ EMAIL_PROVIDER: "mock" })).toBeNull();
    expect(emailConfigWarning({})).toBeNull();
  });

  it("is an error in real production and a warning on staging", () => {
    expect(emailConfigWarning(prod({ EMAIL_PROVIDER: undefined }))?.level).toBe("error");
    expect(emailConfigWarning(prod({ APP_ENV: "production", VERCEL_ENV: undefined, EMAIL_PROVIDER: undefined }))?.level).toBe("error");
    expect(emailConfigWarning({ ...good, VERCEL_ENV: "preview", EMAIL_PROVIDER: undefined })?.level).toBe("warn");
  });

  it("names what is wrong with EMAIL_PROVIDER", () => {
    expect(emailConfigWarning(prod({ EMAIL_PROVIDER: undefined }))?.message).toMatch(/EMAIL_PROVIDER is not set/);
    expect(emailConfigWarning(prod({ EMAIL_PROVIDER: "Resend" }))?.message).toMatch(/EMAIL_PROVIDER is "Resend".*lowercase/);
    expect(emailConfigWarning(prod({ EMAIL_PROVIDER: "resend " }))?.message).toMatch(/spaces or quotes/);
    expect(emailConfigWarning(prod({ EMAIL_PROVIDER: '"resend"' }))?.message).toMatch(/spaces or quotes/);
    expect(emailConfigWarning(prod({ EMAIL_PROVIDER: "mock" }))?.message).toMatch(/EMAIL_PROVIDER is "mock"/);
  });

  it("names a missing key or sender, and a sender it cannot use", () => {
    expect(emailConfigWarning(prod({ RESEND_API_KEY: undefined }))?.message).toMatch(/RESEND_API_KEY is not set/);
    expect(emailConfigWarning(prod({ EMAIL_FROM: undefined }))?.message).toMatch(/EMAIL_FROM is not set/);
    expect(emailConfigWarning(prod({ EMAIL_FROM: "no-reply" }))?.message).toMatch(/EMAIL_FROM has no email address/);
    expect(emailConfigWarning(prod({ EMAIL_FROM: '"no-reply@mail.example.com"' }))?.message).toMatch(/EMAIL_FROM is wrapped in quotes/);
  });

  it("lists every problem at once, and starts with the tag to search for", () => {
    const warning = emailConfigWarning(prod({ EMAIL_PROVIDER: undefined, EMAIL_FROM: undefined }))!;
    expect(warning.message).toMatch(/^\[email\]/);
    expect(warning.message).toMatch(/EMAIL_PROVIDER is not set.*EMAIL_FROM is not set/);
  });

  it("never prints the key", () => {
    for (const over of [{ EMAIL_PROVIDER: undefined }, { EMAIL_FROM: "bad" }, { EMAIL_PROVIDER: "Resend" }]) {
      expect(emailConfigWarning(prod(over))?.message).not.toContain(KEY);
    }
  });
});
