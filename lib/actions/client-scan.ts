"use server";

import { requireCustomerContext } from "@/lib/rbac";
import { mintCheckinToken } from "@/lib/checkin-token";

/**
 * Issues the short-lived code shown on the client's Scan tab. Verification
 * lives in lib/checkin-token.ts, deliberately outside this module: everything
 * exported from a "use server" file is callable by anyone.
 */
export async function mintScanTokenAction(): Promise<string> {
  const { user } = await requireCustomerContext();
  return mintCheckinToken(user.tenantId!, user.customerProfileId!);
}
