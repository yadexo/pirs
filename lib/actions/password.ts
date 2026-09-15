"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rawDb } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getEmailProvider } from "@/lib/providers/notifications";
import { consumePasswordToken, issuePasswordToken, MIN_PASSWORD_LENGTH, RESET_TTL_MS } from "@/lib/password-tokens";
import { appUrl } from "@/lib/app-url";

type FormState = { error?: string; sent?: boolean } | undefined;

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Sends a reset link. The response is identical whether or not the address
 * has an account, so the form cannot be used to find out who is a client.
 *
 * With a clinic slug (from the client app) only that clinic's client account
 * is considered; from /login, only staff and agency accounts.
 */
export async function requestPasswordResetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.string().trim().toLowerCase().email().max(254).safeParse(fd.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const email = parsed.data;
  const rawClinic = fd.get("clinic");
  const clinicSlug = typeof rawClinic === "string" && rawClinic ? rawClinic : null;

  const ip = await clientIp();
  const [byEmail, byIp] = await Promise.all([
    rateLimit(`reset:email:${email}`, 3, 60 * 60 * 1000),
    rateLimit(`reset:ip:${ip}`, 20, 60 * 60 * 1000),
  ]);
  // Say "sent" even when limited: a different answer would reveal the address exists.
  if (!byEmail.ok || !byIp.ok) return { sent: true };

  const account = await rawDb.user.findFirst({
    where: clinicSlug
      ? { email, role: "CUSTOMER", status: "ACTIVE", tenant: { slug: clinicSlug, status: "ACTIVE" } }
      : { email, role: { in: ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"] }, status: "ACTIVE" },
    select: { id: true, tenant: { select: { name: true, branding: { select: { businessName: true } } } } },
  });

  if (account) {
    const token = await issuePasswordToken(account.id, RESET_TTL_MS);
    const link = `${appUrl()}/set-password?token=${encodeURIComponent(token)}`;
    const place = account.tenant?.branding?.businessName ?? account.tenant?.name ?? "your account";
    await getEmailProvider().send({
      to: email,
      subject: `Reset your password for ${place}`,
      body: [
        `Someone asked to reset the password for ${place}.`,
        "",
        "Choose a new password here. The link works once, for one hour:",
        link,
        "",
        "If this wasn't you, ignore this email and your password stays the same.",
      ].join("\n"),
    });
  }
  return { sent: true };
}

/** Accepts a staff invitation or completes a reset, then sends the person to sign in. */
export async function setPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password !== confirm) return { error: "The two passwords don't match." };

  const { ok } = await rateLimit(`set-password:${await clientIp()}`, 20, 15 * 60 * 1000);
  if (!ok) return { error: "Too many attempts. Wait a few minutes and try again." };

  const result = await consumePasswordToken(token, password);
  if (!result.ok) {
    return {
      error:
        result.reason === "weak"
          ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
          : "This link has expired or was already used. Ask for a new one.",
    };
  }

  redirect(result.role === "CUSTOMER" && result.tenantSlug ? `/app/${result.tenantSlug}?password=updated` : "/login?reason=password-updated");
}
