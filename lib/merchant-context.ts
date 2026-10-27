import "server-only";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { loadLiveAccount, type LiveAccount } from "@/lib/live-account";
import { twoFactorRequiredForRole } from "@/lib/two-factor";
import { getImpersonatedMerchantId } from "@/lib/actions/impersonation";
import type { SidebarEntry } from "@/components/shell/sidebar";
import type { SupportLink } from "@/components/shell/sidebar";
import type { SwitchableMerchant } from "@/components/shell/merchant-switcher";

export interface MerchantContext {
  merchantId: string;
  merchantName: string;
  db: TenantDb;
  /** True when an agency admin is viewing this merchant. */
  impersonating: boolean;
  /** Non-null only for agency admins, for the sidebar switcher. */
  switchableMerchants: SwitchableMerchant[] | null;
  support: SupportLink | null;
  /** The clinic's own colour, for the portal shell's brand roles. */
  accentColor: string | null;
  /** The clinic's slug, for the top bar's "View app". */
  merchantSlug: string;
  /** Who is looking, from the live account — for showing or hiding edit controls. */
  viewer: { name: string; role: LiveAccount["role"]; permissions: LiveAccount["permissions"] };
}

/**
 * Resolves and authorises the merchant in the URL.
 *
 * A merchant user requesting a merchant that is not theirs gets a hard 404 —
 * not a redirect — so the existence of other merchants is never observable.
 * An agency admin may reach any merchant, which is what impersonation is.
 */
export async function requireMerchantContext(merchantId: string): Promise<MerchantContext> {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser) redirect("/login");
  const live = await loadLiveAccount(sessionUser.id, sessionUser.authTime);
  // A session for an account that has since been deactivated. /login treats
  // it as signed out, so this cannot bounce back and forth.
  if (!live) redirect("/login?reason=access-changed");
  const user = { ...sessionUser, ...live };

  // Required for an owner or an agency admin, checked fresh (not from the
  // 30-day token) on every page in here — same reasoning as loadLiveAccount
  // itself. Not optional in the sense of "ask once and remember": an account
  // that had it and lost it (lib/two-factor.ts's disable path) is caught
  // the same way a deactivated account already is.
  if (twoFactorRequiredForRole(user.role) && !user.twoFactorConfirmed) await redirectToTwoFactorSetup();

  const isAgencyAdmin = user.role === "PLATFORM_ADMIN";

  if (!isAgencyAdmin) {
    // Merchant users are pinned to their own merchant. Anything else is a 404.
    if (user.tenantId !== merchantId) notFound();
    if (user.role !== "TENANT_ADMIN" && user.role !== "STAFF") notFound();
  }

  const merchant = await rawDb.tenant.findUnique({
    where: { id: merchantId },
    include: { branding: true },
  });
  if (!merchant) notFound();

  // A suspended merchant is invisible to its own users but still reachable by
  // the agency, which is how it gets un-suspended.
  if (merchant.status !== "ACTIVE" && !isAgencyAdmin) notFound();

  let switchableMerchants: SwitchableMerchant[] | null = null;
  let impersonating = false;

  if (isAgencyAdmin) {
    impersonating = (await getImpersonatedMerchantId()) === merchantId;
    const all = await rawDb.tenant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    switchableMerchants = all;
  }

  const support = await getSupportLink();

  return {
    merchantId,
    merchantName: merchant.branding?.businessName ?? merchant.name,
    accentColor: merchant.branding?.primaryColor ?? null,
    merchantSlug: merchant.slug,
    db: getTenantDb(merchantId),
    impersonating,
    switchableMerchants,
    support,
    viewer: { name: user.name ?? user.email ?? "", role: user.role, permissions: user.permissions },
  };
}

/** Agency-level guard for /agency/*. Merchant users get a 404, never a redirect loop. */
export async function requireAgencyContext() {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser) redirect("/login");
  const live = await loadLiveAccount(sessionUser.id, sessionUser.authTime);
  if (!live) redirect("/login?reason=access-changed");
  const user = { ...sessionUser, ...live };
  if (user.role !== "PLATFORM_ADMIN") notFound();
  if (!user.twoFactorConfirmed) await redirectToTwoFactorSetup();

  return { user, support: await getSupportLink() };
}

/**
 * The agency's white-label support link, shown in the sidebar's
 * "Need Support?" card at both levels.
 */
export async function getSupportLink(): Promise<SupportLink | null> {
  const agency = await rawDb.agencySettings.findFirst();
  if (!agency?.supportUrl) return null;
  return { label: agency.supportLabel ?? "Contact support", url: agency.supportUrl };
}

/**
 * Sends an account that still needs 2FA to set it up, carrying the page it
 * was actually trying to reach so the setup flow's "Continue" button can
 * send it straight back there instead of guessing a landing page.
 */
async function redirectToTwoFactorSetup(): Promise<never> {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const next = pathname && pathname !== "/account/two-factor" ? `&next=${encodeURIComponent(pathname)}` : "";
  redirect(`/account/two-factor?required=1${next}`);
}

export type { SidebarEntry };
