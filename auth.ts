import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { authConfig } from "@/auth.config";
import type { SessionPermissions, SessionUserShape } from "@/types/next-auth";
import type { UserRole } from "@prisma/client";

type Portal = "customer" | "staff" | "platform";

async function resolveTenantId(portal: Portal, slug: string | undefined) {
  if (portal === "platform") return null;
  if (!slug) return undefined;
  const tenant = await rawDb.tenant.findUnique({ where: { slug } });
  if (!tenant || tenant.status !== "ACTIVE") return undefined;
  return tenant.id;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        portal: {},
        tenantSlug: {},
        email: {},
        password: {},
      },
      async authorize(credentials) {
        const portal = credentials?.portal as Portal | undefined;
        const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
        const password = credentials?.password as string | undefined;
        const tenantSlug = credentials?.tenantSlug as string | undefined;

        if (!portal || !email || !password) return null;

        const limitKey = `login:${portal}:${email}`;
        const { ok } = rateLimit(limitKey, 10, 10 * 60 * 1000);
        if (!ok) throw new Error("Too many sign-in attempts. Try again in a few minutes.");

        let tenantId: string | null | undefined = null;
        if (portal !== "platform") {
          tenantId = await resolveTenantId(portal, tenantSlug);
          if (tenantId === undefined) return null; // unknown/suspended workspace
        }

        const roleFilter: UserRole[] =
          portal === "platform" ? ["PLATFORM_ADMIN"] : portal === "staff" ? ["TENANT_ADMIN", "STAFF"] : ["CUSTOMER"];

        const user = await rawDb.user.findFirst({
          where: {
            email,
            tenantId: portal === "platform" ? null : tenantId,
            role: { in: roleFilter },
          },
          include: {
            staffProfile: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
            customerProfile: true,
          },
        });

        if (!user || user.status !== "ACTIVE") return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        await rawDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        let permissions: SessionPermissions = "ALL";
        let name = email;
        if (user.role === "STAFF" && user.staffProfile) {
          permissions = user.staffProfile.role
            ? user.staffProfile.role.permissions.map((rp) => rp.permission.key as never)
            : [];
          name = `${user.staffProfile.firstName} ${user.staffProfile.lastName}`;
        } else if (user.role === "TENANT_ADMIN" && user.staffProfile) {
          name = `${user.staffProfile.firstName} ${user.staffProfile.lastName}`;
        } else if (user.role === "CUSTOMER" && user.customerProfile) {
          name = `${user.customerProfile.firstName} ${user.customerProfile.lastName}`;
        }

        const shape: SessionUserShape = {
          id: user.id,
          email: user.email,
          name,
          role: user.role,
          tenantId: user.tenantId,
          tenantSlug: tenantSlug ?? null,
          staffProfileId: user.staffProfile?.id ?? null,
          customerProfileId: user.customerProfile?.id ?? null,
          permissions,
        };
        return shape as never;
      },
    }),
  ],
});
