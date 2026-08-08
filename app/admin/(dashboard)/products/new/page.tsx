import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { createProductAction } from "@/lib/actions/catalog";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  await requirePermission("sales.manage");
  const { db } = await requireStaffContext();
  const categories = await db.productCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">New product</h1>
      <ProductForm categories={categories} action={createProductAction} />
    </div>
  );
}
