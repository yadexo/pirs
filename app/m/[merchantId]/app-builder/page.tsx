import Link from "next/link";
import { Eye } from "lucide-react";
import { requireMerchantContext } from "@/lib/merchant-context";
import { rawDb } from "@/lib/db";
import { MerchantPageHeader } from "@/components/merchant/page-header";
import { APP_BUILDER_TABS, DEFAULT_APP_BUILDER_TAB, isAppBuilderTab, isSettingsSection, DEFAULT_SETTINGS_SECTION } from "@/lib/nav";
import { CatalogTab, type CatalogItem } from "./catalog-tab";
import { SettingsTab } from "./settings-tab";
import { cn } from "@/lib/utils";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { loadSettingsSection } from "./settings/load";
import { viewerCan } from "@/lib/viewer";
import type { MerchantRequirement } from "@/lib/merchant-action";
import type { SettingsSection } from "@/lib/nav";

/** What saving each Settings section requires — mirrors lib/actions/clinic-settings.ts. */
const SECTION_NEEDS: Record<SettingsSection, MerchantRequirement> = {
  general: "owner",
  branding: "owner",
  team: "owner",
  locations: "owner",
  "loyalty-rules": "loyalty.adjust",
  booking: "appointments.manage",
  notifications: "owner",
  integrations: "owner",
  "audit-log": "owner",
};

export default async function AppBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>;
  searchParams: Promise<{ tab?: string; section?: string; q?: string; type?: string; stripe?: string }>;
}) {
  const { merchantId } = await params;
  const sp = await searchParams;
  const ctx = await requireMerchantContext(merchantId);

  const tab = isAppBuilderTab(sp.tab) ? sp.tab : DEFAULT_APP_BUILDER_TAB;
  const section = isSettingsSection(sp.section) ? sp.section : DEFAULT_SETTINGS_SECTION;
  const q = sp.q ?? "";
  const typeFilter = sp.type ?? "all";

  const merchant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { slug: true } });
  const branding = await ctx.db.tenantBranding.findFirst({ where: {} });
  const currency = branding?.currency ?? DEFAULT_CURRENCY;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <MerchantPageHeader title="App Builder" merchantName={ctx.merchantName} />

      <div className="mt-5 flex items-end justify-between border-b border-border">
        <nav className="no-scrollbar flex gap-5 overflow-x-auto">
          {APP_BUILDER_TABS.map((t) => (
            <Link
              key={t.key}
              href={`/m/${merchantId}/app-builder?tab=${t.key}`}
              className={cn(
                "-mb-px shrink-0 border-b-2 pb-2.5 text-[13px] transition-colors",
                tab === t.key ? "border-primary font-medium text-primary" : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {merchant && (
          <a
            href={`/app/${merchant.slug}`}
            target="_blank"
            rel="noreferrer"
            className="mb-2 flex shrink-0 items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
          >
            <Eye className="h-3.5 w-3.5" /> View app
          </a>
        )}
      </div>

      <div className="mt-4">
        {tab === "settings" ? (
          <SettingsTab
            merchantId={merchantId}
            section={section}
            currency={currency}
            data={await loadSettingsSection(ctx.db, merchantId, section)}
            canEdit={viewerCan(ctx.viewer, SECTION_NEEDS[section])}
            isOwner={ctx.viewer.role === "TENANT_ADMIN"}
            stripeNotice={sp.stripe ?? null}
          />
        ) : (
          <CatalogTab
            merchantId={merchantId}
            tab={tab}
            q={q}
            typeFilter={typeFilter}
            currency={currency}
            items={await loadItems(ctx.db, tab, q, typeFilter)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Each tab reads from the model that concept was relocated onto. Hidden items
 * are listed (so they can be shown again); archived items are not.
 */
async function loadItems(
  db: Awaited<ReturnType<typeof requireMerchantContext>>["db"],
  tab: string,
  q: string,
  typeFilter: string,
): Promise<CatalogItem[]> {
  const nameFilter = q ? { name: { contains: q, mode: "insensitive" as const } } : {};

  if (tab === "custom-plans") {
    // Packages became Custom plans.
    const rows = await db.package.findMany({ where: { archivedAt: null, ...nameFilter }, orderBy: { name: "asc" } });
    return rows.map((r) => ({ kind: "package", id: r.id, name: r.name, meta: `${r.totalUses} sessions`, priceCents: r.priceCents, active: r.active }));
  }

  if (tab === "offers") {
    // Promotions and notification campaigns share this tab, split by filter.
    if (typeFilter === "campaigns") {
      const rows = await db.notificationCampaign.findMany({ where: nameFilter, orderBy: { createdAt: "desc" } });
      return rows.map((r) => ({ kind: "campaign", id: r.id, name: r.name, meta: `${r.channel} · ${r.status}`, priceCents: null, active: r.status !== "CANCELLED" }));
    }
    const rows = await db.promotion.findMany({
      where: q ? { title: { contains: q, mode: "insensitive" } } : {},
      orderBy: { startAt: "desc" },
    });
    const now = Date.now();
    return rows.map((r) => ({
      kind: "promotion",
      id: r.id,
      name: r.title,
      meta: [r.code ? `Code ${r.code}` : "Automatic", r.endAt.getTime() < now ? "ended" : r.startAt.getTime() > now ? "scheduled" : null]
        .filter(Boolean)
        .join(" · "),
      priceCents: null,
      active: r.active,
    }));
  }

  if (tab === "products") {
    // Services and Products are one catalogue, separated by a type filter.
    const [services, products] = await Promise.all([
      typeFilter === "product" ? [] : db.service.findMany({ where: { archivedAt: null, ...nameFilter }, orderBy: { name: "asc" } }),
      typeFilter === "service" ? [] : db.product.findMany({ where: { archivedAt: null, ...nameFilter }, orderBy: { name: "asc" } }),
    ]);
    return [
      ...services.map((s) => ({ kind: "service" as const, id: s.id, name: s.name, meta: `Treatment · ${s.durationMinutes} min`, priceCents: s.priceCents, active: s.active })),
      ...products.map((p) => ({ kind: "product" as const, id: p.id, name: p.name, meta: `Product · ${p.inventoryQuantity} in stock`, priceCents: p.priceCents, active: p.active })),
    ];
  }

  if (tab === "membership") {
    const rows = await db.membershipPlan.findMany({
      where: { archivedAt: null, ...nameFilter },
      orderBy: { priceCents: "asc" },
      include: { _count: { select: { customerMemberships: { where: { status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "PAUSED"] } } } } } },
    });
    return rows.map((r) => ({
      kind: "membershipPlan",
      id: r.id,
      name: r.name,
      meta: `${r.billingFrequency === "MONTHLY" ? "Monthly" : "Yearly"} · ${r._count.customerMemberships} member${r._count.customerMemberships === 1 ? "" : "s"}`,
      priceCents: r.priceCents,
      active: r.active,
    }));
  }

  // rewards
  const rows = await db.loyaltyReward.findMany({ where: nameFilter, orderBy: { pointsCost: "asc" } });
  return rows.map((r) => ({ kind: "reward", id: r.id, name: r.name, meta: `${r.pointsCost} points`, priceCents: null, active: r.active }));
}
