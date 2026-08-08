import type { UserRole } from "@prisma/client";
import type { PermissionKey } from "@/lib/permissions";

export type SessionPermissions = "ALL" | PermissionKey[];

export interface SessionUserShape {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  tenantSlug: string | null;
  staffProfileId: string | null;
  customerProfileId: string | null;
  permissions: SessionPermissions;
}

declare module "next-auth" {
  interface Session {
    user: SessionUserShape;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required declaration-merging pattern for Auth.js
  interface User extends SessionUserShape {}
}

declare module "next-auth/jwt" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required declaration-merging pattern for Auth.js
  interface JWT extends SessionUserShape {}
}
