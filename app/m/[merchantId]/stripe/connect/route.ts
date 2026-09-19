import type { NextRequest } from "next/server";
import { handleConnect } from "@/lib/stripe-connect-http";

/** See handleConnect in lib/stripe-connect-http.ts. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  return handleConnect(req, (await params).merchantId);
}
