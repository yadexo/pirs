import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { registrationCode, registrationCodeMatches, registrationEnabled } = await import("@/lib/registration-code");

const env = (value?: string) => ({ ...(value === undefined ? {} : { REGISTRATION_CODE: value }) }) as NodeJS.ProcessEnv;

describe("whether registration is open at all", () => {
  it("is open only when a code is configured", () => {
    expect(registrationEnabled(env("081946"))).toBe(true);
    expect(registrationCode(env("081946"))).toBe("081946");
  });

  it("is closed when the variable is missing, empty or only whitespace", () => {
    // Fail closed: forgetting to configure it must not leave sign-up open.
    for (const value of [undefined, "", "   ", "\n", "\t"]) {
      expect(registrationEnabled(env(value)), `for ${JSON.stringify(value)}`).toBe(false);
      expect(registrationCode(env(value))).toBeNull();
    }
  });

  it("accepts nothing at all while it is closed", () => {
    for (const given of ["", "081946", "anything"]) expect(registrationCodeMatches(given, env(undefined))).toBe(false);
    expect(registrationCodeMatches("", env(""))).toBe(false);
  });
});

describe("checking a typed code", () => {
  const configured = env("081946");

  it("accepts the code", () => {
    expect(registrationCodeMatches("081946", configured)).toBe(true);
  });

  it("forgives surrounding whitespace, which is what pasting adds", () => {
    expect(registrationCodeMatches("  081946  ", configured)).toBe(true);
    expect(registrationCodeMatches("081946\n", configured)).toBe(true);
  });

  it("refuses anything else, including a prefix of the code", () => {
    for (const no of ["081945", "08194", "0819466", "", "   ", " 0 8 1 9 4 6 ", "081 946"]) {
      expect(registrationCodeMatches(no, configured), `for ${JSON.stringify(no)}`).toBe(false);
    }
  });

  it("compares byte for byte — case and characters are not normalised", () => {
    expect(registrationCodeMatches("ABC-def", env("abc-DEF"))).toBe(false);
    expect(registrationCodeMatches("abc-DEF", env("abc-DEF"))).toBe(true);
  });

  it("refuses anything that is not a string, rather than coercing it", () => {
    for (const no of [undefined, null, 81946, {}, [], ["081946"], true]) expect(registrationCodeMatches(no, configured)).toBe(false);
  });

  it("is not confused by a code that is itself whitespace-padded in the environment", () => {
    expect(registrationCodeMatches("081946", env("  081946  "))).toBe(true);
  });

  it("compares equal-length digests, so a wildly wrong length cannot throw", () => {
    // timingSafeEqual rejects buffers of different lengths; hashing first is
    // what keeps a 10,000-character guess from being an exception instead of
    // a "no".
    expect(() => registrationCodeMatches("x".repeat(10_000), configured)).not.toThrow();
    expect(registrationCodeMatches("x".repeat(10_000), configured)).toBe(false);
  });
});
