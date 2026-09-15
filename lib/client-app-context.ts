import "server-only";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { loadLiveAccount } from "@/lib/live-account";
import { DEFAULT_CURRENCY } from "@/lib/currency";

export interface ClientAppMerchant {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  currency: string;
  contactPhone: string | null;
  addressLine1: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  supportUrl: string | null;
}

export interface ClientAppContext {
  merchant: ClientAppMerchant;
  db: TenantDb;
  /** Null when the visitor has not signed in yet — the shell renders onboarding instead. */
  customerProfileId: string | null;
  firstName: string | null;
}

/**
 * Resolves the merchant from the slug in the URL and, if present, the
 * signed-in client's own record — scoped by the same tenant-isolation
 * extension the dashboard uses. An unknown slug is a real 404, not a
 * redirect, so slug guessing can't be used to enumerate merchants.
 */
export async function getClientAppContext(merchantSlug: string): Promise<ClientAppContext> {
  const tenant = await rawDb.tenant.findUnique({
    where: { slug: merchantSlug },
    include: { branding: true },
  });
  if (!tenant || tenant.status !== "ACTIVE") notFound();

  const db = getTenantDb(tenant.id);
  const branding = tenant.branding;

  const merchant: ClientAppMerchant = {
    id: tenant.id,
    slug: tenant.slug,
    name: branding?.businessName ?? tenant.name,
    logoUrl: branding?.logoUrl ?? null,
    accentColor: branding?.primaryColor ?? null,
    currency: branding?.currency ?? DEFAULT_CURRENCY,
    contactPhone: branding?.contactPhone ?? null,
    addressLine1: branding?.addressLine1 ?? null,
    city: branding?.city ?? null,
    latitude: null,
    longitude: null,
    supportUrl: null,
  };

  // Support link falls back to the agency's white-label setting, so a merchant
  // that hasn't set one still gives clients somewhere to go.
  const agency = await rawDb.agencySettings.findFirst({ select: { supportUrl: true } });
  merchant.supportUrl = agency?.supportUrl ?? null;

  const session = await auth();
  const user = session?.user;
  // A closed account's session must not keep showing its data.
  const live = user ? await loadLiveAccount(user.id, user.authTime) : null;
  const isThisMerchantsCustomer =
    live?.role === "CUSTOMER" && live.tenantId === tenant.id && user?.tenantSlug === merchantSlug && !!user.customerProfileId;

  return {
    merchant,
    db,
    customerProfileId: isThisMerchantsCustomer ? user!.customerProfileId! : null,
    firstName: null,
  };
}
