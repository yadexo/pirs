"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { rawDb } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getEmailProvider } from "@/lib/providers/notifications";
import { consumePasswordToken, issuePasswordToken, MIN_PASSWORD_LENGTH, RESET_TTL_MS } from "@/lib/password-tokens";
import { appUrl, clientAppOrigin } from "@/lib/app-url";
import { chooseAccount, isPortal, portalRoles, type Portal } from "@/lib/portal-scope";
import { logReset } from "@/lib/signin-log";

type FormState = { error?: string; sent?: boolean } | undefined;

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Sends a reset link. The response is identical whether or not the address
 * has an account, so the form cannot be used to find out who is a client.
 *
 * Scoped to the door it was asked from, exactly as sign-in is
 * (lib/portal-scope.ts): a clinic slug (from a client app) considers only that
 * clinic's client account, the admin login only platform admins, the clinic
 * login only clinic accounts. So resetting an address that is all three never
 * touches the other two — and the link that arrives always opens the account
 * the person was trying to sign in to.
 */
export async function requestPasswordResetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.string().trim().toLowerCase().email().max(254).safeParse(fd.get("email"));
  if (!parsed.success) return { error: (await getTranslations("auth"))("enterValidEmail") };
  const email = parsed.data;
  const rawClinic = fd.get("clinic");
  const clinicSlug = typeof rawClinic === "string" && /^[a-z0-9-]{1,80}$/.test(rawClinic) ? rawClinic : null;
  const rawPortal = fd.get("portal");
  // A clinic slug is what makes this a client reset; a "customer" door without
  // one is no door at all and falls back to staff, the same as sign-in does.
  const portal: Portal = clinicSlug ? "customer" : isPortal(rawPortal) && rawPortal !== "customer" ? rawPortal : "staff";

  const ip = await clientIp();
  const [byEmail, byIp] = await Promise.all([
    rateLimit(`reset:email:${email}`, 3, 60 * 60 * 1000),
    rateLimit(`reset:ip:${ip}`, 20, 60 * 60 * 1000),
  ]);
  // Say "sent" even when limited: a different answer would reveal the address exists.
  if (!byEmail.ok || !byIp.ok) {
    logReset("rate_limited", { portal });
    return { sent: true };
  }

  const matches = await rawDb.user.findMany({
    where: {
      email,
      status: "ACTIVE",
      role: { in: portalRoles(portal) },
      ...(clinicSlug ? { tenant: { slug: clinicSlug, status: "ACTIVE" } } : {}),
    },
    select: {
      id: true,
      role: true,
      locale: true,
      tenant: { select: { name: true, status: true, branding: { select: { businessName: true, logoUrl: true, primaryColor: true } } } },
    },
    take: 5,
  });
  const chosen = chooseAccount(matches, portal);
  // A suspended clinic's staff cannot sign in, so a reset link would be useless.
  const found = "account" in chosen && (!chosen.account.tenant || chosen.account.tenant.status === "ACTIVE") ? chosen.account : null;

  if (!found) {
    if ("ambiguous" in chosen) logReset("ambiguous_email", { portal, roles: chosen.ambiguous });
    else if ("account" in chosen) logReset("clinic_not_active", { portal, role: chosen.account.role });
    else logReset((await rawDb.user.count({ where: { email } })) > 0 ? "no_account_of_type" : "no_such_user", { portal });
  } else {
    const account = found;
    logReset("sent", { portal, role: account.role });
    const token = await issuePasswordToken(account.id, RESET_TTL_MS);
    // A client's link has to open on the client host — the same origin as the
    // app they are signing in to. Staff and platform admins belong on this
    // deployment's own host, which is the portal.
    const origin = clinicSlug ? clientAppOrigin() : appUrl();
    const resetUrl = `${origin}/set-password?token=${encodeURIComponent(token)}`;

    // A platform admin has no clinic — the agency's own identity stands in,
    // the same as the welcome email a new clinic owner gets.
    let place: string;
    let branding: { name: string; logoUrl: string | null; color: string | null };
    if (account.tenant) {
      place = account.tenant.branding?.businessName ?? account.tenant.name;
      branding = { name: place, logoUrl: account.tenant.branding?.logoUrl ?? null, color: account.tenant.branding?.primaryColor ?? null };
    } else {
      const agency = await rawDb.agencySettings.findFirst({ select: { name: true, senderName: true, logoLightUrl: true, primaryColor: true } });
      place = agency?.senderName || agency?.name || "Deza";
      branding = { name: place, logoUrl: agency?.logoLightUrl ?? null, color: agency?.primaryColor ?? null };
    }

    const { passwordResetEmail } = await import("@/lib/emails/templates");
    const { senderFor } = await import("@/lib/emails/sender");
    const template = passwordResetEmail({ branding, resetUrl, locale: account.locale === "en" ? "en" : "nl" });
    await getEmailProvider().send({ to: email, subject: template.subject, body: template.text, html: template.html, from: senderFor(place) });
  }
  return { sent: true };
}

/** Accepts a staff invitation or completes a reset, then sends the person to sign in. */
export async function setPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const t = await getTranslations("auth");

  if (password.length < MIN_PASSWORD_LENGTH) return { error: t("useAtLeastChars", { min: MIN_PASSWORD_LENGTH }) };
  if (password !== confirm) return { error: t("passwordsDontMatch") };

  const { ok } = await rateLimit(`set-password:${await clientIp()}`, 20, 15 * 60 * 1000);
  if (!ok) return { error: t("tooManyAttemptsWaitMinutes") };

  const result = await consumePasswordToken(token, password);
  if (!result.ok) {
    return {
      error: result.reason === "weak" ? t("useAtLeastChars", { min: MIN_PASSWORD_LENGTH }) : t("linkExpiredOrUsed"),
    };
  }

  redirect(result.role === "CUSTOMER" && result.tenantSlug ? `/app/${result.tenantSlug}?password=updated` : "/login?reason=password-updated");
}
