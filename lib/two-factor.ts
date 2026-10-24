import "server-only";
import { rawDb } from "@/lib/db";
import { verifyTotp, hashBackupCode, normalizeBackupCode, generateBackupCodes as makeBackupCodes } from "@/lib/totp";

/** Required to sign in; staff may turn it on but aren't asked to. Never offered to clients. */
export const TWO_FACTOR_REQUIRED_ROLES = ["PLATFORM_ADMIN", "TENANT_ADMIN"] as const;

export function twoFactorRequiredForRole(role: string): boolean {
  return (TWO_FACTOR_REQUIRED_ROLES as readonly string[]).includes(role);
}

export async function getTwoFactorStatus(userId: string) {
  return rawDb.twoFactorSecret.findUnique({ where: { userId }, select: { secret: true, confirmedAt: true } });
}

/** Confirmed, not merely started — a secret generated mid-setup and abandoned doesn't count as "has 2FA". */
export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  const row = await getTwoFactorStatus(userId);
  return !!row?.confirmedAt;
}

/**
 * Tries the code as a TOTP first, then as a single-use backup code. A
 * matching backup code is consumed atomically — two concurrent attempts
 * (two tabs, a retried request) cannot both spend the same one.
 */
export async function verifyTwoFactorCode(userId: string, secret: string, rawCode: string): Promise<boolean> {
  if (verifyTotp(secret, rawCode)) return true;
  return consumeBackupCode(userId, rawCode);
}

async function consumeBackupCode(userId: string, rawCode: string): Promise<boolean> {
  const normalized = normalizeBackupCode(rawCode);
  if (normalized.length < 8) return false; // cheaper than a DB round trip for an obviously-not-a-code input
  const codeHash = hashBackupCode(normalized);
  const { count } = await rawDb.twoFactorBackupCode.updateMany({
    where: { userId, codeHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count > 0;
}

/** Replaces every backup code this user has with a fresh set, returned once in the clear — the only time they ever are. */
export async function issueBackupCodes(userId: string, count = 10): Promise<string[]> {
  const codes = makeBackupCodes(count);
  await rawDb.$transaction([
    rawDb.twoFactorBackupCode.deleteMany({ where: { userId } }),
    rawDb.twoFactorBackupCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashBackupCode(code) })) }),
  ]);
  return codes;
}

export async function remainingBackupCodeCount(userId: string): Promise<number> {
  return rawDb.twoFactorBackupCode.count({ where: { userId, usedAt: null } });
}

/** Turns 2FA off entirely: the secret and every backup code, used or not. */
export async function disableTwoFactor(userId: string): Promise<void> {
  await rawDb.$transaction([
    rawDb.twoFactorBackupCode.deleteMany({ where: { userId } }),
    rawDb.twoFactorSecret.deleteMany({ where: { userId } }),
  ]);
}
