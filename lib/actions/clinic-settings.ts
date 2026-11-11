"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, formBool, formText, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { issuePasswordToken, INVITE_TTL_MS } from "@/lib/password-tokens";
import { rateLimit } from "@/lib/rate-limit";
import { getEmailProvider } from "@/lib/providers/notifications";
import { isPermissionKey } from "@/lib/permissions";
import { WEEKDAYS, type OpeningHours } from "@/lib/opening-hours";
import { appUrl } from "@/lib/app-url";
import { checkWindow, DEFAULT_WINDOW_END, DEFAULT_WINDOW_START } from "@/lib/marketing-window";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";

/**
 * App Builder → Settings. Each section saves through one action here, named
 * for the clinic and authorised by requireMerchantAction — owners and agency
 * admins for anything that changes the business, specific permissions for
 * day-to-day configuration.
 */

const fieldError = (field: string, message: string) => new z.ZodError([{ code: "custom", path: [field], message }]);

async function revalidateMerchant(merchantId: string) {
  const tenant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { slug: true } });
  revalidatePath(`/m/${merchantId}`, "layout");
  if (tenant) revalidatePath(`/app/${tenant.slug}`, "layout");
}

const toNumber = (v: unknown) => (v === undefined || v === "" ? undefined : Number(String(v).replace(",", ".")));
const wholeNumber = (label: string, min: number, max: number) =>
  z.preprocess(
    toNumber,
    z
      .number({ required_error: `Enter ${label}`, invalid_type_error: `Enter ${label}` })
      .int("Use a whole number")
      .min(min, `Must be at least ${min}`)
      .max(max, `Must be at most ${max}`),
  );
const optionalText = (max: number) => z.string().max(max, `Keep it under ${max} characters`).optional();
/** Money typed as "25" or "25.50", stored as cents. */
const moneyCents = (label: string) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : String(v).replace(",", ".").trim()),
    z
      .string({ required_error: `Enter ${label}` })
      .regex(/^d{1,7}(.d{1,2})?$/, "Enter an amount like 25 or 25.50")
      .transform((n) => Math.round(Number(n) * 100)),
  );
const httpsUrl = z
  .string()
  .max(2048)
  .refine((v) => /^https:\/\/[^\s"'<>]+\.[^\s"'<>]+/.test(v), "Enter a full link starting with https://");
const imageUrl = z
  .string()
  .max(2048)
  .refine((v) => v.startsWith("/uploads/") || /^https:\/\/[^\s"'<>]+$/.test(v), "Upload the image again");

/** Settings rows are created on first save for clinics that predate them. */
async function upsertSettings(merchantId: string, data: Record<string, unknown>) {
  await rawDb.tenantSettings.upsert({ where: { tenantId: merchantId }, create: { tenantId: merchantId, ...data }, update: data });
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

const generalSchema = z.object({
  vatRatePercent: z.preprocess(
    toNumber,
    z
      .number({ invalid_type_error: "Enter a percentage" })
      .min(0, "Can't be negative")
      .max(100, "Must be 100 or less")
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, "Use at most two decimals"),
  ),
  payLaterEnabled: z.boolean(),
  publiclyListed: z.boolean(),
  shopBannerHeadline: optionalText(80),
  shopBannerSubtitle: optionalText(120),
  shopBannerButtonLabel: optionalText(30),
  installNudgeEnabled: z.boolean(),
  // One short sentence, so it fits a phone without scrolling. Empty means our
  // own default for that language, not a blank space on a client's screen.
  installNudgeMessageNl: optionalText(160),
  installNudgeMessageEn: optionalText(160),
  termsContent: optionalText(20000),
  privacyContent: optionalText(20000),
  cancellationPolicy: optionalText(5000),
  defaultClientLocale: z.enum(["nl", "en"]),
  clientFormality: z.enum(["INFORMAL", "FORMAL"]),
});

export async function saveGeneralSettingsAction(merchantId: string, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    const data = generalSchema.parse({
      vatRatePercent: formText(fd, "vatRatePercent") ?? "21",
      payLaterEnabled: formBool(fd, "payLaterEnabled"),
      publiclyListed: formBool(fd, "publiclyListed"),
      shopBannerHeadline: formText(fd, "shopBannerHeadline"),
      shopBannerSubtitle: formText(fd, "shopBannerSubtitle"),
      shopBannerButtonLabel: formText(fd, "shopBannerButtonLabel"),
      installNudgeEnabled: formBool(fd, "installNudgeEnabled"),
      installNudgeMessageNl: formText(fd, "installNudgeMessageNl"),
      installNudgeMessageEn: formText(fd, "installNudgeMessageEn"),
      termsContent: formText(fd, "termsContent"),
      privacyContent: formText(fd, "privacyContent"),
      cancellationPolicy: formText(fd, "cancellationPolicy"),
      defaultClientLocale: formText(fd, "defaultClientLocale") ?? "nl",
      clientFormality: formText(fd, "clientFormality") ?? "INFORMAL",
    });

    await upsertSettings(merchantId, {
      vatRateBasisPoints: Math.round(data.vatRatePercent * 100),
      payLaterEnabled: data.payLaterEnabled,
      publiclyListed: data.publiclyListed,
      shopBannerHeadline: data.shopBannerHeadline ?? null,
      shopBannerSubtitle: data.shopBannerSubtitle ?? null,
      shopBannerButtonLabel: data.shopBannerButtonLabel ?? null,
      installNudgeEnabled: data.installNudgeEnabled,
      installNudgeMessageNl: data.installNudgeMessageNl ?? null,
      installNudgeMessageEn: data.installNudgeMessageEn ?? null,
      defaultClientLocale: data.defaultClientLocale,
      clientFormality: data.clientFormality,
    });
    await ensureBranding(merchantId);
    await rawDb.tenantBranding.update({
      where: { tenantId: merchantId },
      data: {
        termsContent: data.termsContent ?? null,
        privacyContent: data.privacyContent ?? null,
        cancellationPolicy: data.cancellationPolicy ?? null,
      },
    });
    await ctx.audit("settings.general.updated", "TenantSettings", merchantId);
    await revalidateMerchant(merchantId);
    return {};
  });
}

async function ensureBranding(merchantId: string) {
  const tenant = await rawDb.tenant.findUniqueOrThrow({ where: { id: merchantId }, select: { name: true } });
  await rawDb.tenantBranding.upsert({
    where: { tenantId: merchantId },
    create: { tenantId: merchantId, businessName: tenant.name },
    update: {},
  });
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

const CURRENCIES = new Set<string>(SUPPORTED_CURRENCIES);
const TIME_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

const brandingSchema = z.object({
  businessName: z.string({ required_error: "Enter the clinic's name" }).min(1, "Enter the clinic's name").max(120),
  logoUrl: imageUrl.optional(),
  appIconUrl: imageUrl.optional(),
  coverImageUrl: imageUrl.optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour"),
  launchBackground: z.enum(["brand", "white"]).default("brand"),
  contactEmail: z.string().email("Enter a valid email").max(254).optional(),
  contactPhone: z.string().max(40).regex(/^[+\d\s().-]*$/, "Digits, spaces, + and - only").optional(),
  website: httpsUrl.optional(),
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(80),
  region: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  currency: z.string().refine((c) => CURRENCIES.has(c), "Choose a currency"),
  timeZone: z.string().refine((t) => TIME_ZONES.has(t), "Choose a time zone"),
});

export async function saveBrandingAction(merchantId: string, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    const data = brandingSchema.parse({
      businessName: formText(fd, "businessName"),
      logoUrl: formText(fd, "logoUrl"),
      appIconUrl: formText(fd, "appIconUrl"),
      coverImageUrl: formText(fd, "coverImageUrl"),
      primaryColor: formText(fd, "primaryColor"),
      launchBackground: formText(fd, "launchBackground"),
      contactEmail: formText(fd, "contactEmail"),
      contactPhone: formText(fd, "contactPhone"),
      website: formText(fd, "website"),
      addressLine1: formText(fd, "addressLine1"),
      addressLine2: formText(fd, "addressLine2"),
      city: formText(fd, "city"),
      region: formText(fd, "region"),
      postalCode: formText(fd, "postalCode"),
      country: formText(fd, "country"),
      currency: formText(fd, "currency"),
      timeZone: formText(fd, "timeZone"),
    });

    await ensureBranding(merchantId);
    const current = await rawDb.tenantBranding.findUniqueOrThrow({ where: { tenantId: merchantId } });

    // Money already taken is recorded in the old currency. Switching now would
    // mix two currencies in the same reports and totals.
    if (current.currency !== data.currency) {
      const [paid, members] = await Promise.all([
        ctx.db.order.count({ where: { status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"] } } }),
        ctx.db.customerMembership.count({ where: {} }),
      ]);
      if (paid + members > 0) {
        throw fieldError("currency", "This clinic has already taken payments in its current currency, so it can't be changed.");
      }
    }

    const nullable = (v: string | undefined) => v ?? null;
    await rawDb.tenantBranding.update({
      where: { tenantId: merchantId },
      data: {
        businessName: data.businessName,
        logoUrl: nullable(data.logoUrl),
        appIconUrl: nullable(data.appIconUrl),
        coverImageUrl: nullable(data.coverImageUrl),
        primaryColor: data.primaryColor,
        launchBackground: data.launchBackground,
        contactEmail: nullable(data.contactEmail),
        contactPhone: nullable(data.contactPhone),
        website: nullable(data.website),
        addressLine1: nullable(data.addressLine1),
        addressLine2: nullable(data.addressLine2),
        city: nullable(data.city),
        region: nullable(data.region),
        postalCode: nullable(data.postalCode),
        country: nullable(data.country),
        currency: data.currency,
        timeZone: data.timeZone,
      },
    });
    await ctx.audit("settings.branding.updated", "TenantBranding", merchantId);
    await revalidateMerchant(merchantId);
    return {};
  });
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/**
 * How many team changes one person may make in an hour.
 *
 * Not about brute force — every one of these is behind an owner session —
 * but about blast radius: a stolen session, or a script with a bug in its
 * loop, should not be able to invite a thousand accounts or churn everyone's
 * rights before anybody notices. Generous enough that a real owner setting up
 * a clinic never meets it.
 */
const TEAM_INVITES_PER_HOUR = 20;
const TEAM_WRITES_PER_HOUR = 60;

async function limitTeamInvites(actorUserId: string) {
  if (!(await rateLimit(`team-invite:${actorUserId}`, TEAM_INVITES_PER_HOUR, 60 * 60 * 1000)).ok) {
    throw new ActionError("That is a lot of invitations at once. Try again in a little while.");
  }
}

async function limitTeamWrites(actorUserId: string) {
  if (!(await rateLimit(`team-write:${actorUserId}`, TEAM_WRITES_PER_HOUR, 60 * 60 * 1000)).ok) {
    throw new ActionError("That is a lot of changes at once. Try again in a little while.");
  }
}

async function sendInvite(merchantId: string, userId: string, email: string, firstName: string) {
  const token = await issuePasswordToken(userId, INVITE_TTL_MS);
  const link = `${appUrl()}/set-password?token=${encodeURIComponent(token)}`;
  const branding = await rawDb.tenantBranding.findUnique({ where: { tenantId: merchantId }, select: { businessName: true } });
  const clinic = branding?.businessName ?? "your clinic";
  const result = await getEmailProvider().send({
    to: email,
    subject: `You're invited to ${clinic}`,
    body: [`Hi ${firstName},`, "", `You've been added to the team at ${clinic}.`, "Set your password to get started (the link works for 7 days):", link].join("\n"),
  });
  return { link, emailed: result.status === "SENT" };
}

const inviteSchema = z.object({
  firstName: z.string({ required_error: "Enter a first name" }).min(1, "Enter a first name").max(80),
  lastName: z.string({ required_error: "Enter a last name" }).min(1, "Enter a last name").max(80),
  email: z.string({ required_error: "Enter an email" }).trim().toLowerCase().email("Enter a valid email").max(254),
  title: optionalText(80),
  roleId: z.string().optional(),
});

/**
 * Adds a staff member who sets their own password from an emailed link. The
 * link is also returned, once, so an owner can pass it on when email is not
 * configured yet.
 */
export async function inviteStaffAction(merchantId: string, fd: FormData): Promise<ActionResult<{ inviteLink: string; emailed: boolean }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    await limitTeamInvites(ctx.user.id);
    const data = inviteSchema.parse({
      firstName: formText(fd, "firstName"),
      lastName: formText(fd, "lastName"),
      email: formText(fd, "email"),
      title: formText(fd, "title"),
      roleId: formText(fd, "roleId"),
    });
    if (data.roleId && !(await ctx.db.role.findFirst({ where: { id: data.roleId } }))) throw fieldError("roleId", "Choose a role");
    if (await rawDb.user.findFirst({ where: { tenantId: merchantId, email: data.email } })) {
      throw fieldError("email", "Someone at this clinic already uses this email");
    }

    const user = await rawDb.user.create({
      data: {
        tenantId: merchantId,
        email: data.email,
        // Not a hash any password can match; the account is INVITED until the link is used.
        passwordHash: "!invited",
        role: "STAFF",
        status: "INVITED",
        staffProfile: {
          create: {
            tenantId: merchantId,
            firstName: data.firstName,
            lastName: data.lastName,
            title: data.title ?? null,
            roleId: data.roleId ?? null,
            invitedAt: new Date(),
          },
        },
      },
    });
    const { link, emailed } = await sendInvite(merchantId, user.id, data.email, data.firstName);
    await ctx.audit("staff.invited", "User", user.id, { email: data.email });
    await revalidateMerchant(merchantId);
    return { inviteLink: link, emailed };
  });
}

/**
 * Someone on this clinic's team: a staff member or one of its owners.
 *
 * Owners are included because the team list shows them (settings/load.ts reads
 * both roles), and a list you cannot act on is a list that lies. What may be
 * done to an owner is narrower, and each action says so for itself.
 */
async function findTeamMember(merchantId: string, staffProfileId: string) {
  const profile = await rawDb.staffProfile.findFirst({ where: { id: staffProfileId, tenantId: merchantId }, include: { user: true } });
  if (!profile || (profile.user.role !== "STAFF" && profile.user.role !== "TENANT_ADMIN")) {
    throw new ActionError("That team member no longer exists.");
  }
  return profile;
}

/**
 * Refuses when this would leave the clinic with no owner who can sign in.
 *
 * The lock is the load-bearing part, not the isolation level: two owners
 * deactivating each other at the same moment both count "one will be left"
 * and both are right until the other commits. Locking this clinic's active
 * owners first makes the second caller wait, count again, and refuse. The
 * platform-admin guard in lib/actions/platform-admins.ts learned the same
 * lesson the same way.
 */
async function assertNotLastOwner(tx: Prisma.TransactionClient, merchantId: string, userId: string) {
  await tx.$queryRaw`
    SELECT u.id FROM "User" u
    JOIN "StaffProfile" s ON s."userId" = u.id
    WHERE u."tenantId" = ${merchantId} AND u.role = 'TENANT_ADMIN' AND u.status = 'ACTIVE' AND s.active = true
    FOR UPDATE OF u`;
  const others = await tx.user.count({
    where: { tenantId: merchantId, role: "TENANT_ADMIN", status: "ACTIVE", id: { not: userId }, staffProfile: { active: true } },
  });
  if (others === 0) throw new ActionError("At least one active owner must remain at this clinic.");
}

export async function resendInviteAction(merchantId: string, staffProfileId: string): Promise<ActionResult<{ inviteLink: string; emailed: boolean }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    await limitTeamWrites(ctx.user.id);
    const profile = await findTeamMember(merchantId, staffProfileId);
    if (profile.user.status !== "INVITED") throw new ActionError("They have already set up their account.");
    const { link, emailed } = await sendInvite(merchantId, profile.userId, profile.user.email, profile.firstName);
    await ctx.audit("staff.invite_resent", "User", profile.userId);
    return { inviteLink: link, emailed };
  });
}

export async function setStaffRoleAction(merchantId: string, staffProfileId: string, roleId: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    await limitTeamWrites(ctx.user.id);
    const profile = await findTeamMember(merchantId, staffProfileId);
    // An owner already has everything a role could grant (permissionsFor in
    // lib/live-account.ts gives TENANT_ADMIN "ALL" and never reads the role),
    // so storing one here would be a setting that quietly does nothing.
    if (profile.user.role === "TENANT_ADMIN") throw new ActionError("An owner already has full access, so a role would change nothing.");
    if (roleId && !(await ctx.db.role.findFirst({ where: { id: roleId } }))) throw new ActionError("That role no longer exists.");
    await rawDb.staffProfile.update({ where: { id: profile.id }, data: { roleId } });
    await ctx.audit("staff.role_changed", "StaffProfile", profile.id, { roleId });
    await revalidateMerchant(merchantId);
    return {};
  });
}

/**
 * Turns someone's access off (or back on).
 *
 * Takes effect on their very next request, not at their next sign-in: the
 * profile flag stops loadLiveAccount for staff, and sessionsValidAfter ends
 * every session that already existed — which is what "disable this account"
 * has to mean for an owner, whose role is not gated by the profile flag at
 * all. Reactivating leaves that cut-off exactly where it is — clearing it
 * would resurrect the sessions this deactivation ended, and would undo the
 * cut-off a password reset may have set since. They sign in again.
 */
export async function setStaffActiveAction(merchantId: string, staffProfileId: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    await limitTeamWrites(ctx.user.id);
    const profile = await findTeamMember(merchantId, staffProfileId);
    // Locking yourself out of your own clinic is never what was meant.
    if (!active && profile.userId === ctx.user.id) throw new ActionError("You can't remove your own access.");

    await rawDb.$transaction(
      async (tx) => {
        // Inside the transaction that does the write, so the lock it takes is
        // still held when the row changes. Checking in a transaction of its
        // own would release it first and prove nothing.
        if (!active && profile.user.role === "TENANT_ADMIN") await assertNotLastOwner(tx, merchantId, profile.userId);
        await tx.staffProfile.update({ where: { id: profile.id }, data: { active, deactivatedAt: active ? null : new Date() } });
        if (!active) await tx.user.update({ where: { id: profile.userId }, data: { sessionsValidAfter: new Date() } });
      },
      { isolationLevel: "Serializable" },
    );
    await ctx.audit(active ? "staff.reactivated" : "staff.deactivated", "StaffProfile", profile.id, { userId: profile.userId, role: profile.user.role });
    await revalidateMerchant(merchantId);
    return {};
  });
}

const roleSchema = z.object({
  name: z.string({ required_error: "Enter a role name" }).min(1, "Enter a role name").max(60),
  permissions: z.array(z.string().refine(isPermissionKey, "Unknown permission")),
});

export async function saveRoleAction(merchantId: string, roleId: string | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    await limitTeamWrites(ctx.user.id);
    const data = roleSchema.parse({ name: formText(fd, "name"), permissions: fd.getAll("permissions").map(String) });

    const clash = await ctx.db.role.findFirst({ where: { name: { equals: data.name, mode: "insensitive" }, ...(roleId ? { NOT: { id: roleId } } : {}) } });
    if (clash) throw fieldError("name", "There is already a role with this name");

    const permissions = await rawDb.permission.findMany({ where: { key: { in: data.permissions } }, select: { id: true } });
    const savedId = await rawDb.$transaction(async (tx) => {
      let id = roleId;
      if (id) {
        const updated = await tx.role.updateMany({ where: { id, tenantId: merchantId }, data: { name: data.name } });
        if (updated.count === 0) throw new ActionError("That role no longer exists.");
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
      } else {
        id = (await tx.role.create({ data: { tenantId: merchantId, name: data.name } })).id;
      }
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: id!, permissionId: p.id })) });
      return id;
    });
    await ctx.audit(roleId ? "role.updated" : "role.created", "Role", savedId, { permissions: data.permissions });
    await revalidateMerchant(merchantId);
    return { id: savedId };
  });
}

export async function deleteRoleAction(merchantId: string, roleId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    await limitTeamWrites(ctx.user.id);
    const inUse = await ctx.db.staffProfile.count({ where: { roleId } });
    if (inUse > 0) throw new ActionError(`${inUse} staff member${inUse === 1 ? " has" : "s have"} this role. Give them another role first.`);
    const { count } = await ctx.db.role.deleteMany({ where: { id: roleId } });
    if (count === 0) throw new ActionError("That role no longer exists.");
    await ctx.audit("role.deleted", "Role", roleId);
    await revalidateMerchant(merchantId);
    return {};
  });
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

function parseOpeningHours(fd: FormData): OpeningHours {
  const hours = {} as OpeningHours;
  const issues: z.ZodIssue[] = [];
  for (const day of WEEKDAYS) {
    if (formBool(fd, `${day}.closed`)) {
      hours[day] = null;
      continue;
    }
    const open = time.safeParse(formText(fd, `${day}.open`));
    const close = time.safeParse(formText(fd, `${day}.close`));
    if (!open.success || !close.success) {
      issues.push({ code: "custom", path: [`${day}.open`], message: "Enter opening and closing times, or mark closed" });
      continue;
    }
    if (close.data <= open.data) {
      issues.push({ code: "custom", path: [`${day}.open`], message: "Closing must be after opening" });
      continue;
    }
    hours[day] = { open: open.data, close: close.data };
  }
  if (issues.length) throw new z.ZodError(issues);
  return hours;
}

const locationSchema = z.object({
  name: z.string({ required_error: "Enter a name" }).min(1, "Enter a name").max(120),
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(80),
  region: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  phone: z.string().max(40).regex(/^[+\d\s().-]*$/, "Digits, spaces, + and - only").optional(),
  isPrimary: z.boolean(),
});

export async function saveLocationAction(merchantId: string, id: string | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    const data = locationSchema.parse({
      name: formText(fd, "name"),
      addressLine1: formText(fd, "addressLine1"),
      addressLine2: formText(fd, "addressLine2"),
      city: formText(fd, "city"),
      region: formText(fd, "region"),
      postalCode: formText(fd, "postalCode"),
      country: formText(fd, "country"),
      phone: formText(fd, "phone"),
      isPrimary: formBool(fd, "isPrimary"),
    });
    const openingHours = parseOpeningHours(fd);
    const values = {
      name: data.name,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      city: data.city ?? null,
      region: data.region ?? null,
      postalCode: data.postalCode ?? null,
      country: data.country ?? null,
      phone: data.phone ?? null,
      openingHours,
    };

    const savedId = await rawDb.$transaction(async (tx) => {
      const activeCount = await tx.location.count({ where: { tenantId: merchantId, active: true } });
      // The first location is the primary one; there is always exactly one.
      const makePrimary = data.isPrimary || activeCount === 0 || (id !== null && activeCount === 1);
      if (makePrimary) await tx.location.updateMany({ where: { tenantId: merchantId }, data: { isPrimary: false } });
      if (id) {
        const updated = await tx.location.updateMany({ where: { id, tenantId: merchantId, active: true }, data: { ...values, ...(makePrimary ? { isPrimary: true } : {}) } });
        if (updated.count === 0) throw new ActionError("That location no longer exists.");
        return id;
      }
      return (await tx.location.create({ data: { tenantId: merchantId, ...values, isPrimary: makePrimary } })).id;
    });
    await ctx.audit(id ? "location.updated" : "location.created", "Location", savedId, { name: data.name });
    await revalidateMerchant(merchantId);
    return { id: savedId };
  });
}

export async function archiveLocationAction(merchantId: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    const location = await ctx.db.location.findFirst({ where: { id, active: true } });
    if (!location) throw new ActionError("That location no longer exists.");
    const others = await ctx.db.location.findMany({ where: { active: true, NOT: { id } }, orderBy: { createdAt: "asc" } });
    if (others.length === 0) throw new ActionError("A clinic needs at least one location.");
    const upcoming = await ctx.db.appointment.count({ where: { locationId: id, startAt: { gte: new Date() }, status: { in: ["REQUESTED", "CONFIRMED"] } } });
    if (upcoming > 0) throw new ActionError(`${upcoming} upcoming appointment${upcoming === 1 ? " is" : "s are"} booked here. Move or cancel them first.`);

    await rawDb.$transaction([
      rawDb.location.update({ where: { id }, data: { active: false, isPrimary: false } }),
      ...(location.isPrimary ? [rawDb.location.update({ where: { id: others[0]!.id }, data: { isPrimary: true } })] : []),
    ]);
    await ctx.audit("location.archived", "Location", id);
    await revalidateMerchant(merchantId);
    return {};
  });
}

// ---------------------------------------------------------------------------
// Loyalty rules
// ---------------------------------------------------------------------------

const loyaltySchema = z.object({
  active: z.boolean(),
  pointsPerUnit: z.preprocess(
    toNumber,
    z.number({ invalid_type_error: "Enter a number" }).min(0, "Can't be negative").max(1000, "Must be at most 1000"),
  ),
  pointsPerVisit: wholeNumber("points per visit", 0, 100_000),
  referralPoints: wholeNumber("referral points", 0, 100_000),
  birthdayPoints: wholeNumber("birthday points", 0, 100_000),
  reviewPoints: wholeNumber("review points", 0, 100_000),
  googleReviewUrl: httpsUrl.optional(),
  pointsExpiryDays: wholeNumber("an expiry", 1, 3650).optional(),
});

export async function saveLoyaltyRulesAction(merchantId: string, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "loyalty.adjust");
    const data = loyaltySchema.parse({
      active: formBool(fd, "active"),
      pointsPerUnit: formText(fd, "pointsPerUnit") ?? "0",
      pointsPerVisit: formText(fd, "pointsPerVisit") ?? "0",
      referralPoints: formText(fd, "referralPoints") ?? "0",
      birthdayPoints: formText(fd, "birthdayPoints") ?? "0",
      reviewPoints: formText(fd, "reviewPoints") ?? "0",
      googleReviewUrl: formText(fd, "googleReviewUrl"),
      pointsExpiryDays: formText(fd, "pointsExpiryDays"),
    });
    if (data.reviewPoints > 0 && !data.googleReviewUrl) throw fieldError("googleReviewUrl", "Add your Google review link to award review points");

    const programme = {
      active: data.active,
      // Stored per cent spent; typed per whole currency unit.
      pointsPerCents: data.pointsPerUnit / 100,
      pointsPerVisit: data.pointsPerVisit,
      referralPoints: data.referralPoints,
      birthdayPoints: data.birthdayPoints,
      reviewPoints: data.reviewPoints,
      pointsExpiryDays: data.pointsExpiryDays ?? null,
    };
    await rawDb.loyaltyProgramme.upsert({ where: { tenantId: merchantId }, create: { tenantId: merchantId, ...programme }, update: programme });
    await upsertSettings(merchantId, { googleReviewUrl: data.googleReviewUrl ?? null });
    await ctx.audit("settings.loyalty.updated", "LoyaltyProgramme", merchantId, programme);
    await revalidateMerchant(merchantId);
    return {};
  });
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

const bookingSchema = z
  .object({
    bookingMode: z.enum(["IN_APP", "EXTERNAL"]),
    externalBookingUrl: httpsUrl.optional(),
    appointmentCancellationHours: wholeNumber("a notice period", 0, 24 * 14),
    appointmentReminderHours: wholeNumber("a reminder time", 0, 24 * 14),
    bookingDepositPercent: wholeNumber("a deposit percentage", 0, 100),
    bookingDepositFixedCents: moneyCents("a deposit amount").optional(),
  })
  .superRefine((b, ctx) => {
    if (b.bookingMode === "EXTERNAL" && !b.externalBookingUrl) {
      ctx.addIssue({ code: "custom", path: ["externalBookingUrl"], message: "Add the link clients should book on" });
    }
  });

export async function saveBookingSettingsAction(merchantId: string, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "appointments.manage");
    const data = bookingSchema.parse({
      bookingMode: formText(fd, "bookingMode") ?? "IN_APP",
      externalBookingUrl: formText(fd, "externalBookingUrl"),
      appointmentCancellationHours: formText(fd, "appointmentCancellationHours") ?? "0",
      appointmentReminderHours: formText(fd, "appointmentReminderHours") ?? "0",
      bookingDepositPercent: formText(fd, "bookingDepositPercent") ?? "0",
      bookingDepositFixedCents: formText(fd, "bookingDeposit"),
    });
    await upsertSettings(merchantId, {
      ...data,
      externalBookingUrl: data.externalBookingUrl ?? null,
      bookingDepositFixedCents: data.bookingDepositFixedCents ?? 0,
    });
    await ctx.audit("settings.booking.updated", "TenantSettings", merchantId, data);
    await revalidateMerchant(merchantId);
    return {};
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * The clinic's own sending window, checked against the platform's limits.
 *
 * The limits exist for the clients, not the clinic, so they are enforced here
 * rather than only in the form: 07:00 at the earliest, 22:00 at the latest,
 * and an hour wide at least.
 */
function marketingWindow(fd: FormData): { marketingWindowStartMinutes: number; marketingWindowEndMinutes: number; marketingDailyLimit: number } {
  const start = Number(formText(fd, "marketingWindowStartMinutes") ?? DEFAULT_WINDOW_START);
  const end = Number(formText(fd, "marketingWindowEndMinutes") ?? DEFAULT_WINDOW_END);
  const problem = checkWindow(start, end);
  if (!problem.ok) {
    throw fieldError(problem.field === "start" ? "marketingWindowStartMinutes" : "marketingWindowEndMinutes", problem.message);
  }
  // 0 means no limit; anything else must be one of the offered steps, so a
  // hand-crafted form cannot set 50 a day.
  const limitRaw = Number(formText(fd, "marketingDailyLimit") ?? 1);
  const allowed = [0, 1, 2, 3, 5];
  const marketingDailyLimit = allowed.includes(limitRaw) ? limitRaw : 1;

  return { marketingWindowStartMinutes: start, marketingWindowEndMinutes: end, marketingDailyLimit };
}

export async function saveNotificationSettingsAction(merchantId: string, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "owner");
    const data = {
      notifyBookingConfirmations: formBool(fd, "notifyBookingConfirmations"),
      notifyAppointmentReminders: formBool(fd, "notifyAppointmentReminders"),
      notifyPointsEarned: formBool(fd, "notifyPointsEarned"),
      ...marketingWindow(fd),
      birthdayMessageEnabled: formBool(fd, "birthdayMessageEnabled"),
      birthdayMessage: formText(fd, "birthdayMessage") ?? null,
      // A percentage of zero means a greeting with no present attached.
      birthdayDiscountPercent: Math.min(100, Math.max(0, Number(formText(fd, "birthdayDiscountPercent") ?? 0) || 0)),
      birthdayDiscountDays: Math.min(365, Math.max(1, Number(formText(fd, "birthdayDiscountDays") ?? 14) || 14)),
      notifyMembershipBilling: formBool(fd, "notifyMembershipBilling"),
    };
    await upsertSettings(merchantId, data);
    await ctx.audit("settings.notifications.updated", "TenantSettings", merchantId, data);
    await revalidateMerchant(merchantId);
    return {};
  });
}
