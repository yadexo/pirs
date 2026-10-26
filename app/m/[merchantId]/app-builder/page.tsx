import Link from "next/link";
import { Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireMerchantContext } from "@/lib/merchant-context";
import { rawDb } from "@/lib/db";
import { MerchantPageHeader } from "@/components/merchant/page-header";
import { APP_BUILDER_TABS, DEFAULT_APP_BUILDER_TAB, isAppBuilderTab, isSettingsSection, DEFAULT_SETTINGS_SECTION } from "@/lib/nav";
import { CatalogTab, type CatalogItem } from "./catalog-tab";
import { SettingsTab } from "./settings-tab";
import { cn } from "@/lib/utils";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { formatMoney } from "@/lib/utils";
import { loadSettingsSection } from "./settings/load";
import { viewerCan } from "@/lib/viewer";
import type { MerchantRequirement } from "@/lib/merchant-action";
import type { SettingsSection } from "@/lib/nav";
import { defaultFilterFor } from "@/lib/app-builder-filters";

// lib/nav.ts's APP_BUILDER_TABS key → messages/*.json portal.appBuilder.tabs key.
// Same reasoning as components/shell/app-shell.tsx's MERCHANT_NAV_KEYS: the
// label in lib/nav.ts stays the stable English string tests/nav.test.ts
// checks; what a person sees is translated here, keyed by tab key.
const APP_BUILDER_TAB_KEYS: Record<string, string> = {
  "custom-plans": "customPlans",
  offers: "offers",
  products: "products",
  membership: "membership",
  rewards: "rewards",
  settings: "settings",
};

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
  const t = await getTranslations("portal.appBuilder");
  const tTabs = await getTranslations("portal.appBuilder.tabs");

  const tab = isAppBuilderTab(sp.tab) ? sp.tab : DEFAULT_APP_BUILDER_TAB;
  const section = isSettingsSection(sp.section) ? sp.section : DEFAULT_SETTINGS_SECTION;
  const q = sp.q ?? "";
  const typeFilter = sp.type ?? defaultFilterFor(tab);

  const merchant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { slug: true } });
  const branding = await ctx.db.tenantBranding.findFirst({ where: {} });
  const currency = branding?.currency ?? DEFAULT_CURRENCY;

  return (
    <div className="mx-auto max-w-[1180px]">
      <MerchantPageHeader title={t("title")} description={t("description")} />

      <div className="mt-5 flex items-end justify-between border-b border-border">
        <nav className="no-scrollbar flex gap-5 overflow-x-auto">
          {APP_BUILDER_TABS.map((tabItem) => (
            <Link
              key={tabItem.key}
              href={`/m/${merchantId}/app-builder?tab=${tabItem.key}`}
              className={cn(
                "-mb-px shrink-0 border-b-2 pb-2.5 text-[13px] transition-colors",
                tab === tabItem.key ? "border-primary font-medium text-primary" : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {tTabs(APP_BUILDER_TAB_KEYS[tabItem.key]!)}
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
            <Eye className="h-3.5 w-3.5" /> {t("viewApp")}
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
            items={await loadItems(ctx.db, tab, q, typeFilter, currency, await getTranslations("portal.appBuilder.catalogMeta"))}
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
  currency: string,
  tc: Awaited<ReturnType<typeof getTranslations>>,
): Promise<CatalogItem[]> {
  const nameFilter = q ? { name: { contains: q, mode: "insensitive" as const } } : {};

  if (tab === "custom-plans") {
    // Packages became Custom plans.
    const rows = await db.package.findMany({
      where: { archivedAt: null, ...nameFilter },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { customerPackages: true } },
        items: { select: { service: { select: { name: true, schedulingUrl: true } } } },
      },
    });
    return rows.map((r) => {
      const covered = r.items.map((i) => i.service).filter((s): s is NonNullable<typeof s> => !!s);
      const unbookable = covered.filter((s) => !s.schedulingUrl).length;
      return {
        kind: "package" as const,
        id: r.id,
        name: r.name,
        meta: [
          tc("sessions", { count: r.totalUses }),
          tc("perSession", { amount: formatMoney(Math.round(r.priceCents / Math.max(1, r.totalUses)), currency) }),
          r.expiryDays ? tc("validDays", { count: r.expiryDays }) : tc("noExpiry"),
          covered.length > 0 ? covered.map((s) => s.name).join(", ") : tc("coversNothingYet"),
          r.transferable ? tc("transferable") : null,
          r._count.customerPackages > 0 ? tc("sold", { count: r._count.customerPackages }) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        // A package whose treatments cannot be booked sells sessions a client
        // then cannot use without coming to the desk. Kept as the same
        // literal English as the products tab below (test-locked there) so
        // the badge reads identically everywhere it appears.
        warning: unbookable > 0 ? "Booking link missing" : undefined,
        priceCents: r.priceCents,
        active: r.active,
      };
    });
  }

  if (tab === "offers") {
    // Promotions and notification campaigns share this tab, split by filter.
    if (typeFilter === "campaigns") {
      const rows = await db.notificationCampaign.findMany({ where: nameFilter, orderBy: { createdAt: "desc" } });
      return rows.map((r) => ({ kind: "campaign", id: r.id, name: r.name, meta: `${r.channel} · ${r.status}`, priceCents: null, active: r.status !== "CANCELLED" }));
    }
    // An offer that has been used is hidden rather than deleted, so a clinic
    // needs to be able to leave those out of the list — or go and find one.
    const visibility = typeFilter === "visible" ? { active: true } : typeFilter === "hidden" ? { active: false } : {};
    const rows = await db.promotion.findMany({
      where: { ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}), ...visibility },
      orderBy: { startAt: "desc" },
      include: {
        // Whether clients have been told, shown on the row itself.
        campaigns: {
          where: { status: { in: ["SCHEDULED", "SENT"] } },
          orderBy: [{ sentAt: "desc" }, { scheduledAt: "desc" }],
          take: 1,
          select: { status: true, scheduledAt: true, sentAt: true, devicesReached: true, outcomeNote: true },
        },
      },
    });
    const now = Date.now();
    const shortDate = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { dateStyle: "medium" }) : "");
    return rows.map((r) => {
      const notice = r.campaigns[0];
      const notified = !notice
        ? tc("notNotified")
        : notice.status === "SCHEDULED"
          ? tc("notificationScheduledFor", { date: shortDate(notice.scheduledAt) })
          : tc("notifiedDevices", { count: notice.devicesReached });
      // Why the others missed out, so a bare zero is never the whole story.
      const why = notice?.outcomeNote ?? null;
      return {
        kind: "promotion",
        id: r.id,
        name: r.title,
        meta: [
          r.code ? tc("codeLabel", { code: r.code }) : tc("automatic"),
          r.endAt.getTime() < now ? tc("ended") : r.startAt.getTime() > now ? tc("scheduledLower") : null,
          notified,
          why,
        ]
          .filter(Boolean)
          .join(" · "),
        priceCents: null,
        active: r.active,
      };
    });
  }

  if (tab === "products") {
    // Services and Products are one catalogue, separated by a type filter.
    const [services, products] = await Promise.all([
      typeFilter === "product" ? [] : db.service.findMany({ where: { archivedAt: null, ...nameFilter }, orderBy: { name: "asc" } }),
      typeFilter === "service" ? [] : db.product.findMany({ where: { archivedAt: null, ...nameFilter }, orderBy: { name: "asc" } }),
    ]);
    return [
      ...services.map((s) => ({
        kind: "service" as const,
        id: s.id,
        name: s.name,
        meta: tc("treatmentMinutes", { count: s.durationMinutes }),
        // A treatment clients can buy but cannot book: worth saying on the row
        // rather than only inside the editor. This exact literal string is
        // asserted by tests/booking-links.test.ts — do not translate it.
        warning: s.schedulingUrl ? undefined : "Booking link missing",
        priceCents: s.priceCents,
        active: s.active,
      })),
      ...products.map((p) => ({
        kind: "product" as const,
        id: p.id,
        name: p.name,
        meta: tc("productInStock", { count: p.inventoryQuantity }),
        priceCents: p.priceCents,
        active: p.active,
      })),
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
      meta: `${r.billingFrequency === "MONTHLY" ? tc("monthly") : tc("yearly")} · ${tc("members", { count: r._count.customerMemberships })}`,
      priceCents: r.priceCents,
      active: r.active,
    }));
  }

  // rewards
  const rows = await db.loyaltyReward.findMany({ where: nameFilter, orderBy: { pointsCost: "asc" } });
  return rows.map((r) => ({ kind: "reward", id: r.id, name: r.name, meta: tc("points", { count: r.pointsCost }), priceCents: null, active: r.active }));
}
