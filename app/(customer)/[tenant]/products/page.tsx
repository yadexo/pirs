import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { Package } from "lucide-react";

export default async function ProductsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const db = getTenantDb(tenant.id);
  const products = await db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Products</h1>
      {products.length === 0 ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title="No products available" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {products.map((product) => {
            const images = Array.isArray(product.images) ? (product.images as string[]) : [];
            return (
              <Link key={product.id} href={`/${tenantSlug}/products/${product.id}`}>
                <Card className="h-full transition-shadow hover:shadow-raised">
                  {images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={images[0]} alt={product.name} className="h-32 w-full rounded-t-lg object-cover" />
                  )}
                  <CardContent className="p-4">
                    <p className="font-medium">{product.name}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-ink-muted">
                        {product.inventoryQuantity > 0 ? "In stock" : "Out of stock"}
                      </span>
                      <span className="font-semibold">{formatMoney(product.priceCents)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
