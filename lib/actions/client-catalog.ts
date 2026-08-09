"use server";

import { requireCustomerContext } from "@/lib/rbac";

export interface CatalogSearchResult {
  id: string;
  name: string;
  type: "Treatment" | "Product" | "Membership";
}

export async function searchCatalogAction(q: string): Promise<CatalogSearchResult[]> {
  const { db } = await requireCustomerContext();
  const filter = { name: { contains: q, mode: "insensitive" as const } };

  const [services, products, plans] = await Promise.all([
    db.service.findMany({ where: { active: true, ...filter }, take: 5, select: { id: true, name: true } }),
    db.product.findMany({ where: { active: true, ...filter }, take: 5, select: { id: true, name: true } }),
    db.membershipPlan.findMany({ where: { active: true, name: { contains: q, mode: "insensitive" } }, take: 5, select: { id: true, name: true } }),
  ]);

  return [
    ...services.map((s) => ({ id: s.id, name: s.name, type: "Treatment" as const })),
    ...products.map((p) => ({ id: p.id, name: p.name, type: "Product" as const })),
    ...plans.map((m) => ({ id: m.id, name: m.name, type: "Membership" as const })),
  ];
}
