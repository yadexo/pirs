import { NextResponse, type NextRequest } from "next/server";
import { ActionError, requireMerchantAction } from "@/lib/merchant-action";
import { searchClientsForCheckIn } from "@/lib/check-in";

/**
 * Type-ahead client search for the check-in drawer. A plain GET rather than a
 * server action: Next runs server actions one at a time, so a search per
 * keystroke queued up and the drawer sat on "Searching…". A request can be
 * cancelled when the next keystroke arrives.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  try {
    const { db } = await requireMerchantAction(merchantId, "customers.view");
    const results = await searchClientsForCheckIn(db, req.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    const message = err instanceof ActionError ? err.message : "Search failed. Try again.";
    return NextResponse.json({ error: message }, { status: err instanceof ActionError ? 403 : 500 });
  }
}
