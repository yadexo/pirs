"use server";

import { cookies } from "next/headers";
import { IMPERSONATION_MAX_MS } from "@/lib/impersonation-policy";
import { redirect } from "next/navigation";
import { rawDb } from "@/lib/db";
import { requireRole } from "@/lib/rbac";

// Not exported: a "use server" module may only export async functions.
const IMPERSONATION_COOKIE = "impersonate_merchant";

const SESSION_ID_COOKIE = "impersonate_session";

/**
 * Impersonation is a cookie the agency admin carries, never a role change —
 * the underlying session stays `agency_admin`, so exiting is always possible
 * and a merchant user can never forge their way into one.
 */
export async function startImpersonationAction(merchantId: string) {
  const user = await requireRole("PLATFORM_ADMIN");

  const merchant = await rawDb.tenant.findUnique({ where: { id: merchantId } });
  if (!merchant) redirect("/agency");

  const session = await rawDb.impersonationSession.create({
    data: { actorUserId: user.id, merchantId },
  });

  const jar = await cookies();
  jar.set(IMPERSONATION_COOKIE, merchantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: IMPERSONATION_MAX_MS / 1000,
  });
  jar.set(SESSION_ID_COOKIE, session.id, { httpOnly: true, sameSite: "lax", path: "/" });

  redirect(`/m/${merchantId}`);
}

export async function stopImpersonationAction() {
  await requireRole("PLATFORM_ADMIN");

  const jar = await cookies();
  const sessionId = jar.get(SESSION_ID_COOKIE)?.value;

  if (sessionId) {
    await rawDb.impersonationSession
      .update({ where: { id: sessionId }, data: { endedAt: new Date() } })
      .catch(() => {
        // Session row already closed or pruned — clearing the cookies below
        // is what actually ends impersonation, so this is not fatal.
      });
  }

  jar.delete(IMPERSONATION_COOKIE);
  jar.delete(SESSION_ID_COOKIE);

  redirect("/agency");
}

/** The merchant an agency admin is currently viewing, if any. */
export async function getImpersonatedMerchantId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(IMPERSONATION_COOKIE)?.value ?? null;
}
