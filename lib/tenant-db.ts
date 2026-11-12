import { Prisma } from "@prisma/client";
import { rawDb } from "./db";

/**
 * Models that carry a direct `tenantId` column. Every read/write made through
 * getTenantDb() is auto-scoped to one tenant for these models, so a missing
 * `where: { tenantId }` clause in application code cannot leak another
 * tenant's rows. Models are looked up by their Prisma model name (PascalCase).
 *
 * Join/child tables without their own tenantId (PackageItem, OrderItem,
 * BasketItem, MembershipBenefit, PromotionEligibility, RolePermission,
 * StaffLocation, StaffService) are intentionally excluded — they must always
 * be reached through their tenant-scoped parent relation.
 *
 * This list is an allowlist, which fails in the dangerous direction: a model
 * left off it is not an error anywhere, it is simply read across every clinic
 * by code that believes it is scoped. RedeemableItem was left off, and each
 * clinic's Shop page showed the last 25 collections on the whole platform —
 * other clinics' client names, notes and staff
 * (docs/security/review-2026-11.md, T-1). So the list is no longer trusted to
 * be kept by hand: tests/tenant-scoped-models.test.ts reads schema.prisma and
 * fails for any model that has a tenantId column and is not here.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  "TenantBranding",
  "TenantSettings",
  "Location",
  "User",
  "Role",
  "StaffProfile",
  "StaffAvailability",
  "BlockedTime",
  "CustomerProfile",
  "CustomerTag",
  "CatalogTag",
  "ClientResult",
  "CustomerNote",
  "Lead",
  "ServiceCategory",
  "Service",
  "ProductCategory",
  "Product",
  "InventoryTransaction",
  "Package",
  "CustomerPackage",
  "MembershipPlan",
  "CustomerMembership",
  "MembershipBillingEvent",
  "LoyaltyProgramme",
  "LoyaltyReward",
  "LoyaltyTransaction",
  "AccountCreditTransaction",
  "Promotion",
  "PromotionRedemption",
  "Basket",
  "Order",
  "Payment",
  "Refund",
  "Appointment",
  "Conversation",
  "Message",
  "Notification",
  "PushSubscription",
  "NotificationPromptEvent",
  "InstallPromptEvent",
  "NotificationCampaign",
  "ActivityEvent",
  "NotificationDelivery",
  "AuditLog",
  "RedeemableItem",
  "PriceHistory",
  "PackageSessionUse",
  "MembershipPriceChange",
  "BirthdayGreeting",
  "ClinicDomain",
]);

const READ_FILTER_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const WRITE_FILTER_OPS = new Set(["updateMany", "deleteMany"]);
const SINGLE_WRITE_OPS = new Set(["update", "delete", "upsert"]);

/**
 * Returns a Prisma client bound to exactly one tenant. Use this for every
 * staff/admin and customer request. Only platform-admin code paths (which
 * intentionally operate across tenants) should use the raw `rawDb` client.
 */
export function getTenantDb(tenantId: string) {
  return rawDb.$extends({
    name: `tenant-scope:${tenantId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const a = args as { where?: Record<string, unknown>; data?: unknown };

          if (READ_FILTER_OPS.has(operation) || WRITE_FILTER_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), tenantId };
          }

          if (SINGLE_WRITE_OPS.has(operation) && a.where) {
            a.where = { ...a.where, tenantId };
          }

          if (operation === "create") {
            const data = a.data as Record<string, unknown> | undefined;
            if (data && data.tenantId === undefined) {
              data.tenantId = tenantId;
            }
          }

          if (operation === "createMany") {
            const data = a.data;
            if (Array.isArray(data)) {
              for (const row of data as Record<string, unknown>[]) {
                if (row.tenantId === undefined) row.tenantId = tenantId;
              }
            }
          }

          if (operation === "upsert") {
            const upsertArgs = args as { create?: Record<string, unknown> };
            if (upsertArgs.create && upsertArgs.create.tenantId === undefined) {
              upsertArgs.create.tenantId = tenantId;
            }
          }

          // findUnique/findUniqueOrThrow cannot safely accept extra `where`
          // filters — by convention, tenant-scoped code must use
          // findFirst/findFirstOrThrow with the id in `where` instead.
          if (operation === "findUnique" || operation === "findUniqueOrThrow") {
            throw new Error(
              `Refusing to run unscoped ${operation} on tenant-scoped model "${model}". ` +
                `Use findFirst({ where: { id, tenantId } }) via getTenantDb() instead.`,
            );
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof getTenantDb>;

/** Explicit escape hatch for platform-admin code that must see all tenants. */
export function getPlatformDb() {
  return rawDb;
}

export { Prisma };
