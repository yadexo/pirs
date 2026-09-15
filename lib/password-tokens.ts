import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";

/** A reset link is short-lived; an invitation gives the person a few days. */
export const RESET_TTL_MS = 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 8;

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

/**
 * Issues a one-time token for setting a password. Only its SHA-256 hash is
 * stored, so a database leak does not hand out working links. Issuing a new
 * token retires any earlier unused ones for the same account.
 */
export async function issuePasswordToken(userId: string, ttlMs: number): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await rawDb.$transaction([
    rawDb.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    rawDb.passwordResetToken.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) } }),
  ]);
  return raw;
}

/** Looks a token up without using it — for showing the form. */
export async function inspectPasswordToken(raw: string) {
  if (!raw) return null;
  const token = await rawDb.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { select: { email: true, status: true, role: true } } },
  });
  if (!token || token.usedAt || token.expiresAt < new Date()) return null;
  if (token.user.status === "DISABLED") return null;
  return { email: token.user.email, isInvite: token.user.status === "INVITED" };
}

export type ConsumeResult = { ok: true; email: string; role: string; tenantSlug: string | null } | { ok: false; reason: "invalid" | "weak" };

/**
 * Sets the password and uses the token, atomically. The token is claimed with
 * a conditional update, so two simultaneous submissions cannot both succeed.
 * Accepting an invitation activates the account; every session that existed
 * before is ended.
 */
export async function consumePasswordToken(raw: string, newPassword: string): Promise<ConsumeResult> {
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 200) return { ok: false, reason: "weak" };
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  return rawDb.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash: hashToken(raw), usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return { ok: false, reason: "invalid" } as const;

    const token = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashToken(raw) }, include: { user: { include: { tenant: { select: { slug: true } } } } } });
    if (token.user.status === "DISABLED") return { ok: false, reason: "invalid" } as const;

    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash, status: "ACTIVE", sessionsValidAfter: now },
    });
    if (token.user.status === "INVITED") {
      await tx.staffProfile.updateMany({ where: { userId: token.userId }, data: { activatedAt: now } });
    }
    return { ok: true, email: token.user.email, role: token.user.role, tenantSlug: token.user.tenant?.slug ?? null } as const;
  });
}
