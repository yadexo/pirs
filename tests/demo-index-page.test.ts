import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The real safety property: on production, "/" redirects before it ever
 * touches the database — so a seeded account's email can never be read out
 * on the real domains, not just hidden by a UI condition.
 */
const findFirst = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  rawDb: {
    agencySettings: { findFirst: () => findFirst() },
    tenant: { findMany: () => findMany() },
    user: { findFirst: () => findFirst() },
  },
}));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/actions/session", () => ({ signOutAction: vi.fn() }));

const { default: PortalIndexPage } = await import("@/app/page");

describe("the demo portal index ('/')", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    findFirst.mockReset();
    findMany.mockReset();
  });

  it("redirects to /login on Vercel's real Production deployment, without querying anything", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(PortalIndexPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("also redirects on an explicit APP_ENV=production, for a non-Vercel host", async () => {
    vi.stubEnv("APP_ENV", "production");
    await expect(PortalIndexPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("renders normally on staging and local dev", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    findFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
    const page = await PortalIndexPage();
    expect(page).toBeTruthy();
    expect(findMany).toHaveBeenCalled();
  });
});
