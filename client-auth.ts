import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { clientAuthConfig } from "@/auth.config";
import { authorizeCredentials } from "@/lib/auth-credentials";

/**
 * Client session for the client app (/app/...). Kept in its own cookie so it
 * never replaces a staff session in the same browser.
 */
export const {
  handlers: clientHandlers,
  auth: clientAuth,
  signIn: clientSignIn,
  signOut: clientSignOut,
} = NextAuth({
  ...clientAuthConfig,
  providers: [
    Credentials({
      credentials: { portal: {}, tenantSlug: {}, email: {}, password: {} },
      authorize: async (credentials) => (await authorizeCredentials(credentials, "client")) as never,
    }),
  ],
});
