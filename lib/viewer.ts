import type { MerchantRequirement } from "@/lib/merchant-action";
import type { LiveAccount } from "@/lib/live-account";

/**
 * The same rule as requireMerchantAction, for deciding what to show. Showing
 * is a courtesy only — every save is still authorised on the server.
 */
export function viewerCan(viewer: { role: LiveAccount["role"]; permissions: LiveAccount["permissions"] }, need: MerchantRequirement): boolean {
  if (viewer.role === "PLATFORM_ADMIN" || viewer.role === "TENANT_ADMIN") return true;
  if (viewer.role !== "STAFF" || need === "owner") return false;
  if (need === "member") return true;
  return viewer.permissions === "ALL" || viewer.permissions.includes(need);
}
