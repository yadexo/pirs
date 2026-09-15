import { NextResponse } from "next/server";
import { rawDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + database readiness for uptime monitors and load balancers.
 * Deliberately reveals nothing beyond up/down — no versions, hosts or errors.
 */
export async function GET() {
  try {
    await rawDb.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
