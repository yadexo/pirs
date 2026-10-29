"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { requireRole, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import {
  ActionError,
  runAction,
  type ActionResult,
} from "@/lib/merchant-action";
import { getImpersonatedMerchantId } from "@/lib/actions/impersonation";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { issuePasswordToken, ADMIN_INVITE_TTL_MS } from "@/lib/password-tokens";
import { appUrl } from "@/lib/app-url";
import { getEmailProvider } from "@/lib/providers/notifications";
import { senderFor } from "@/lib/emails/sender";
import { platformAdminInviteEmail } from "@/lib/emails/templates";
import { DEFAULT_LOCALE } from "@/lib/locale-cookie";

/**
 * Inviting and deactivating platform admins — the agency's own "Team" page,
 * with no merchant in scope. Modeled on lib/actions/merchants.ts's invite
 * flow (same one-time-link mechanism, no password ever typed or emailed) and
 * prisma/create-platform-admin.ts's last-admin-count transaction.
 */

const STAFF_ROLES = ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"] as const;

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

/**
 * The guard every action here shares: right role, not mid-impersonation, own
 * 2FA already confirmed. The UI never reaches this action without all three
 * already being true — requireAgencyContext() redirects an unconfirmed admin
 * away from the whole page — but the action refuses on its own regardless,
 * since a button being hidden is not the same as the server refusing.
 */
async function requirePlatformAdminAction() {
  // requireRole's declared return type is narrower than what it actually
  // returns (requireSession spreads the live account in) — same widening
  // every other caller of user.twoFactorConfirmed (lib/merchant-context.ts)
  // relies on.
  let user: Awaited<ReturnType<typeof requireRole>> & { twoFactorConfirmed: boolean };
  try {
    user = (await requireRole("PLATFORM_ADMIN")) as typeof user;
  } catch (err) {
    // ActionError is what runAction's catch-all shows the caller verbatim;
    // ForbiddenError/UnauthorizedError would otherwise be logged as an
    // unexpected failure and hidden behind a generic message, same as a
    // normal permission refusal never should be.
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) throw new ActionError("Not permitted.");
    throw err;
  }
  if (await getImpersonatedMerchantId())
    throw new ActionError("Not available while impersonating.");
  if (!user.twoFactorConfirmed)
    throw new ActionError("Set up two-factor authentication first.");
  return user;
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

    if (
      await rawDb.user.findFirst({
        where: { email: data.email, role: { in: [...STAFF_ROLES] } },
      })
    ) {
      throw fieldError("email", "That email already has an account.");
    }

    const admin = await rawDb.user.create({
      data: {
        tenantId: null,
        email: data.email,
        // Not a hash any password can match; the account is INVITED until the link is used.
        passwordHash: "!invited",
        status: "INVITED",
        role: "PLATFORM_ADMIN",
        firstName: data.firstName,
        lastName: data.lastName,
      },
    });

    const token = await issuePasswordToken(admin.id, ADMIN_INVITE_TTL_MS);
    const loginUrl = `${appUrl()}/set-password?token=${encodeURIComponent(token)}`;

    const agency = await rawDb.agencySettings.findFirst({
      select: {
        name: true,
        senderName: true,
        logoLightUrl: true,
        primaryColor: true,
      },
    });
    const agencyName = agency?.senderName || agency?.name || "DezaAI";
    const template = platformAdminInviteEmail({
      branding: {
        name: agencyName,
        logoUrl: agency?.logoLightUrl ?? null,
        color: agency?.primaryColor ?? null,
      },
      firstName: data.firstName,
      loginUrl,
      // The invitee hasn't signed in yet, so there's no locale preference to go on.
      locale: DEFAULT_LOCALE,
    });
    const result = await getEmailProvider().send({
      to: data.email,
      subject: template.subject,
      body: template.text,
      html: template.html,
      from: senderFor(agencyName),
    });

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
    return { email: data.email, loginUrl, emailed: result.status === "SENT" };
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
      // Serializable, so two deactivations racing against the same last-two
      // admins cannot both read "one will be left" and both proceed.
      await rawDb.$transaction(
        async (tx) => {
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
