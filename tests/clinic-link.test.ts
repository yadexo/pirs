import { describe, it, expect } from "vitest";
import { isClinicSlug, slugFromAppPath, slugFromScannedCode } from "@/lib/clinic-link";

describe("clinic links", () => {
  it("reads the clinic from a scanned poster code, whatever the host", () => {
    expect(slugFromScannedCode("https://example.com/app/riverside-clinic?join=1")).toBe("riverside-clinic");
    expect(slugFromScannedCode("http://localhost:3000/app/riverside-clinic/shop")).toBe("riverside-clinic");
    expect(slugFromScannedCode("/app/riverside-clinic")).toBe("riverside-clinic");
  });

  it("reads the short link a clinic prints now", () => {
    expect(slugFromScannedCode("https://pirs.io/riverside-clinic?join=1")).toBe("riverside-clinic");
    expect(slugFromScannedCode("https://www.pirs.io/riverside-clinic")).toBe("riverside-clinic");
    expect(slugFromScannedCode("/riverside-clinic")).toBe("riverside-clinic");
  });

  it("does not treat every website's first path segment as a clinic", () => {
    // Someone else's QR code must not open one of our clinics.
    expect(slugFromScannedCode("https://example.com/riverside-clinic")).toBeNull();
    expect(slugFromScannedCode("https://pirs.io/some/other/page")).toBeNull();
    expect(slugFromScannedCode("https://pirs.io.evil.com/riverside-clinic")).toBeNull();
  });

  it("ignores codes that aren't clinic links", () => {
    for (const v of ["", "hello", "riverside-clinic", "mailto:x@y.z", "tel:+31612345678", "https://example.com/login", "https://example.com/app/", "https://x.com/app/Bad Slug", "https://x.com/app/..%2Fagency", "cm1.cm2.123.sig"]) {
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
