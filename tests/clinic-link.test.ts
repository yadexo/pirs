import { describe, it, expect } from "vitest";
import { isClinicSlug, slugFromAppPath, slugFromScannedCode } from "@/lib/clinic-link";

describe("clinic links", () => {
  it("reads the clinic from a scanned poster code, whatever the host", () => {
    expect(slugFromScannedCode("https://example.com/app/riverside-clinic?join=1")).toBe("riverside-clinic");
    expect(slugFromScannedCode("http://localhost:3000/app/riverside-clinic/shop")).toBe("riverside-clinic");
    expect(slugFromScannedCode("/app/riverside-clinic")).toBe("riverside-clinic");
  });

  it("ignores codes that aren't clinic links", () => {
    for (const v of ["", "hello", "https://example.com/login", "https://example.com/app/", "https://x.com/app/Bad Slug", "https://x.com/app/..%2Fagency", "cm1.cm2.123.sig"]) {
      expect(slugFromScannedCode(v)).toBeNull();
    }
  });

  it("only accepts real slugs from paths", () => {
    expect(slugFromAppPath("/app/glow-studio/rewards")).toBe("glow-studio");
    expect(slugFromAppPath("/agency")).toBeNull();
    expect(isClinicSlug("a".repeat(81))).toBe(false);
    expect(isClinicSlug("-lead")).toBe(false);
  });
});
