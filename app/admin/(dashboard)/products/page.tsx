import Link from "next/link";
import { requireStaffContext } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { Plus, Package } from "lucide-react";
import { NewProductCategoryForm, ArchiveProductButton, AdjustInventoryButton } from "./client";

export default async function AdminProductsPage() {
  const { db } = await requireStaffContext();

  const products = await db.product.findMany({
    where: { active: true },
    include: { category: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Products</h1>
          <p className="text-sm text-ink-muted">Manage retail products and inventory.</p>
        </div>
        <div className="flex gap-2">
          <NewProductCategoryForm />
          <Link href="/admin/products/new">
            <Button size="sm">
              <Plus className="h-4 w-4" /> New product
            </Button>
          </Link>
        </div>
      </div>

      {products.length === 0 ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title="No products yet" description="Add your first product to start selling." />
      ) : (
        <div className="space-y-2">
          {products.map((product) => (
            <Card key={product.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <Link href={`/admin/products/${product.id}/edit`} className="font-medium hover:underline">
                    {product.name}
                  </Link>
                  <p className="text-xs text-ink-subtle">
                    {product.category.name} · {product.sku} · {formatMoney(product.priceCents)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={product.inventoryQuantity > 0 ? "success" : "danger"}>
                    {product.inventoryQuantity} in stock
                  </Badge>
                  <AdjustInventoryButton productId={product.id} sku={product.sku} />
                  <ArchiveProductButton id={product.id} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
