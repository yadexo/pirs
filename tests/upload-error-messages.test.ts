import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { UPLOAD_ERROR_KEYS } from "@/lib/upload-error";
import en from "@/messages/en.json";
import nl from "@/messages/nl.json";

/**
 * Upload failures cross the wire as a code, because /api/uploads is a plain
 * route handler with no reliable request locale. That only works while every
 * code has a sentence behind it — in both languages, and actually reachable
 * from the component. This ties the three together so adding a code without
 * its copy fails here rather than showing a clinic an empty error.
 */
describe("every upload failure has something to say", () => {
  const codes = Object.keys(UPLOAD_ERROR_KEYS) as (keyof typeof UPLOAD_ERROR_KEYS)[];
  const field = readFileSync("components/merchant/form.tsx", "utf8");

  it("covers a non-trivial number of codes (sanity check on the test itself)", () => {
    expect(codes.length).toBeGreaterThan(8);
  });

  it("has the message in both languages", () => {
    for (const code of codes) {
      const key = UPLOAD_ERROR_KEYS[code];
      expect(`${code} → en.${key}: ${(en.merchant.form as Record<string, string>)[key] ?? ""}`).toMatch(/: \S/);
      expect(`${code} → nl.${key}: ${(nl.merchant.form as Record<string, string>)[key] ?? ""}`).toMatch(/: \S/);
    }
  });

  it("sends the clinic's chosen crop shape with the file", () => {
    // Easy to leave out, and silently wrong when it is: the server falls back
    // to the purpose's default shape and the choice is lost.
    expect(field.includes('body.set("aspect"')).toBe(true);
  });

  it("shows every one of them from the upload field", () => {
    for (const code of codes) {
      expect(`${code}: ${field.includes(`t("${UPLOAD_ERROR_KEYS[code]}"`)}`).toBe(`${code}: true`);
    }
  });

  it("keeps the Dutch copy actually Dutch, not a copy of the English", () => {
    for (const code of codes) {
      const key = UPLOAD_ERROR_KEYS[code];
      const english = (en.merchant.form as Record<string, string>)[key]!;
      const dutch = (nl.merchant.form as Record<string, string>)[key]!;
      // "Upload failed." happens to be close in both; everything longer
      // should differ, which is what catches a forgotten translation.
      if (english.length > 40) expect(`${key}: ${dutch !== english}`).toBe(`${key}: true`);
    }
  });
});
