import "server-only";
import { auth } from "@/auth";
import { getTenantDb } from "@/lib/tenant-db";
import { loadLiveAccount } from "@/lib/live-account";
import type { PermissionKey } from "@/lib/permissions";
import type { SessionUserShape } from "@/types/next-auth";

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not permitted") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Throws unless there is a signed-in user whose account is still allowed to
 * act. Role, clinic and permissions come from the database (see
 * lib/live-account.ts), so every guard below — client and staff — stops a
 * closed or deactivated account on its next request.
 */
export async function requireSession(): Promise<SessionUserShape> {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  const live = await loadLiveAccount(session.user.id, session.user.authTime);
  if (!live) throw new UnauthorizedError("Your access has changed. Please sign in again.");
  return { ...session.user, ...live };
}

/** Throws unless the signed-in user has one of the given roles. */
export async function requireRole(...roles: SessionUserShape["role"][]): Promise<SessionUserShape> {
  const user = await requireSession();
  if (!roles.includes(user.role)) throw new ForbiddenError(`Requires role: ${roles.join(" or ")}`);
  return user;
}

/**
 * Throws unless the signed-in user is a tenant admin (implicit full access)
 * or a staff member whose role grants the given permission.
 */
export async function requirePermission(permission: PermissionKey): Promise<SessionUserShape> {
  const user = await requireSession();
  if (user.role === "TENANT_ADMIN") return user;
  if (user.role === "STAFF" && (user.permissions === "ALL" || user.permissions.includes(permission))) {
    return user;
  }
  throw new ForbiddenError(`Missing permission: ${permission}`);
}

/** Staff/tenant-admin session bound to their own tenant's scoped Prisma client. */
export async function requireStaffContext() {
  const user = await requireRole("TENANT_ADMIN", "STAFF");
  if (!user.tenantId) throw new ForbiddenError("Staff account missing tenant");
  return { user, db: getTenantDb(user.tenantId) };
}

/** Customer session bound to their own tenant's scoped Prisma client. */
export async function requireCustomerContext() {
  const user = await requireRole("CUSTOMER");
  if (!user.tenantId || !user.customerProfileId) throw new ForbiddenError("Customer account incomplete");
  return { user, db: getTenantDb(user.tenantId) };
}

/** Platform-admin session (unscoped by design). */
export async function requirePlatformContext() {
  const user = await requireRole("PLATFORM_ADMIN");
  return { user };
}
