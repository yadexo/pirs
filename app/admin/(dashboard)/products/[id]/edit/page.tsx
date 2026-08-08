import { notFound } from "next/navigation";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { updateProductAction } from "@/lib/actions/catalog";
import { ProductForm } from "../../product-form";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const { db } = await requireStaffContext();
  const { id } = await params;

  const [product, categories] = await Promise.all([
    db.product.findFirst({ where: { id } }),
    db.productCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!product) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Edit product</h1>
      <ProductForm categories={categories} product={product} action={updateProductAction.bind(null, id)} />
    </div>
  );
}
