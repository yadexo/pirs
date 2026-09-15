import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { authConfig } from "@/auth.config";
import type { SessionPermissions, SessionUserShape } from "@/types/next-auth";

/**
 * Two ways in. "unified" is the /login screen used by agency and clinic users
 * (and clients who find it). "customer" is a clinic's own client app, where
 * the clinic is known from the URL — the same email may be a client at more
 * than one clinic, so the slug is what disambiguates.
 */
type Portal = "customer" | "unified";

async function resolveTenantId(slug: string | undefined) {
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
        const { ok } = await rateLimit(limitKey, 10, 10 * 60 * 1000);
        if (!ok) throw new Error("Too many sign-in attempts. Try again in a few minutes.");

        const include = {
          staffProfile: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          customerProfile: true,
          tenant: { select: { slug: true, status: true } },
        } as const;

        let user;

        if (portal === "unified") {
          // One login screen for every role, clients included. Email
          // identifies the account; the role on it decides where they land.
          const matches = await rawDb.user.findMany({
            where: { email, role: { in: ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF", "CUSTOMER"] } },
            include,
          });
          // Same address registered under two merchants is ambiguous — we
          // cannot guess which, and picking one would be a security bug.
          const match = matches[0];
          if (matches.length !== 1 || !match) return null;
          // A suspended merchant must not be reachable through this door.
          if (match.tenant && match.tenant.status !== "ACTIVE") return null;
          user = match;
        } else {
          if (portal !== "customer") return null;
          const tenantId = await resolveTenantId(tenantSlug);
          if (tenantId === undefined) return null; // unknown or suspended clinic

          user = await rawDb.user.findFirst({
            where: { email, tenantId, role: "CUSTOMER" },
            include,
          });
        }

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
          // The unified door is not given a slug, so take it from the account
          // itself — the client app keys off this to recognise its patient.
          tenantSlug: (portal === "unified" ? user.tenant?.slug : tenantSlug) ?? null,
          staffProfileId: user.staffProfile?.id ?? null,
          customerProfileId: user.customerProfile?.id ?? null,
          permissions,
        };
        return shape as never;
      },
    }),
  ],
});
