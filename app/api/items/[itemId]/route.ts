import { NextResponse } from "next/server";
import { requireCustomerContext } from "@/lib/rbac";
import { rawDb } from "@/lib/db";

/**
 * The status of one of the signed-in client's own items.
 *
 * The app asks for this every few seconds while a code is on screen, so the
 * client sees "Redeemed" the moment the clinic scans it instead of holding up
 * a code that no longer works. It answers with a status and nothing else —
 * never the token, so this cannot be used to fetch a code.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user } = await requireCustomerContext();
  const { itemId } = await params;

  // Scoped to the caller's own clinic and their own customer record: another
  // client's item is simply not found.
  const item = await rawDb.redeemableItem.findFirst({
    where: { id: itemId, tenantId: user.tenantId!, customerProfileId: user.customerProfileId! },
    select: { status: true, redeemedAt: true },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(
    { status: item.status, redeemedAt: item.redeemedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
