import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mintCheckinToken, verifyCheckinToken, CHECKIN_TOKEN_TTL_SECONDS } from "@/lib/checkin-token";

const T = 1_800_000_000_000; // fixed clock

describe("check-in tokens", () => {
  const original = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-for-checkin-tokens";
  });
  afterEach(() => {
    process.env.AUTH_SECRET = original;
  });

  it("verifies a fresh token for the clinic it was issued at", () => {
    const token = mintCheckinToken("tenantA", "client1", T);
    expect(verifyCheckinToken(token, "tenantA", T + 1000)).toEqual({ customerProfileId: "client1" });
  });

  it("refuses the same token at a different clinic", () => {
    const token = mintCheckinToken("tenantA", "client1", T);
    expect(verifyCheckinToken(token, "tenantB", T)).toBeNull();
  });

  it("refuses an expired token, so a screenshot stops working", () => {
    const token = mintCheckinToken("tenantA", "client1", T);
    expect(verifyCheckinToken(token, "tenantA", T + (CHECKIN_TOKEN_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it("refuses tampering: swapping in another client, clinic or expiry", () => {
    const [tenant, , exp, sig] = mintCheckinToken("tenantA", "client1", T).split(".");
    expect(verifyCheckinToken(`${tenant}.client2.${exp}.${sig}`, "tenantA", T)).toBeNull();
    expect(verifyCheckinToken(`tenantB.client1.${exp}.${sig}`, "tenantB", T)).toBeNull();
    expect(verifyCheckinToken(`${tenant}.client1.${Number(exp) + 86400}.${sig}`, "tenantA", T)).toBeNull();
  });

  it("refuses a token signed with a different secret", () => {
    const token = mintCheckinToken("tenantA", "client1", T);
    process.env.AUTH_SECRET = "a-different-secret";
    expect(verifyCheckinToken(token, "tenantA", T)).toBeNull();
  });

  it("refuses to sign at all without a secret, rather than using an empty key", () => {
    delete process.env.AUTH_SECRET;
    expect(() => mintCheckinToken("tenantA", "client1", T)).toThrow(/AUTH_SECRET/);
  });

  it("rejects malformed input without throwing", () => {
    for (const junk of ["", "a.b.c", "a.b.c.d.e", "....", "tenantA.client1.notanumber.sig"]) {
      expect(verifyCheckinToken(junk, "tenantA", T)).toBeNull();
    }
  });
});
