import { NextResponse } from "next/server";
import { clinicHostMap } from "@/lib/clinic-hosts";

export const dynamic = "force-dynamic";

/**
 * The host -> clinic map, for the middleware.
 *
 * It exists only because middleware runs on the Edge runtime, where Prisma
 * cannot: this is the Node side of that fence. The middleware fetches it and
 * caches the answer for a minute (see middleware.ts), so this is called about
 * once a minute per running instance, not once a request.
 *
 * Not authenticated, deliberately. Everything in it is already public: each
 * host resolves in DNS and serves that clinic's branded app, and the
 * certificates are in the public transparency logs. A secret here would buy
 * nothing and would add a way for the whole feature to break quietly if it
 * were ever unset. What it does do is stay minimal — hosts and slugs, no
 * names, no counts, nothing about the clinics themselves.
 */
export async function GET() {
  const map = await clinicHostMap();
  return NextResponse.json(map, {
    // The middleware does the caching, with a TTL it controls. Anything in
    // between holding a copy would only make a removed domain outlive its row.
    headers: { "Cache-Control": "no-store" },
  });
}
