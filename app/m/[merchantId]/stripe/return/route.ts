import type { NextRequest } from "next/server";
import { handleReturn } from "@/lib/stripe-connect-http";

/** See handleReturn in lib/stripe-connect-http.ts. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  return handleReturn(req, (await params).merchantId);
}
