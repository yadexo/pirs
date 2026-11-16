"use server";

import { cookies } from "next/headers";
import { IMPERSONATION_COOKIE, IMPERSONATION_MAX_MS, SESSION_ID_COOKIE } from "@/lib/impersonation-policy";
import { redirect } from "next/navigation";
import { rawDb } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { arg, args, INVALID_REQUEST, InvalidActionArgsError, validArgs } from "@/lib/action-args";


/**
 * Impersonation is a cookie the agency admin carries, never a role change —
 * the underlying session stays `agency_admin`, so exiting is always possible
 * and a merchant user can never forge their way into one.
 */
export async function startImpersonationAction(merchantId: string) {
  if (!validArgs(args([arg.id]), [merchantId])) throw new InvalidActionArgsError();
  const user = await requireRole("PLATFORM_ADMIN");

  const merchant = await rawDb.tenant.findUnique({ where: { id: merchantId } });
  if (!merchant) redirect("/agency");

  const session = await rawDb.impersonationSession.create({
    data: { actorUserId: user.id, merchantId },
  });
  // In the clinic's own log, so its owner can see when the platform looked in.
  await writeAuditLog({
    tenantId: merchantId,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: "impersonation.started",
    entityType: "ImpersonationSession",
    entityId: session.id,
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
  const user = await requireRole("PLATFORM_ADMIN");

  const jar = await cookies();
  const sessionId = jar.get(SESSION_ID_COOKIE)?.value;

  if (sessionId) {
    // Only the admin's own open session: the cookie names it, the where clause owns it.
    const open = await rawDb.impersonationSession.findFirst({ where: { id: sessionId, actorUserId: user.id, endedAt: null }, select: { id: true, merchantId: true } });
    if (open) {
      await rawDb.impersonationSession.updateMany({ where: { id: open.id, actorUserId: user.id }, data: { endedAt: new Date() } });
      await writeAuditLog({
        tenantId: open.merchantId,
        actorUserId: user.id,
        actorType: "PLATFORM_ADMIN",
        action: "impersonation.ended",
        entityType: "ImpersonationSession",
        entityId: open.id,
      });
    }
    // A session already closed or pruned needs nothing: clearing the cookies
    // below is what actually ends impersonation.
  }

  jar.delete(IMPERSONATION_COOKIE);
  jar.delete(SESSION_ID_COOKIE);

  redirect("/agency");
}
