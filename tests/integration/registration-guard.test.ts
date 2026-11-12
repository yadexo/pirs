/**
 * The gate in front of both register pages: is registration open, has this
 * address guessed too often, and is the code right — in that order, with a
 * guess always costing an attempt.
 */
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";

vi.mock("server-only", () => ({}));
let ip = "203.0.113.70";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": ip }) }));
// The real message files, so a missing key here is a failure here.
vi.mock("next-intl/server", async () => {
  const en = (await import("@/messages/en.json")).default as Record<string, unknown>;
  const get = (path: string) => path.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
  return {
    getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) => {
      const value = get(`${namespace}.${key}`);
      if (typeof value !== "string") throw new Error(`missing message ${namespace}.${key}`);
      return value.replace(/\{(\w+)[^}]*\}/g, (_, name) => String(values?.[name] ?? `{${name}}`));
    },
  };
});

const { guardRegistration, CODE_ATTEMPTS_PER_EMAIL, CODE_ATTEMPTS_PER_IP, WRONG_CODES_PER_HOUR_EVERYONE } = await import("@/lib/registration-guard");

const CODE = "081946";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
/** Every [register] line one call wrote. */
async function run(kind: "admin" | "clinic", fields: Record<string, string>) {
  const lines: string[] = [];
  const record = (...args: unknown[]) => String(args[0]).startsWith("[register]") && lines.push(String(args[0]));
  vi.spyOn(console, "warn").mockImplementation(record);
  vi.spyOn(console, "info").mockImplementation(record);
  const result = await guardRegistration(kind, form(fields));
  return { result, lines };
}

const stamp = Date.now();
const email = `rg-${stamp}@example.com`;
const clearLimits = () => rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: "register-code:" } } });

describe("the registration gate", () => {
  beforeEach(async () => {
    process.env.REGISTRATION_CODE = CODE;
    ip = "203.0.113.70";
    await clearLimits();
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    delete process.env.REGISTRATION_CODE;
    await clearLimits();
  });

  it("lets the right code through, saying nothing", async () => {
    const { result, lines } = await run("clinic", { email, code: CODE });
    expect(result).toBeNull();
    // Success is the action's to log, once it has actually created something.
    expect(lines).toEqual([]);
  });

  it("refuses a wrong code and a missing one with the very same message", async () => {
    const wrong = await run("admin", { email, code: "081945" });
    await clearLimits();
    const missing = await run("admin", { email });
    expect(wrong.result?.error).toBe("That code is not valid.");
    expect(missing.result?.error).toBe(wrong.result?.error);
    // Told apart only in the logs.
    expect(wrong.lines).toEqual(["[register] outcome=code_wrong portal=admin"]);
    expect(missing.lines).toEqual(["[register] outcome=code_missing portal=admin"]);
  });

  it("never writes the code, or anything typed in its place, into a log line", async () => {
    const { lines } = await run("clinic", { email, code: CODE.slice(0, 5) + "7" });
    const all = lines.join("\n");
    expect(all).not.toContain(CODE);
    expect(all).not.toContain("0819");
    expect(all).not.toContain("@");
  });

  it("is closed when no code is configured, whatever is typed", async () => {
    delete process.env.REGISTRATION_CODE;
    for (const code of [CODE, "", "anything"]) {
      await clearLimits();
      const { result, lines } = await run("clinic", { email, code });
      expect(result?.error).toBe("Registration is closed.");
      expect(lines).toEqual(["[register] outcome=disabled portal=clinic"]);
    }
  });

  it("is closed when the code is only whitespace", async () => {
    process.env.REGISTRATION_CODE = "   ";
    const { result } = await run("admin", { email, code: "   " });
    expect(result?.error).toBe("Registration is closed.");
  });

  it("stops guessing from one address after its limit, before looking at the code", async () => {
    ip = `203.0.113.${(stamp % 50) + 100}`;
    let last = await run("admin", { code: "000000" });
    for (let i = 0; i < CODE_ATTEMPTS_PER_IP; i++) last = await run("admin", { code: "000000" });
    expect(last.lines).toEqual(["[register] outcome=rate_limited_ip portal=admin"]);
    expect(last.result?.error).toMatch(/Too many attempts/);
    // And the right code does not lift it early.
    const correct = await run("admin", { code: CODE });
    expect(correct.result?.error).toMatch(/Too many attempts/);
  });

  it("stops guessing against one email after its own, lower limit", async () => {
    const target = `rg-target-${stamp}@example.com`;
    let last = await run("clinic", { email: target, code: "000000" });
    for (let i = 0; i < CODE_ATTEMPTS_PER_EMAIL; i++) {
      // A fresh address each time, so only the email counter can trip.
      ip = `198.51.100.${i + 20}`;
      last = await run("clinic", { email: target, code: "000000" });
    }
    expect(last.lines).toEqual(["[register] outcome=rate_limited_email portal=clinic"]);
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: "register-code:ip:198.51.100." } } });
  });

  it("counts an attempt even when the rest of the form is empty", async () => {
    const used = async () => (await rawDb.rateLimitBucket.findUnique({ where: { key: "register-code:ip:203.0.113.70" } }))?.count ?? 0;
    await run("clinic", {});
    expect(await used()).toBe(1);
    await run("clinic", { code: CODE });
    expect(await used()).toBe(2);
  });

  it("limits a submission with no email at all by address only", async () => {
    const { result } = await run("admin", { code: CODE });
    expect(result).toBeNull();
    expect(await rawDb.rateLimitBucket.count({ where: { key: "register-code:email:" } })).toBe(0);
  });

  describe("wrong codes from everyone put together", () => {
    /** A different address and a different email every time: neither of the other limits ever trips. */
    const guessFromSomewhereNew = async (i: number, code: string) => {
      ip = `198.51.100.${(i % 250) + 1}`;
      return run("admin", { email: `guess-${i}-${stamp}@example.com`, code });
    };

    it("pauses registration once enough have been tried, however many addresses they came from", async () => {
      for (let i = 0; i < WRONG_CODES_PER_HOUR_EVERYONE; i++) {
        const { lines } = await guessFromSomewhereNew(i, "000000");
        expect(lines).toEqual(["[register] outcome=code_wrong portal=admin"]);
      }
      const next = await guessFromSomewhereNew(999, "000001");
      expect(next.result).toHaveProperty("error");
      expect(next.lines).toEqual(["[register] outcome=rate_limited_everyone portal=admin"]);
    });

    it("refuses the right code too while it is paused — or the limit would only slow the wrong ones", async () => {
      for (let i = 0; i < WRONG_CODES_PER_HOUR_EVERYONE; i++) await guessFromSomewhereNew(i, "000000");
      const right = await guessFromSomewhereNew(1000, CODE);
      expect(right.result).toHaveProperty("error");
      expect(right.lines).toEqual(["[register] outcome=rate_limited_everyone portal=admin"]);
    });

    it("is not spent by right codes, or by forms sent with no code at all", async () => {
      for (let i = 0; i < WRONG_CODES_PER_HOUR_EVERYONE + 5; i++) {
        expect((await guessFromSomewhereNew(i, CODE)).result).toBeNull();
        await guessFromSomewhereNew(5000 + i, "");
      }
      expect(await rawDb.rateLimitBucket.count({ where: { key: "register-code:wrong:everyone" } })).toBe(0);
    });

    it("opens again when the hour is up", async () => {
      for (let i = 0; i < WRONG_CODES_PER_HOUR_EVERYONE; i++) await guessFromSomewhereNew(i, "000000");
      expect((await guessFromSomewhereNew(2000, CODE)).result).toHaveProperty("error");
      await rawDb.rateLimitBucket.updateMany({ where: { key: "register-code:wrong:everyone" }, data: { resetAt: new Date(Date.now() - 1000) } });
      expect((await guessFromSomewhereNew(2001, CODE)).result).toBeNull();
    });
  });
});
