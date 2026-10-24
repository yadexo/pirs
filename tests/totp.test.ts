import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { base32Encode, base32Decode, generateTotpSecret, totpCode, verifyTotp, totpUri, generateBackupCodes, normalizeBackupCode, hashBackupCode } =
  await import("@/lib/totp");

describe("TOTP (RFC 6238)", () => {
  // The RFC's own worked examples (Appendix B): secret is the ASCII string
  // "12345678901234567890", SHA1, 8-digit codes at five specific Unix times.
  // This implementation produces 6-digit codes, which are simply the last 6
  // digits of the 8-digit ones — 10^6 divides 10^8, so truncating to 6
  // digits is the same operation whether you stop one step earlier or trim
  // the result. If this test passes, the implementation agrees with the
  // published standard, not just with itself.
  const RFC_SECRET_BASE32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  const VECTORS: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];

  it("matches the RFC's own published test vectors", () => {
    for (const [unixSeconds, expected] of VECTORS) {
      expect(totpCode(RFC_SECRET_BASE32, unixSeconds * 1000)).toBe(expected);
    }
  });

  it("verifyTotp accepts the matching code at the same instant", () => {
    for (const [unixSeconds, expected] of VECTORS) {
      expect(verifyTotp(RFC_SECRET_BASE32, expected, unixSeconds * 1000, 0)).toBe(true);
    }
  });

  it("base32 round-trips arbitrary bytes", () => {
    for (const input of [Buffer.from([]), Buffer.from([0]), Buffer.from([255, 254, 253]), Buffer.from("12345678901234567890", "ascii")]) {
      expect(base32Decode(base32Encode(input))).toEqual(input);
    }
  });

  it("a fresh secret verifies against the code it itself produces, right now", () => {
    const secret = generateTotpSecret();
    const code = totpCode(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("rejects a wrong code, a malformed code, and a code one step further out than the allowed window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const real = totpCode(secret, now);
    const wrong = real === "000000" ? "111111" : "000000";
    expect(verifyTotp(secret, wrong, now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false); // too short
    expect(verifyTotp(secret, "abcdef", now)).toBe(false); // not digits
    // ±1 step (±30s) is accepted; ±2 steps (60s+) is not.
    const twoStepsLater = now + 65_000;
    expect(verifyTotp(secret, real, twoStepsLater)).toBe(false);
  });

  it("tolerates a clock up to one 30s step off, either direction", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, code, now + 25_000)).toBe(true);
    expect(verifyTotp(secret, code, now - 25_000)).toBe(true);
  });

  it("builds an otpauth:// URI an authenticator app can scan", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "owner@clinic.example", "Pirs");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Pirs%3Aowner%40clinic\.example\?/);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Pirs");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("backup codes", () => {
  it("generates the requested count, all distinct", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("hashes the same regardless of case or how the dash/spacing is typed", () => {
    const h1 = hashBackupCode("7GQJK-4RXTM");
    expect(hashBackupCode("7gqjk-4rxtm")).toBe(h1);
    expect(hashBackupCode(" 7GQJK4RXTM ")).toBe(h1);
    expect(hashBackupCode("7GQJK 4RXTM")).toBe(h1);
  });

  it("a different code hashes differently", () => {
    expect(hashBackupCode("7GQJK-4RXTM")).not.toBe(hashBackupCode("AAAAA-BBBBB"));
  });

  it("normalizeBackupCode strips everything but letters and digits, upper-cased", () => {
    expect(normalizeBackupCode(" 7gqjk-4rxtm ")).toBe("7GQJK4RXTM");
  });
});
