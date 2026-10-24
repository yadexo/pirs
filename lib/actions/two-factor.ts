"use server";

import { requireSession, requireRole } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";
import { getTwoFactorStatus, issueBackupCodes, disableTwoFactor } from "@/lib/two-factor";
import { qrSvg } from "@/lib/qr";
import { writeAuditLog } from "@/lib/audit";

const ISSUER = "Pirs";

function actorTypeFor(role: string): "PLATFORM_ADMIN" | "STAFF" {
  return role === "PLATFORM_ADMIN" ? "PLATFORM_ADMIN" : "STAFF";
}

/**
 * Starts (or resumes) setup: a fresh secret the first time, the same
 * in-progress one on a retry — generating a new secret on every page reload
 * would make a half-scanned QR code stop working. Never touches a secret
 * that's already confirmed; disabling that is a separate, explicit action.
 */
export async function startTwoFactorSetupAction(): Promise<{ secret: string; otpauthUri: string; qrSvg: string } | { error: string }> {
  const user = await requireSession("staff");
  if (user.role === "CUSTOMER") return { error: "Not available for this account." };

  const existing = await getTwoFactorStatus(user.id);
  if (existing?.confirmedAt) return { error: "Two-factor authentication is already on for this account." };

  const secret = existing?.secret ?? generateTotpSecret();
  if (!existing) await rawDb.twoFactorSecret.create({ data: { userId: user.id, secret } });

  const otpauthUri = totpUri(secret, user.email, ISSUER);
  return { secret, otpauthUri, qrSvg: qrSvg(otpauthUri) };
}

/**
 * The one real proof of setup: a code the authenticator app just produced
 * from the secret it was given. Issues backup codes in the same step —
 * shown to the client exactly once, by the page that called this.
 */
export async function confirmTwoFactorSetupAction(code: string): Promise<{ backupCodes: string[] } | { error: string }> {
  const user = await requireSession("staff");
  const row = await rawDb.twoFactorSecret.findUnique({ where: { userId: user.id } });
  if (!row) return { error: "Start setup first." };
  if (row.confirmedAt) return { error: "Two-factor authentication is already on for this account." };
  if (!verifyTotp(row.secret, code)) return { error: "That code didn't match. Check your authenticator app and try again." };

  await rawDb.twoFactorSecret.update({ where: { userId: user.id }, data: { confirmedAt: new Date() } });
  const backupCodes = await issueBackupCodes(user.id);

  await writeAuditLog({ tenantId: user.tenantId, actorUserId: user.id, actorType: actorTypeFor(user.role), action: "two_factor.enabled", entityType: "User", entityId: user.id });
  return { backupCodes };
}

/** Self-service off switch. Requires the password again — a hijacked, already-open session shouldn't be able to turn this off silently. */
export async function disableTwoFactorAction(password: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireSession("staff");
  const row = await rawDb.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row || !(await verifyPassword(password, row.passwordHash))) return { error: "Wrong password." };

  await disableTwoFactor(user.id);
  await writeAuditLog({ tenantId: user.tenantId, actorUserId: user.id, actorType: actorTypeFor(user.role), action: "two_factor.disabled", entityType: "User", entityId: user.id });
  return { ok: true };
}

/** A fresh set of backup codes, replacing every existing one — used ones and unused ones alike. */
export async function regenerateBackupCodesAction(): Promise<{ backupCodes: string[] } | { error: string }> {
  const user = await requireSession("staff");
  const status = await getTwoFactorStatus(user.id);
  if (!status?.confirmedAt) return { error: "Turn on two-factor authentication first." };

  const backupCodes = await issueBackupCodes(user.id);
  await writeAuditLog({ tenantId: user.tenantId, actorUserId: user.id, actorType: actorTypeFor(user.role), action: "two_factor.backup_codes_regenerated", entityType: "User", entityId: user.id });
  return { backupCodes };
}

/** Same as resetTwoFactorForUserAction, looked up by email — what the agency settings tool actually has to work with. */
export async function resetTwoFactorByEmailAction(email: string): Promise<{ ok: true; email: string } | { error: string }> {
  await requireRole("PLATFORM_ADMIN");
  const normalized = email.trim().toLowerCase();
  const matches = await rawDb.user.findMany({ where: { email: normalized, role: { in: ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"] } }, select: { id: true } });
  if (matches.length === 0) return { error: "No staff or admin account uses that email." };
  if (matches.length > 1) return { error: "That email is used at more than one clinic — reset it from that clinic's own Team settings instead." };
  return resetTwoFactorForUserAction(matches[0]!.id);
}

/**
 * Platform admin only: clears someone else's two-factor setup entirely —
 * the one way back in for a lost phone. Audit logged against the account
 * that was reset, not the admin's own, so it shows up on that person's
 * history where a clinic owner investigating "why was my 2FA off" would
 * look.
 */
export async function resetTwoFactorForUserAction(userId: string): Promise<{ ok: true; email: string } | { error: string }> {
  const admin = await requireRole("PLATFORM_ADMIN");
  const target = await rawDb.user.findUnique({ where: { id: userId }, select: { id: true, email: true, tenantId: true } });
  if (!target) return { error: "No such account." };

  await disableTwoFactor(target.id);
  await writeAuditLog({
    tenantId: target.tenantId,
    actorUserId: admin.id,
    actorType: "PLATFORM_ADMIN",
    action: "two_factor.reset_by_admin",
    entityType: "User",
    entityId: target.id,
    reason: `Reset by platform admin for ${target.email}`,
  });
  return { ok: true, email: target.email };
}
