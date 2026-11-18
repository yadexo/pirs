/**
 * What the mock email provider does, depending on where the code is running.
 *
 * It is the default whenever EMAIL_PROVIDER is not "resend". On a developer's
 * machine that is what it is for: it prints the email so a reset link can be
 * followed without a mail account. In real production it used to do the same
 * — report every email as sent, print a line nobody reads, and send nothing —
 * which is how a missing EMAIL_PROVIDER went unnoticed. It now refuses there,
 * the same way the mock payment provider does (docs/security/review-2026-11.md,
 * P-2), and no environment that keeps its logs gets the recipient's address.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockChannelProvider } from "@/lib/providers/notifications/mock";

const KEYS = ["VERCEL_ENV", "APP_ENV", "NODE_ENV"] as const;
const TO = "someone.private@example.org";
const env = process.env as Record<string, string | undefined>;

describe("the mock email provider", () => {
  const saved: Record<string, string | undefined> = {};
  let lines: string[];

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = env[key];
      delete env[key];
    }
    lines = [];
    const record = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    vi.spyOn(console, "log").mockImplementation(record);
    vi.spyOn(console, "error").mockImplementation(record);
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete env[key];
      else env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  const send = (channel = "email") => new MockChannelProvider(channel).send({ to: TO, subject: "Reset your password", body: "https://example.test/set-password?token=secret" });

  describe("on a developer's machine", () => {
    it("prints the email, recipient and link included, and calls it sent", async () => {
      env.NODE_ENV = "development";
      expect((await send()).status).toBe("SENT");
      expect(lines.join(" ")).toContain(TO);
      expect(lines.join(" ")).toContain("token=secret");
    });
  });

  describe("on staging or a local production build", () => {
    it("still calls it sent, but prints neither the recipient nor the body", async () => {
      for (const vercel of [undefined, "preview"]) {
        lines.length = 0;
        env.NODE_ENV = "production";
        if (vercel) env.VERCEL_ENV = vercel;
        expect((await send()).status, String(vercel)).toBe("SENT");
        expect(lines.join(" "), String(vercel)).not.toContain(TO);
        expect(lines.join(" "), String(vercel)).not.toContain("token=secret");
        expect(lines.join(" "), String(vercel)).toContain("[mock:email]");
      }
    });

    it("leaves the recipient out for the other channels too", async () => {
      env.NODE_ENV = "production";
      await send("sms");
      await send("push");
      expect(lines.join(" ")).not.toContain(TO);
    });
  });

  describe("in real production", () => {
    for (const [name, set] of [
      ["Vercel's production environment", () => (env.VERCEL_ENV = "production")],
      ["APP_ENV=production on any other host", () => (env.APP_ENV = "production")],
    ] as const) {
      describe(name, () => {
        beforeEach(() => {
          env.NODE_ENV = "production";
          set();
        });

        it("refuses instead of pretending the email went", async () => {
          const result = await send();
          expect(result).toMatchObject({ status: "FAILED", code: "not_configured" });
          // What a caller might pass on names no provider and no setting.
          expect(result.error).not.toMatch(/mock|resend|EMAIL_PROVIDER/i);
        });

        it("says so loudly, naming the setting to fix, and never the recipient", async () => {
          await send();
          const text = lines.join(" ");
          expect(text).toContain('EMAIL_PROVIDER is not "resend" in production: email NOT sent');
          expect(text).not.toContain(TO);
          expect(text).not.toContain("token=secret");
        });
      });
    }

    it("refuses only email: the other channels are not in use yet", async () => {
      env.NODE_ENV = "production";
      env.VERCEL_ENV = "production";
      expect((await send("sms")).status).toBe("SENT");
    });
  });
});
