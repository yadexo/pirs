import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config (no Prisma / Node-only imports) shared between the
 * full server-side auth() in auth.ts and the lightweight middleware check.
 * Auth.js's own recommended pattern for splitting config — see
 * https://authjs.dev/guides/edge-compatibility
 */
export const authConfig = {
  // Required in production: Auth.js only auto-trusts the request host in dev,
  // and rejects it otherwise with UntrustedHost. Safe here because the app is
  // served from a known origin behind its own domain/proxy.
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present at sign-in: stamp when this session began.
      if (user) Object.assign(token, user, { authTime: Date.now() });
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
        authTime: token.authTime,
      } as never;
      return session;
    },
  },
} satisfies NextAuthConfig;
