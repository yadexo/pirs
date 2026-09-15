import "server-only";
import { rawDb } from "@/lib/db";
import type { TenantDb } from "@/lib/tenant-db";
import type { SettingsSection } from "@/lib/nav";
import { PERMISSIONS } from "@/lib/permissions";
import { clinicJoinUrl } from "@/lib/app-url";
import { qrSvg } from "@/lib/qr";

/**
 * Loads only what the open Settings section needs. Everything crossing to the
 * client is plain JSON (dates as ISO strings).
 */
export async function loadSettingsSection(db: TenantDb, merchantId: string, section: SettingsSection) {
  const plain = <T>(v: T) => JSON.parse(JSON.stringify(v)) as T;

  switch (section) {
    case "general": {
      const [settings, branding, tenant] = await Promise.all([
        db.tenantSettings.findFirst({ where: {} }),
        db.tenantBranding.findFirst({ where: {} }),
        rawDb.tenant.findUniqueOrThrow({ where: { id: merchantId }, select: { slug: true } }),
      ]);
      const joinUrl = clinicJoinUrl(tenant.slug);
      return plain({ section, settings, branding, appLink: { url: joinUrl, qrSvg: qrSvg(joinUrl, { margin: 2 }) } });
    }
    case "branding": {
      const branding = await db.tenantBranding.findFirst({ where: {} });
      const hasPayments = (await db.order.count({ where: { status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"] } } })) + (await db.customerMembership.count({ where: {} })) > 0;
      // Built here, from the same Intl data the server validates against, so the
      // browser can't offer a value the save would reject (and SSR and client agree).
      const common = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CAD", "AUD"];
      const currencies = [...common, ...Intl.supportedValuesOf("currency").filter((c) => !common.includes(c))];
      const timeZones = Intl.supportedValuesOf("timeZone");
      return plain({ section, branding, currencyLocked: hasPayments, currencies, timeZones });
    }
    case "team": {
      const [users, roles] = await Promise.all([
        rawDb.user.findMany({
          where: { tenantId: merchantId, role: { in: ["TENANT_ADMIN", "STAFF"] } },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            lastLoginAt: true,
            staffProfile: { select: { id: true, firstName: true, lastName: true, title: true, active: true, roleId: true } },
          },
        }),
        db.role.findMany({
          orderBy: { name: "asc" },
          include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { staffProfiles: true } } },
        }),
      ]);
      return plain({
        section,
        users,
        roles: roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions.map((p) => p.permission.key), members: r._count.staffProfiles })),
        allPermissions: PERMISSIONS.map((p) => ({ key: p.key, label: p.label, category: p.category })),
      });
    }
    case "locations": {
      const locations = await db.location.findMany({ where: { active: true }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] });
      return plain({ section, locations });
    }
    case "loyalty-rules": {
      const [programme, settings] = await Promise.all([db.loyaltyProgramme.findFirst({ where: {} }), db.tenantSettings.findFirst({ where: {} })]);
      return plain({ section, programme, googleReviewUrl: settings?.googleReviewUrl ?? null });
    }
    case "booking": {
      const settings = await db.tenantSettings.findFirst({ where: {} });
      return plain({ section, settings });
    }
    case "notifications": {
      const settings = await db.tenantSettings.findFirst({ where: {} });
      return plain({ section, settings });
    }
    case "integrations": {
      return {
        section,
        payments: process.env.PAYMENT_PROVIDER === "stripe" ? ("stripe" as const) : ("test" as const),
        email: process.env.EMAIL_PROVIDER === "resend" && process.env.RESEND_API_KEY ? ("resend" as const) : ("not-configured" as const),
        push: process.env.PUSH_PROVIDER === "webpush" ? ("webpush" as const) : ("not-configured" as const),
      };
    }
    case "audit-log": {
      const rows = await rawDb.auditLog.findMany({
        where: { tenantId: merchantId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, action: true, entityType: true, actorType: true, createdAt: true, reason: true, actorUser: { select: { email: true } } },
      });
      return plain({ section, rows });
    }
  }
}

export type SettingsData = Awaited<ReturnType<typeof loadSettingsSection>>;
