import "server-only";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
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
  const user = session?.user;
  if (!user) redirect("/login");

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
    db: getTenantDb(merchantId),
    impersonating,
    switchableMerchants,
    support,
  };
}

/** Agency-level guard for /agency/*. Merchant users get a 404, never a redirect loop. */
export async function requireAgencyContext() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect("/login");
  if (user.role !== "PLATFORM_ADMIN") notFound();

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

export type { SidebarEntry };
