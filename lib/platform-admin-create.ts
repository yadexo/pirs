import "server-only";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { issuePasswordToken, ADMIN_INVITE_TTL_MS } from "@/lib/password-tokens";
import { appUrl } from "@/lib/app-url";
import { getEmailProvider } from "@/lib/providers/notifications";
import { senderFor } from "@/lib/emails/sender";
import { platformAdminInviteEmail } from "@/lib/emails/templates";
import { DEFAULT_LOCALE, type AppLocale } from "@/lib/locale-cookie";

/**
 * Creating a platform admin who then sets their own password, with no view on
 * who is asking.
 *
 * Two doors lead here: an existing admin inviting a colleague from the agency
 * console (lib/actions/platform-admins.ts), and the admin register page, where
 * the registration code stands in for an inviter (lib/actions/register.ts).
 * Authorisation and audit logging belong to each caller; the account, the
 * one-time link and the email belong here.
 *
 * No password is ever generated or emailed. Normally none is accepted either
 * and the account stays INVITED until the link is used; under the temporary
 * REGISTRATION_SET_PASSWORD_DIRECTLY flag the person chooses one on the
 * register form and it arrives here already validated. Two-factor setup is
 * forced either way on the first page of /agency — requireAgencyContext
 * checks it fresh on every request, so there is no window in which a new
 * admin is browsing without it.
 */

/**
 * What a platform admin can see.
 *
 * Only "ALL" exists today: every clinic, which is what a platform admin has
 * always meant. It is a parameter rather than an assumption so that adding a
 * narrower kind — an admin who sees only the clinics they look after — is a
 * new value here and a column to store it, not a rewrite of the two create
 * paths and the invite email. Where that column should go is the organization
 * work: a membership row above the clinic, which is also what would let one
 * person hold several clinics without a user row per clinic.
 */
export type AdminScope = "ALL";

export interface NewPlatformAdmin {
  email: string;
  firstName: string;
  lastName: string;
  locale?: AppLocale;
  scope?: AdminScope;
  /**
   * A password the person chose for themselves, which makes the account
   * usable at once instead of INVITED-until-the-link-is-used. Only ever set
   * by the register page under REGISTRATION_SET_PASSWORD_DIRECTLY — see
   * lib/registration-code.ts. Validated by the caller; hashed here and never
   * returned, logged or emailed.
   */
  password?: string;
}

export interface CreatedPlatformAdmin {
  id: string;
  email: string;
  /**
   * Where they go next: the one-time link that sets their password, or — when
   * they chose one on the form — the sign-in page. Returned so a caller can
   * show it when email is not configured. Never a password.
   */
  loginUrl: string;
  emailed: boolean;
  /** True when the account is already usable, because its holder set a password. */
  readyToSignIn: boolean;
}

/** The address already holds a platform admin account, so a second one could not sign in. */
export class PlatformAdminExistsError extends Error {
  constructor() {
    super("That email is already a platform admin.");
    this.name = "PlatformAdminExistsError";
  }
}

export async function createPlatformAdminInvite(input: NewPlatformAdmin): Promise<CreatedPlatformAdmin> {
  const email = input.email.trim().toLowerCase();
  const locale = input.locale ?? DEFAULT_LOCALE;
  const chosenHash = input.password ? await hashPassword(input.password) : null;

  // Serializable, so two people registering the same address at the same
  // moment cannot both pass the check. Only another *platform admin* clashes:
  // the admin door considers no other kind of account, so the same person may
  // own a clinic or be a client of one (lib/portal-scope.ts).
  const admin = await rawDb.$transaction(
    async (tx) => {
      if (await tx.user.findFirst({ where: { email, role: "PLATFORM_ADMIN" }, select: { id: true } })) throw new PlatformAdminExistsError();
      return tx.user.create({
        data: {
          tenantId: null,
          email,
          // Normally not a hash any password can match, and INVITED until the
          // link is used. With a password chosen on the form, the account is
          // theirs and usable from this moment.
          passwordHash: chosenHash ?? "!invited",
          status: chosenHash ? "ACTIVE" : "INVITED",
          role: "PLATFORM_ADMIN",
          firstName: input.firstName,
          lastName: input.lastName,
          locale,
        },
        select: { id: true, email: true },
      });
    },
    { isolationLevel: "Serializable" },
  );

  // No token when there is nothing to set: an unused one would be a second,
  // quieter way into an account that already has a password.
  let loginUrl = `${appUrl()}/login?next=${encodeURIComponent("/agency")}`;
  if (!chosenHash) {
    const token = await issuePasswordToken(admin.id, ADMIN_INVITE_TTL_MS);
    loginUrl = `${appUrl()}/set-password?token=${encodeURIComponent(token)}`;
  }

  const agency = await rawDb.agencySettings.findFirst({ select: { name: true, senderName: true, logoLightUrl: true, primaryColor: true } });
  const agencyName = agency?.senderName || agency?.name || "Deza";
  const template = platformAdminInviteEmail({
    branding: { name: agencyName, logoUrl: agency?.logoLightUrl ?? null, color: agency?.primaryColor ?? null },
    firstName: input.firstName,
    loginUrl,
    locale,
  });
  const result = await getEmailProvider().send({
    to: admin.email,
    subject: template.subject,
    body: template.text,
    html: template.html,
    from: senderFor(agencyName),
  });

  return { id: admin.id, email: admin.email, loginUrl, emailed: result.status === "SENT", readyToSignIn: chosenHash !== null };
}
