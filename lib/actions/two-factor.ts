"use server";

import { getTranslations } from "next-intl/server";
import { requireSession, requireRole } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";
import { getTwoFactorStatus, issueBackupCodes, disableTwoFactor, twoFactorRequiredForRole } from "@/lib/two-factor";
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
  const t = await getTranslations("twoFactor.errors");
  if (user.role === "CUSTOMER") return { error: t("notAvailableForAccount") };

  const existing = await getTwoFactorStatus(user.id);
  if (existing?.confirmedAt) return { error: t("alreadyOn") };

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
  const t = await getTranslations("twoFactor.errors");
  const row = await rawDb.twoFactorSecret.findUnique({ where: { userId: user.id } });
  if (!row) return { error: t("startSetupFirst") };
  if (row.confirmedAt) return { error: t("alreadyOn") };
  if (!verifyTotp(row.secret, code)) return { error: t("codeDidNotMatch") };

  await rawDb.twoFactorSecret.update({ where: { userId: user.id }, data: { confirmedAt: new Date() } });
  const backupCodes = await issueBackupCodes(user.id);

  await writeAuditLog({ tenantId: user.tenantId, actorUserId: user.id, actorType: actorTypeFor(user.role), action: "two_factor.enabled", entityType: "User", entityId: user.id });
  return { backupCodes };
}

/**
 * Self-service off switch. Requires the password again — a hijacked,
 * already-open session shouldn't be able to turn this off silently.
 *
 * Refused outright for a role that requires 2FA (platform admin, clinic
 * owner): turning it off there doesn't actually get them anywhere — every
 * portal page re-demands it on the very next request — it just destroys a
 * working setup and backup codes for nothing. The only way back in for one
 * of these accounts is a platform admin's reset (resetTwoFactorForUserAction).
 */
export async function disableTwoFactorAction(password: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireSession("staff");
  const t = await getTranslations("twoFactor");
  if (twoFactorRequiredForRole(user.role)) {
    return { error: t("requiredCantTurnOff") };
  }
  const row = await rawDb.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row || !(await verifyPassword(password, row.passwordHash))) return { error: t("errors.wrongPassword") };

  await disableTwoFactor(user.id);
  await writeAuditLog({ tenantId: user.tenantId, actorUserId: user.id, actorType: actorTypeFor(user.role), action: "two_factor.disabled", entityType: "User", entityId: user.id });
  return { ok: true };
}

/** A fresh set of backup codes, replacing every existing one — used ones and unused ones alike. */
export async function regenerateBackupCodesAction(): Promise<{ backupCodes: string[] } | { error: string }> {
  const user = await requireSession("staff");
  const status = await getTwoFactorStatus(user.id);
  if (!status?.confirmedAt) return { error: (await getTranslations("twoFactor.errors"))("turnOnFirst") };

  const backupCodes = await issueBackupCodes(user.id);
  await writeAuditLog({ tenantId: user.tenantId, actorUserId: user.id, actorType: actorTypeFor(user.role), action: "two_factor.backup_codes_regenerated", entityType: "User", entityId: user.id });
  return { backupCodes };
}

/** Same as resetTwoFactorForUserAction, looked up by email — what the agency settings tool actually has to work with. */
export async function resetTwoFactorByEmailAction(email: string): Promise<{ ok: true; email: string } | { error: string }> {
  await requireRole("PLATFORM_ADMIN");
  const t = await getTranslations("twoFactor.errors");
  const normalized = email.trim().toLowerCase();
  const matches = await rawDb.user.findMany({ where: { email: normalized, role: { in: ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"] } }, select: { id: true } });
  if (matches.length === 0) return { error: t("noAccountForEmail") };
  if (matches.length > 1) return { error: t("emailUsedAtMultipleClinics") };
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
  if (!target) return { error: (await getTranslations("twoFactor.errors"))("noSuchAccount") };

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
