import { describe, it, expect } from "vitest";
import { CODE_ALPHABET, isBackupCode, normaliseCode, redeemQrValue, tokenFromScan } from "@/lib/redeemable-shared";

/**
 * The code format, tested without a database: what goes in a QR, what comes
 * back out of a scanner, and what a receptionist can safely read aloud.
 */
describe("item codes", () => {
  it("puts the token in the QR and nothing else", () => {
    const token = "Yb3_QmT7xK1pLz0aWnEr9sQv";
    expect(redeemQrValue(token)).toBe(`pirs-item:${token}`);
    expect(redeemQrValue(token)).not.toMatch(/[0-9a-f]{25,}/); // no ids smuggled in
  });

  it("reads its own QR back", () => {
    const token = "Yb3_QmT7xK1pLz0aWnEr9sQv";
    expect(tokenFromScan(redeemQrValue(token))).toBe(token);
    expect(tokenFromScan(`  ${redeemQrValue(token)}  `)).toBe(token);
  });

  it("refuses anything that isn't one of its codes", () => {
    // The check-in code from the Scan tab: same camera, different meaning.
    expect(tokenFromScan("tenant123.client456.1790000000.c2lnbmF0dXJl")).toBeNull();
    expect(tokenFromScan("https://pirs.io/testclinic")).toBeNull();
    expect(tokenFromScan("pirs-item:")).toBeNull();
    expect(tokenFromScan("pirs-item:short")).toBeNull();
    expect(tokenFromScan("pirs-item:has spaces in it and is long enough")).toBeNull();
    expect(tokenFromScan("")).toBeNull();
  });

  it("leaves out the characters people mistype", () => {
    for (const ambiguous of ["0", "O", "1", "I", "L", "5", "S"]) {
      expect(CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it("accepts a typed code however it was typed", () => {
    expect(normaliseCode(" ab2c-3d4e ")).toBe("AB2C3D4E");
    expect(isBackupCode("ab2c3d4e")).toBe(true);
    expect(isBackupCode("AB2C 3D4E")).toBe(true);
    expect(isBackupCode("AB2C3D4")).toBe(false); // too short
    expect(isBackupCode("AB2C3D40")).toBe(false); // contains a zero
  });
});
