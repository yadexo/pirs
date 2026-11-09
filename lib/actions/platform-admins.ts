"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import {
  ActionError,
  runAction,
  type ActionResult,
} from "@/lib/merchant-action";
import { requirePlatformAdminAction } from "@/lib/platform-admin-action";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { createPlatformAdminInvite, PlatformAdminExistsError } from "@/lib/platform-admin-create";

/**
 * Inviting and deactivating platform admins — the agency's own "Team" page,
 * with no merchant in scope. Modeled on lib/actions/merchants.ts's invite
 * flow (same one-time-link mechanism, no password ever typed or emailed) and
 * prisma/create-platform-admin.ts's last-admin-count transaction.
 */

const fieldError = (field: string, message: string) =>
  new z.ZodError([{ code: "custom", path: [field], message }]);

async function clientIp() {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

const inviteSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
});

export interface InvitedAdmin {
  email: string;
  loginUrl: string;
  emailed: boolean;
}

export async function inviteAdminAction(
  fd: FormData,
): Promise<ActionResult<InvitedAdmin>> {
  return runAction(async () => {
    const actor = await requirePlatformAdminAction();

    const ip = await clientIp();
    const [byActor, byIp] = await Promise.all([
      rateLimit(`admin-invite:actor:${actor.id}`, 5, 60 * 60 * 1000),
      rateLimit(`admin-invite:ip:${ip}`, 10, 60 * 60 * 1000),
    ]);
    if (!byActor.ok || !byIp.ok)
      throw new ActionError("Too many invites sent. Try again in a moment.");

    const data = inviteSchema.parse({
      firstName: fd.get("firstName"),
      lastName: fd.get("lastName"),
      email: fd.get("email"),
    });

    // The account, its one-time link and the invitation email — the same code
    // the admin register page runs (lib/platform-admin-create.ts), so an admin
    // created either way is the same account. It refuses inside a Serializable
    // transaction when the address already holds a platform admin; a clinic
    // owner, staff member or client may share it, because each door signs in
    // its own kind of account (lib/portal-scope.ts).
    let admin;
    try {
      admin = await createPlatformAdminInvite({ email: data.email, firstName: data.firstName, lastName: data.lastName, scope: "ALL" });
    } catch (err) {
      if (err instanceof PlatformAdminExistsError) throw fieldError("email", "That email is already a platform admin.");
      throw err;
    }

    await writeAuditLog({
      tenantId: null,
      actorUserId: actor.id,
      actorType: "PLATFORM_ADMIN",
      action: "admin.invited",
      entityType: "User",
      entityId: admin.id,
      metadata: { email: data.email },
    });

    revalidatePath("/agency/settings");
    return { email: admin.email, loginUrl: admin.loginUrl, emailed: admin.emailed };
  });
}

export async function setAdminActiveAction(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requirePlatformAdminAction();

    const limited = await rateLimit(
      `admin-status:actor:${actor.id}`,
      20,
      60 * 60 * 1000,
    );
    if (!limited.ok)
      throw new ActionError("Too many attempts. Try again in a moment.");

    if (!active && userId === actor.id)
      throw new ActionError("You can't deactivate your own account.");

    if (!active) {
      await rawDb.$transaction(
        async (tx) => {
          // Lock every active platform admin before counting them.
          //
          // Serializable alone did not hold this: two admins deactivating
          // each other both counted two, both passed, and the platform was
          // left with nobody — the two transactions simply never overlapped
          // in a way Postgres could call a conflict. The explicit row lock
          // makes the second one wait for the first to commit and then count
          // again, where it sees one and refuses.
          await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'PLATFORM_ADMIN' AND status = 'ACTIVE' FOR UPDATE`;

          const target = await tx.user.findFirst({
            where: { id: userId, role: "PLATFORM_ADMIN" },
          });
          if (!target) throw new ActionError("That admin no longer exists.");
          if (target.status === "ACTIVE") {
            const activeCount = await tx.user.count({
              where: { role: "PLATFORM_ADMIN", status: "ACTIVE" },
            });
            if (activeCount <= 1)
              throw new ActionError(
                "At least one active platform admin must remain.",
              );
          }
          await tx.user.update({
            where: { id: userId },
            data: { status: "DISABLED", sessionsValidAfter: new Date() },
          });
        },
        { isolationLevel: "Serializable" },
      );
    } else {
      const target = await rawDb.user.findFirst({
        where: { id: userId, role: "PLATFORM_ADMIN" },
      });
      if (!target) throw new ActionError("That admin no longer exists.");
      await rawDb.user.update({
        where: { id: userId },
        data: { status: "ACTIVE" },
      });
    }

    await writeAuditLog({
      tenantId: null,
      actorUserId: actor.id,
      actorType: "PLATFORM_ADMIN",
      action: active ? "admin.reactivated" : "admin.deactivated",
      entityType: "User",
      entityId: userId,
    });

    revalidatePath("/agency/settings");
    return {};
  });
}
