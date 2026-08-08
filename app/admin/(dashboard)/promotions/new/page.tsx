import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { PromotionForm } from "./promotion-form";

export default async function NewPromotionPage() {
  await requirePermission("promotions.create");
  const { db } = await requireStaffContext();

  const [services, products, packages] = await Promise.all([
    db.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.package.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">New promotion</h1>
      <PromotionForm services={services} products={products} packages={packages} />
    </div>
  );
}
