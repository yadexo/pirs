import { describe, it, expect } from "vitest";
import { safeNext, resolveDestination, landingFor } from "@/lib/login-destination";

const platformAdmin = { role: "PLATFORM_ADMIN", tenantId: null, tenantSlug: null };
const clinicAdmin = { role: "TENANT_ADMIN", tenantId: "t1", tenantSlug: "riverside" };
const staff = { role: "STAFF", tenantId: "t1", tenantSlug: "riverside" };
const client = { role: "CUSTOMER", tenantId: "t1", tenantSlug: "riverside" };

describe("safeNext", () => {
  it("accepts same-origin paths", () => {
    expect(safeNext("/agency")).toBe("/agency");
    expect(safeNext("/m/t1")).toBe("/m/t1");
  });

  it("rejects anything that could leave the origin", () => {
    for (const hostile of [
      "https://evil.example.com",
      "//evil.example.com",
      "http://localhost:3000/agency",
      "javascript:alert(1)",
      "evil.example.com",
    ]) {
      expect(safeNext(hostile)).toBeNull();
    }
  });

  it("rejects a loop back to the login screen", () => {
    expect(safeNext("/login")).toBeNull();
  });

  it("treats a missing value as no destination", () => {
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext("")).toBeNull();
  });
});

describe("landingFor", () => {
  it("sends each role to its own surface", () => {
    expect(landingFor(platformAdmin)).toBe("/agency");
    expect(landingFor(clinicAdmin)).toBe("/m/t1");
    expect(landingFor(staff)).toBe("/m/t1");
    expect(landingFor(client)).toBe("/app/riverside");
  });
});

describe("resolveDestination", () => {
  it("honours the portal the user picked when the role belongs there", () => {
    expect(resolveDestination(platformAdmin, "/agency")).toBe("/agency");
    expect(resolveDestination(clinicAdmin, "/m/t1")).toBe("/m/t1");
    expect(resolveDestination(staff, "/m/t1")).toBe("/m/t1");
    expect(resolveDestination(client, "/app/riverside")).toBe("/app/riverside");
  });

  it("keeps deeper paths within a portal", () => {
    expect(resolveDestination(platformAdmin, "/agency/white-label")).toBe("/agency/white-label");
    expect(resolveDestination(clinicAdmin, "/m/t1/appointments")).toBe("/m/t1/appointments");
  });

  it("never lets a merchant user into the agency console", () => {
    expect(resolveDestination(clinicAdmin, "/agency")).toBe("/m/t1");
    expect(resolveDestination(staff, "/agency/settings")).toBe("/m/t1");
    expect(resolveDestination(client, "/agency")).toBe("/app/riverside");
  });

  it("never lets a user into another merchant's portal", () => {
    expect(resolveDestination(clinicAdmin, "/m/t2")).toBe("/m/t1");
    expect(resolveDestination(staff, "/m/t2/clients")).toBe("/m/t1");
  });

  it("never lets a client into a portal, or another clinic's app", () => {
    expect(resolveDestination(client, "/m/t1")).toBe("/app/riverside");
    expect(resolveDestination(client, "/app/other-clinic")).toBe("/app/riverside");
  });

  it("does not let staff ride a client destination into the patient app", () => {
    expect(resolveDestination(clinicAdmin, "/app/riverside")).toBe("/m/t1");
  });

  it("lets an agency admin open any merchant, since that is their job", () => {
    expect(resolveDestination(platformAdmin, "/m/t2")).toBe("/m/t2");
  });

  it("falls back to the role's own landing for hostile or unknown targets", () => {
    expect(resolveDestination(platformAdmin, "https://evil.example.com")).toBe("/agency");
    expect(resolveDestination(clinicAdmin, "//evil.example.com")).toBe("/m/t1");
    expect(resolveDestination(client, "/some/unknown/path")).toBe("/app/riverside");
    expect(resolveDestination(clinicAdmin, null)).toBe("/m/t1");
  });
});
