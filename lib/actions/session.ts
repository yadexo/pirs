"use server";

import { signOut } from "@/auth";
import { safeNext } from "@/lib/login-destination";

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

/**
 * Sign out and come straight back to the login screen for the portal the user
 * was trying to open, so switching accounts is one click rather than a
 * sign-out, a trip to the index, and a second click.
 */
export async function switchAccountAction(formData: FormData) {
  const target = safeNext(String(formData.get("next") ?? "") || undefined);
  await signOut({ redirectTo: target ? `/login?next=${encodeURIComponent(target)}` : "/login" });
}
