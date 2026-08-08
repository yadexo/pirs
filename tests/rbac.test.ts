import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUserShape } from "@/types/next-auth";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));

// lib/tenant-db pulls in the real Prisma client at import time; the RBAC
// tests never reach the DB (they fail on the permission check first for the
// forbidden cases, and the allowed cases only assert on the returned user),
// so a lightweight stub keeps this test fast and DB-independent.
vi.mock("@/lib/tenant-db", () => ({ getTenantDb: vi.fn(() => ({})) }));

const { requireSession, requireRole, requirePermission, requireStaffContext, UnauthorizedError, ForbiddenError } = await import("@/lib/rbac");

function makeUser(overrides: Partial<SessionUserShape> = {}): SessionUserShape {
  return {
    id: "user_1",
    email: "staff@example.com",
    name: "Staff Member",
    role: "STAFF",
    tenantId: "tenant_1",
    tenantSlug: "riverside-wellness",
    staffProfileId: "staff_1",
    customerProfileId: null,
    permissions: [],
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
});

describe("requireSession", () => {
  it("throws UnauthorizedError when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns the session user when signed in", async () => {
    const user = makeUser();
    authMock.mockResolvedValue({ user });
    await expect(requireSession()).resolves.toEqual(user);
  });
});

describe("requireRole", () => {
  it("allows a matching role", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "TENANT_ADMIN" }) });
    await expect(requireRole("TENANT_ADMIN", "STAFF")).resolves.toMatchObject({ role: "TENANT_ADMIN" });
  });

  it("rejects a non-matching role with ForbiddenError", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "CUSTOMER" }) });
    await expect(requireRole("TENANT_ADMIN", "STAFF")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requirePermission", () => {
  it("always allows a TENANT_ADMIN regardless of their permissions list", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "TENANT_ADMIN", permissions: [] }) });
    await expect(requirePermission("loyalty.adjust")).resolves.toBeTruthy();
  });

  it("allows a STAFF member whose role grants the permission", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "STAFF", permissions: ["loyalty.adjust"] }) });
    await expect(requirePermission("loyalty.adjust")).resolves.toBeTruthy();
  });

  it("allows a STAFF member with the 'ALL' wildcard", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "STAFF", permissions: "ALL" }) });
    await expect(requirePermission("promotions.create")).resolves.toBeTruthy();
  });

  it("rejects a STAFF member missing the permission", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "STAFF", permissions: ["customers.view"] }) });
    await expect(requirePermission("loyalty.adjust")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a CUSTOMER outright", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "CUSTOMER", permissions: [] }) });
    await expect(requirePermission("customers.view")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requireStaffContext", () => {
  it("rejects a staff account with no tenant", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "STAFF", tenantId: null }) });
    await expect(requireStaffContext()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns a tenant-bound db for a valid staff account", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "STAFF", tenantId: "tenant_1" }) });
    const { db } = await requireStaffContext();
    expect(db).toBeDefined();
  });
});
