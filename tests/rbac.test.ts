import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUserShape } from "@/types/next-auth";

const { authMock, clientAuthMock } = vi.hoisted(() => ({ authMock: vi.fn(), clientAuthMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/client-auth", () => ({ clientAuth: clientAuthMock }));

// lib/tenant-db pulls in the real Prisma client at import time; the RBAC
// tests never reach the DB (they fail on the permission check first for the
// forbidden cases, and the allowed cases only assert on the returned user),
// so a lightweight stub keeps this test fast and DB-independent.
vi.mock("@/lib/tenant-db", () => ({ getTenantDb: vi.fn(() => ({})) }));

// requireSession re-reads the account from the database. These are unit tests
// of the role and permission rules, so the live account mirrors the session;
// the database-backed behaviour is covered in tests/integration/merchant-action.test.ts.
const { liveMock } = vi.hoisted(() => ({ liveMock: vi.fn() }));
vi.mock("@/lib/live-account", () => ({ loadLiveAccount: liveMock }));

const { requireSession, requireRole, requirePermission, requireStaffContext, requireCustomerContext, UnauthorizedError, ForbiddenError } = await import("@/lib/rbac");

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
  liveMock.mockReset();
  liveMock.mockImplementation(async () => {
    const session = await authMock();
    return session?.user ? { role: session.user.role, tenantId: session.user.tenantId, permissions: session.user.permissions } : null;
  });
});

describe("requireSession", () => {
  it("throws UnauthorizedError when the account can no longer act, even with a valid session", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "TENANT_ADMIN", permissions: "ALL" }) });
    liveMock.mockResolvedValue(null); // deactivated, closed, or signed in before a password reset
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

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

describe("separate staff and client sessions", () => {
  beforeEach(() => liveMock.mockImplementation(async () => ({ role: "CUSTOMER", tenantId: "tenant_1", permissions: [] })));

  it("client actions read only the client session", async () => {
    authMock.mockResolvedValue({ user: makeUser({ role: "TENANT_ADMIN" }) });
    clientAuthMock.mockResolvedValue(null);
    await expect(requireCustomerContext()).rejects.toBeInstanceOf(UnauthorizedError);

    clientAuthMock.mockResolvedValue({ user: makeUser({ role: "CUSTOMER", customerProfileId: "cp_1", staffProfileId: null }) });
    await expect(requireCustomerContext()).resolves.toMatchObject({ user: { role: "CUSTOMER", customerProfileId: "cp_1" } });
  });

  it("a client signed in alongside does not affect staff checks", async () => {
    liveMock.mockImplementation(async () => ({ role: "TENANT_ADMIN", tenantId: "tenant_1", permissions: "ALL" }));
    authMock.mockResolvedValue({ user: makeUser({ role: "TENANT_ADMIN" }) });
    clientAuthMock.mockResolvedValue({ user: makeUser({ role: "CUSTOMER" }) });
    await expect(requireStaffContext()).resolves.toMatchObject({ user: { role: "TENANT_ADMIN" } });
  });
});
