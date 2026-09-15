import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { authorizeCredentials } from "@/lib/auth-credentials";

/**
 * Staff session: agency admins, clinic admins and clinic staff. Clients have
 * their own session in client-auth.ts.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { portal: {}, tenantSlug: {}, email: {}, password: {} },
      authorize: async (credentials) => (await authorizeCredentials(credentials, "staff")) as never,
    }),
  ],
});
