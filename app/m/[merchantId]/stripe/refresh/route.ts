import type { NextRequest } from "next/server";
import { handleRefresh } from "@/lib/stripe-connect-http";

/** See handleRefresh in lib/stripe-connect-http.ts. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  return handleRefresh(req, (await params).merchantId);
}
