import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { AddToBasketButton } from "@/components/customer/add-to-basket-button";
import { addProductToBasketAction } from "@/lib/actions/basket";

export default async function ProductDetailPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: tenantSlug, id } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const db = getTenantDb(tenant.id);
  const product = await db.product.findFirst({ where: { id, active: true } });
  if (!product) notFound();

  const images = Array.isArray(product.images) ? (product.images as string[]) : [];
  const session = await auth();
  const isAuthenticated = session?.user.role === "CUSTOMER" && session.user.tenantSlug === tenantSlug;

  return (
    <div className="space-y-4 py-4">
      {images[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={images[0]} alt={product.name} className="h-56 w-full rounded-lg object-cover" />
      )}
      <div>
        <h1 className="text-xl font-semibold">{product.name}</h1>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-lg font-semibold">{formatMoney(product.priceCents)}</span>
          <Badge tone={product.inventoryQuantity > 0 ? "success" : "danger"}>
            {product.inventoryQuantity > 0 ? "In stock" : "Out of stock"}
          </Badge>
        </div>
      </div>

      {product.description && (
        <Card>
          <CardContent className="p-4 text-sm text-ink-muted">{product.description}</CardContent>
        </Card>
      )}

      <AddToBasketButton
        isAuthenticated={!!isAuthenticated}
        loginHref={`/${tenantSlug}/login?next=/${tenantSlug}/products/${id}`}
        action={addProductToBasketAction.bind(null, tenantSlug, product.id, 1)}
      />
    </div>
  );
}
