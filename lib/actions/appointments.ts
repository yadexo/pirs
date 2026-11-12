"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { arg, args, InvalidActionArgsError, validArgs } from "@/lib/action-args";

/**
 * The one appointment action the clinic portal still uses.
 *
 * This file used to hold the old customer app's booking actions as well —
 * listing options, finding slots, booking, cancelling, rescheduling — and the
 * old admin's staff-availability forms. The client app has its own
 * (lib/actions/client-app.ts) and nothing called these any more, so they are
 * gone: an exported action nobody uses is still an endpoint somebody can
 * find (docs/security/review-2026-11.md, T-4).
 */

export async function updateAppointmentStatusAction(
  appointmentId: string,
  status: "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW",
) {
  if (!validArgs(args([arg.id, z.enum(["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"])]), [appointmentId, status])) throw new InvalidActionArgsError();
  await requirePermission("appointments.manage");
  const { db, user } = await requireStaffContext();

  await db.appointment.updateMany({
    where: { id: appointmentId },
    data: {
      status,
      cancelledAt: status === "CANCELLED" ? new Date() : undefined,
      cancelledBy: status === "CANCELLED" ? "STAFF" : undefined,
    },
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: `appointment.${status.toLowerCase()}`,
    entityType: "Appointment",
    entityId: appointmentId,
  });

  // The screen this is called from. It used to revalidate two /admin paths
  // that have not existed since the portal moved to /m/<clinic>.
  revalidatePath(`/m/${user.tenantId}/appointments`);
}
