import "server-only";
import { randomBytes } from "node:crypto";
import { rawDb } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { RESERVED_SLUGS } from "@/lib/portal-hosts";
import { issuePasswordToken, INVITE_TTL_MS } from "@/lib/password-tokens";
import { appUrl } from "@/lib/app-url";
import { getEmailProvider } from "@/lib/providers/notifications";
import { senderFor } from "@/lib/emails/sender";
import { welcomeClinicOwnerEmail } from "@/lib/emails/templates";
import { DEFAULT_LOCALE, type AppLocale } from "@/lib/locale-cookie";
import type { Currency } from "@/lib/currency";

/**
 * Creating a clinic and its first owner, with no view on who is asking.
 *
 * Two doors lead here and neither should own this: a platform admin adding a
 * clinic from the agency console (lib/actions/merchants.ts), and a clinic
 * owner registering their own (lib/actions/register.ts). Authorisation,
 * validation and audit logging belong to each caller; what happens to the
 * database and the owner's mailbox belongs here, once.
 *
 * The owner never gets a password — not typed into a form, not generated, not
 * emailed. They get a one-time link and choose their own, and because their
 * role is TENANT_ADMIN, two-factor setup is then forced on their first page
 * (lib/two-factor.ts's TWO_FACTOR_REQUIRED_ROLES).
 */

export interface NewClinic {
  /** The clinic's trading name. Also the slug's basis and the branding's business name. */
  name: string;
  /** The owner's own name. Split on the first space; "Owner" stands in for a single word. */
  ownerName?: string;
  contactEmail: string;
  phone?: string;
  country?: string;
  currency: Currency;
  timezone: string;
  /** The clinic's language: the owner's portal, its clients' default, and the welcome email. */
  locale?: AppLocale;
  logoUrl?: string;
  /** The platform admin who created it, when one did. Null for self-registration. */
  createdByUserId?: string | null;
}

export interface CreatedClinic {
  tenantId: string;
  slug: string;
  ownerId: string;
  email: string;
  /** The one-time link, returned so a caller can show it when email is not configured. */
  loginUrl: string;
  emailed: boolean;
}

/** First word as the first name, the rest as the last. "Owner" when there is no rest. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() ?? "";
  return { firstName, lastName: parts.join(" ") || "Owner" };
}

/**
 * A slug nothing else is using, and that the router can actually serve.
 *
 * RESERVED_SLUGS are the first path segments the app keeps for itself — a
 * clinic at /app or /login would be unreachable on the client host, where the
 * first segment *is* the clinic (lib/portal-hosts.ts says this check belongs
 * to whoever creates a clinic, and this is that place).
 */
export async function availableSlug(name: string): Promise<string> {
  const base = slugify(name) || "clinic";
  const taken = RESERVED_SLUGS.has(base) || (await rawDb.tenant.findUnique({ where: { slug: base }, select: { id: true } })) !== null;
  if (!taken) return base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base}-${randomBytes(3).toString("hex")}`;
    if (!RESERVED_SLUGS.has(candidate) && !(await rawDb.tenant.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  // Five collisions on six random hex characters is not bad luck.
  throw new Error(`Could not find a free address for "${name}"`);
}

export async function createClinicWithOwner(input: NewClinic): Promise<CreatedClinic> {
  const email = input.contactEmail.trim().toLowerCase();
  const locale = input.locale ?? DEFAULT_LOCALE;
  const owner = splitName(input.ownerName?.trim() || input.name);
  const slug = await availableSlug(input.name);

  const created = await rawDb.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug,
        name: input.name,
        status: "ACTIVE",
        subscriptionStatus: "TRIAL",
        createdByUserId: input.createdByUserId ?? null,
        branding: {
          create: {
            businessName: input.name,
            logoUrl: input.logoUrl,
            contactEmail: email,
            contactPhone: input.phone,
            country: input.country,
            currency: input.currency,
            timeZone: input.timezone,
          },
        },
        // The clinic's language is its clients' default too, until the clinic
        // changes it in App Builder. A client who has signed up keeps their
        // own choice regardless — see User.locale.
        settings: { create: { publiclyListed: true, defaultClientLocale: locale } },
        // Seed defaults so App Builder is usable the moment they log in.
        loyaltyProgramme: { create: { pointsPerCents: 0.01, pointsPerVisit: 0 } },
      },
    });

    await tx.location.create({ data: { tenantId: tenant.id, name: `${input.name} — Main`, isPrimary: true } });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email,
        // Not a hash any password can match; set from the welcome link below.
        passwordHash: "!invited",
        status: "INVITED",
        role: "TENANT_ADMIN",
        locale,
      },
    });

    await tx.staffProfile.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        firstName: owner.firstName || input.name,
        lastName: owner.lastName,
        active: true,
        invitedAt: new Date(),
        activatedAt: new Date(),
      },
    });

    return { tenantId: tenant.id, ownerId: user.id };
  });

  // A login link, not a password shown on screen or mailed in the clear —
  // the owner sets their own, the same way a staff invite works.
  const token = await issuePasswordToken(created.ownerId, INVITE_TTL_MS);
  const loginUrl = `${appUrl()}/set-password?token=${encodeURIComponent(token)}`;

  const agency = await rawDb.agencySettings.findFirst({ select: { name: true, senderName: true, logoLightUrl: true, primaryColor: true } });
  const agencyName = agency?.senderName || agency?.name || "Deza";
  const template = welcomeClinicOwnerEmail({
    branding: { name: agencyName, logoUrl: agency?.logoLightUrl ?? null, color: agency?.primaryColor ?? null },
    ownerName: owner.firstName || input.name,
    clinicName: input.name,
    loginUrl,
    locale,
  });
  const result = await getEmailProvider().send({
    to: email,
    subject: template.subject,
    body: template.text,
    html: template.html,
    from: senderFor(agencyName),
  });

  return { tenantId: created.tenantId, slug, ownerId: created.ownerId, email, loginUrl, emailed: result.status === "SENT" };
}
