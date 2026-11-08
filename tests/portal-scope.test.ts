import { describe, it, expect } from "vitest";
import { ADMIN_HOST, PORTAL_HOST, CLIENT_HOST } from "@/lib/portal-hosts";
import { audienceFor, chooseAccount, isPortal, openedDoor, portalRoles, slugFromNext, type Portal } from "@/lib/portal-scope";

const account = (role: string, id = role) => ({ role, id });

describe("which accounts a door considers", () => {
  it("the admin door sees platform admins only", () => {
    expect(portalRoles("admin")).toEqual(["PLATFORM_ADMIN"]);
  });

  it("the clinic door sees clinic accounts only", () => {
    expect(portalRoles("clinic")).toEqual(["TENANT_ADMIN", "STAFF"]);
  });

  it("a client door sees clients only", () => {
    expect(portalRoles("customer")).toEqual(["CUSTOMER"]);
  });

  it("the staff fallback sees every staff role and no client", () => {
    expect(portalRoles("staff")).toEqual(["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"]);
    expect(portalRoles("staff")).not.toContain("CUSTOMER");
  });

  it("no door mixes the two sessions", () => {
    for (const portal of ["admin", "clinic", "staff"] as Portal[]) expect(audienceFor(portal)).toBe("staff");
    expect(audienceFor("customer")).toBe("client");
  });

  it("only the four doors are doors", () => {
    for (const ok of ["admin", "clinic", "customer", "staff"]) expect(isPortal(ok)).toBe(true);
    // "unified" is what the single door used to be called: a page left open
    // across the deploy that split it must not be read as a door.
    for (const no of ["unified", "", "ADMIN", "agency", null, undefined, 7, {}]) expect(isPortal(no)).toBe(false);
  });
});

describe("picking the one account a door should sign in", () => {
  // The case this all exists for: one person, one address, three accounts.
  const allThree = [account("PLATFORM_ADMIN"), account("TENANT_ADMIN"), account("CUSTOMER")];

  it("gives each door its own account, from the very same address", () => {
    expect(chooseAccount(allThree, "admin")).toEqual({ account: account("PLATFORM_ADMIN") });
    expect(chooseAccount(allThree, "clinic")).toEqual({ account: account("TENANT_ADMIN") });
    expect(chooseAccount(allThree, "customer")).toEqual({ account: account("CUSTOMER") });
  });

  it("ignores accounts of other kinds rather than calling them ambiguous", () => {
    // The old behaviour: three matches, so all three refused.
    expect(chooseAccount(allThree, "admin")).not.toHaveProperty("ambiguous");
  });

  it("says when there is no account of this kind", () => {
    expect(chooseAccount([account("CUSTOMER")], "admin")).toEqual({ none: true });
    expect(chooseAccount([], "clinic")).toEqual({ none: true });
  });

  it("still refuses two accounts of the same kind — there is no way to choose", () => {
    const twoOwners = [account("TENANT_ADMIN", "a"), account("TENANT_ADMIN", "b")];
    expect(chooseAccount(twoOwners, "clinic")).toEqual({ ambiguous: ["TENANT_ADMIN", "TENANT_ADMIN"] });
    expect(chooseAccount([account("PLATFORM_ADMIN", "a"), account("PLATFORM_ADMIN", "b")], "admin")).toEqual({
      ambiguous: ["PLATFORM_ADMIN", "PLATFORM_ADMIN"],
    });
  });

  it("treats an owner and a staff member at one clinic as the same kind, so that too refuses", () => {
    // Both are clinic accounts; the clinic door cannot tell which was meant.
    expect(chooseAccount([account("TENANT_ADMIN"), account("STAFF")], "clinic")).toEqual({ ambiguous: ["TENANT_ADMIN", "STAFF"] });
  });

  it("prefers the platform admin at the staff fallback, whatever order the rows arrive in", () => {
    const both = [account("TENANT_ADMIN"), account("PLATFORM_ADMIN")];
    expect(chooseAccount(both, "staff")).toEqual({ account: account("PLATFORM_ADMIN") });
    expect(chooseAccount([...both].reverse(), "staff")).toEqual({ account: account("PLATFORM_ADMIN") });
  });

  it("falls through to the clinic tier at the staff fallback when there is no admin", () => {
    expect(chooseAccount([account("STAFF")], "staff")).toEqual({ account: account("STAFF") });
  });
});

describe("the clinic in a client destination", () => {
  it("reads the slug, and only a slug", () => {
    expect(slugFromNext("/app/riverside")).toBe("riverside");
    expect(slugFromNext("/app/riverside/shop")).toBe("riverside");
    expect(slugFromNext("/app/riverside?x=1")).toBe("riverside");
  });

  it("is null for anything that isn't one", () => {
    for (const no of ["/app", "/app/", "/agency", "/m/abc", "/applesauce", "", null, undefined, "/app/Riverside", "/app/../etc"]) {
      expect(slugFromNext(no)).toBeNull();
    }
  });
});

describe("the door a request opened", () => {
  it("is decided by the host first — a link cannot move the admin login", () => {
    expect(openedDoor(ADMIN_HOST, null)).toEqual({ portal: "admin", tenantSlug: null });
    // Even carrying a clinic destination: the account found is then told it
    // cannot reach that page, which is canReach's job, not a quiet reroute.
    expect(openedDoor(ADMIN_HOST, "/m/abc123")).toEqual({ portal: "admin", tenantSlug: null });
    expect(openedDoor(PORTAL_HOST, "/agency")).toEqual({ portal: "clinic", tenantSlug: null });
  });

  it("reads the host the way requests arrive, port and capitals and all", () => {
    expect(openedDoor(`${ADMIN_HOST.toUpperCase()}:443`, null).portal).toBe("admin");
  });

  it("falls back to the destination where the host names no surface", () => {
    expect(openedDoor("localhost:3000", "/agency")).toEqual({ portal: "admin", tenantSlug: null });
    expect(openedDoor("localhost:3000", "/agency/settings")).toEqual({ portal: "admin", tenantSlug: null });
    expect(openedDoor("my-app.vercel.app", "/m/abc123")).toEqual({ portal: "clinic", tenantSlug: null });
    expect(openedDoor("192.168.1.20:3000", "/app/riverside")).toEqual({ portal: "customer", tenantSlug: "riverside" });
  });

  it("is the staff door when nothing says otherwise — never the client one", () => {
    for (const host of ["localhost:3000", "my-app.vercel.app", `staging.example.test`, CLIENT_HOST, null, undefined, ""]) {
      expect(openedDoor(host, null)).toEqual({ portal: "staff", tenantSlug: null });
    }
    expect(openedDoor("localhost:3000", "/something-else")).toEqual({ portal: "staff", tenantSlug: null });
  });

  it("cannot be talked into a client door without a clinic", () => {
    expect(openedDoor("localhost:3000", "/app").portal).toBe("staff");
    expect(openedDoor("localhost:3000", "/app/").portal).toBe("staff");
  });

  it("is not fooled by a destination that merely starts like one", () => {
    expect(openedDoor("localhost:3000", "/agencyx").portal).toBe("staff");
    expect(openedDoor("localhost:3000", "/mail").portal).toBe("staff");
    expect(openedDoor("localhost:3000", "//evil.example/agency").portal).toBe("staff");
  });
});
