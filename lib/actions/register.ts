"use server";

import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { guardRegistration } from "@/lib/registration-guard";
import { createClinicWithOwner, splitName } from "@/lib/clinic-create";
import { createPlatformAdminInvite, PlatformAdminExistsError } from "@/lib/platform-admin-create";
import { loadLiveAccount } from "@/lib/live-account";
import { writeAuditLog } from "@/lib/audit";
import { logRegister } from "@/lib/signin-log";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { SUPPORTED_LOCALES } from "@/lib/locale-cookie";

/**
 * Self-registration: a clinic with its owner, and a platform admin.
 *
 * Both actions start at guardRegistration (lib/registration-guard.ts) — the
 * registration code, its rate limits and its reason-coded logging — and only
 * then look at what the form said. Neither ever accepts a password: the person
 * gets a one-time link and chooses their own, and two-factor setup is forced
 * afterwards for both roles.
 */

export type RegisterResult = { ok: true; email: string; emailed: boolean; loginUrl: string } | { error: string; fieldErrors?: Record<string, string> };

/** The first ZodError message per field, under the form's own field names. */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

/** Who is asking, if anyone is signed in. Used only to record a clinic's creator. */
async function signedInPlatformAdmin(): Promise<string | null> {
  const sessionUser = (await auth())?.user;
  if (!sessionUser) return null;
  // From the database, not the 30-day token: an account that has since been
  // closed must not be recorded as having created anything.
  const live = await loadLiveAccount(sessionUser.id, sessionUser.authTime);
  return live?.role === "PLATFORM_ADMIN" ? sessionUser.id : null;
}

const clinicSchema = z.object({
  name: z.string().trim().min(2, "Enter the clinic's name").max(120),
  ownerName: z.string().trim().min(2, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  locale: z.enum(SUPPORTED_LOCALES),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export async function registerClinicAction(_prev: unknown, fd: FormData): Promise<RegisterResult> {
  const refused = await guardRegistration("clinic", fd);
  if (refused) return refused;

  const t = await getTranslations("register.errors");
  const parsed = clinicSchema.safeParse({
    name: fd.get("name"),
    ownerName: fd.get("ownerName"),
    email: fd.get("email"),
    locale: fd.get("locale"),
    currency: fd.get("currency"),
  });
  if (!parsed.success) {
    logRegister("invalid_input", { portal: "clinic" });
    return { error: t("checkTheForm"), fieldErrors: fieldErrors(parsed.error) };
  }
  const data = parsed.data;

  // One account per address per clinic is all there can be, and a clinic's
  // owner is created with the clinic — so the only clash worth refusing is an
  // address that already owns or works at some clinic, which would make the
  // clinic sign-in ambiguous for it (see lib/portal-scope.ts).
  if (await rawDb.user.findFirst({ where: { email: data.email, role: { in: ["TENANT_ADMIN", "STAFF"] } }, select: { id: true } })) {
    logRegister("email_taken", { portal: "clinic" });
    return { error: t("clinicEmailTaken"), fieldErrors: { email: t("clinicEmailTaken") } };
  }

  const createdByUserId = await signedInPlatformAdmin();
  const clinic = await createClinicWithOwner({
    name: data.name,
    ownerName: data.ownerName,
    contactEmail: data.email,
    currency: data.currency,
    locale: data.locale,
    timezone: "Europe/Amsterdam",
    createdByUserId,
  });

  await writeAuditLog({
    tenantId: clinic.tenantId,
    actorUserId: createdByUserId,
    // Nobody is signed in for a self-registration, so the platform itself is
    // the actor. AuditActorType has no "self" and inventing one would change
    // every reader of the column.
    actorType: createdByUserId ? "PLATFORM_ADMIN" : "SYSTEM",
    action: "clinic.self_registered",
    entityType: "Tenant",
    entityId: clinic.tenantId,
    metadata: { slug: clinic.slug, ownerUserId: clinic.ownerId, byPlatformAdmin: !!createdByUserId },
  });

  logRegister("success", { portal: "clinic", role: "TENANT_ADMIN" });
  return { ok: true, email: clinic.email, emailed: clinic.emailed, loginUrl: clinic.loginUrl };
}

const adminSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
});

/**
 * Registers a full platform admin: every clinic, the same as every platform
 * admin today. The scope is passed explicitly rather than assumed, so a
 * narrower kind of admin becomes a new value in AdminScope and a column to
 * store it — see lib/platform-admin-create.ts.
 */
export async function registerPlatformAdminAction(_prev: unknown, fd: FormData): Promise<RegisterResult> {
  const refused = await guardRegistration("admin", fd);
  if (refused) return refused;

  const t = await getTranslations("register.errors");
  const parsed = adminSchema.safeParse({ name: fd.get("name"), email: fd.get("email") });
  if (!parsed.success) {
    logRegister("invalid_input", { portal: "admin" });
    return { error: t("checkTheForm"), fieldErrors: fieldErrors(parsed.error) };
  }
  const { firstName, lastName } = splitName(parsed.data.name);

  let admin;
  try {
    admin = await createPlatformAdminInvite({ email: parsed.data.email, firstName, lastName, scope: "ALL" });
  } catch (err) {
    if (err instanceof PlatformAdminExistsError) {
      logRegister("email_taken", { portal: "admin" });
      return { error: t("adminEmailTaken"), fieldErrors: { email: t("adminEmailTaken") } };
    }
    throw err;
  }

  await writeAuditLog({
    tenantId: null,
    // Nobody is signed in, so the platform itself is the actor.
    actorUserId: null,
    actorType: "SYSTEM",
    action: "admin.self_registered",
    entityType: "User",
    entityId: admin.id,
    metadata: { scope: "ALL" },
  });

  logRegister("success", { portal: "admin", role: "PLATFORM_ADMIN" });
  return { ok: true, email: admin.email, emailed: admin.emailed, loginUrl: admin.loginUrl };
}
