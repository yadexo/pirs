import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config (no Prisma / Node-only imports) shared between the
 * full server-side auth() in auth.ts and the lightweight middleware check.
 * Auth.js's own recommended pattern for splitting config — see
 * https://authjs.dev/guides/edge-compatibility
 */
export const authConfig = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/admin/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) Object.assign(token, user);
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.id,
        email: token.email,
        name: token.name,
        role: token.role,
        tenantId: token.tenantId,
        tenantSlug: token.tenantSlug,
        staffProfileId: token.staffProfileId,
        customerProfileId: token.customerProfileId,
        permissions: token.permissions,
      } as never;
      return session;
    },
  },
} satisfies NextAuthConfig;
