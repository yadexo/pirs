"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { searchListedClinics, type ListedClinic } from "@/lib/clinic-directory";

/** Public: anyone may look for their clinic. Rate limited per address. */
export async function findClinicsAction(query: string): Promise<{ results: ListedClinic[] } | { error: string }> {
  if (typeof query !== "string" || query.length > 100) return { results: [] };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const { ok } = await rateLimit(`clinic-search:${ip}`, 60, 60_000);
  if (!ok) return { error: "Too many searches. Wait a minute and try again." };
  return { results: await searchListedClinics(query) };
}
