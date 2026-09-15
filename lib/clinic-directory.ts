import "server-only";
import { rawDb } from "@/lib/db";

export interface ListedClinic {
  slug: string;
  name: string;
  city: string | null;
  logoUrl: string | null;
}

/**
 * Clinic search for the general client app. Returns only active clinics that
 * opted in to being listed; the rest are reachable by their own link or QR.
 */
export async function searchListedClinics(query: string): Promise<ListedClinic[]> {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0).slice(0, 5);
  if (words.join("").length < 2) return [];
  const rows = await rawDb.tenant.findMany({
    where: {
      status: "ACTIVE",
      subscriptionStatus: { not: "CANCELLED" },
      settings: { publiclyListed: true },
      AND: words.map((w) => ({
        OR: [
          { name: { contains: w, mode: "insensitive" as const } },
          { branding: { businessName: { contains: w, mode: "insensitive" as const } } },
          { branding: { city: { contains: w, mode: "insensitive" as const } } },
        ],
      })),
    },
    take: 10,
    orderBy: { name: "asc" },
    select: { slug: true, name: true, branding: { select: { businessName: true, city: true, logoUrl: true } } },
  });
  return rows.map((r) => ({ slug: r.slug, name: r.branding?.businessName ?? r.name, city: r.branding?.city ?? null, logoUrl: r.branding?.logoUrl ?? null }));
}
