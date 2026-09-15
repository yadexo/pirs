import "server-only";
import { rawDb } from "@/lib/db";
import type { SessionPermissions } from "@/types/next-auth";

export interface LiveAccount {
  role: "PLATFORM_ADMIN" | "TENANT_ADMIN" | "STAFF" | "CUSTOMER";
  tenantId: string | null;
  permissions: SessionPermissions;
}

/**
 * The account as it is right now, not as it was when the session was issued.
 *
 * Sessions are signed tokens valid for 30 days. Trusting them alone means a
 * deactivated staff member keeps working for up to a month, and a permission
 * taken away still works until they sign in again. Guards call this on every
 * write and page load instead. One indexed lookup.
 *
 * Returns null for anything that must not act: missing, suspended or deleted
 * accounts, staff whose profile is missing or deactivated, and sessions that
 * began before the account's sessionsValidAfter.
 */
export async function loadLiveAccount(userId: string, authTime?: number): Promise<LiveAccount | null> {
  const user = await rawDb.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      tenantId: true,
      sessionsValidAfter: true,
      staffProfile: {
        select: { active: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
      },
    },
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (isBlockedStaff(user)) return null;
  // Sessions from before a password reset or account closure are over.
  if (user.sessionsValidAfter && (!authTime || authTime < user.sessionsValidAfter.getTime())) return null;
  return { role: user.role, tenantId: user.tenantId, permissions: permissionsFor(user) };
}

type PermissionSource = {
  role: string;
  staffProfile: { active?: boolean; role: { permissions: { permission: { key: string } }[] } | null } | null;
};

/**
 * What an account may do. Owners and agency admins have everything; staff have
 * exactly what their role grants. A staff account with no profile gets
 * nothing — it used to fall through to "ALL".
 */
export function permissionsFor(user: PermissionSource): SessionPermissions {
  if (user.role !== "STAFF") return "ALL";
  if (!user.staffProfile?.role) return [];
  return user.staffProfile.role.permissions.map((rp) => rp.permission.key) as SessionPermissions;
}

function isBlockedStaff(user: PermissionSource): boolean {
  return user.role === "STAFF" && (!user.staffProfile || user.staffProfile.active === false);
}
