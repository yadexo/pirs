import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCustomerContext } from "@/lib/rbac";
import { getTenantBySlug } from "@/lib/tenant";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";
import { ShoppingBag } from "lucide-react";
import { BasketItemRow, CheckoutCta } from "./basket-client";

export default async function BasketPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const basket = await db.basket.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: "OPEN" },
    include: { items: { include: { service: true, product: true, package: true } } },
  });

  const items = basket?.items ?? [];
  const subtotal = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Your basket</h1>

      {items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Your basket is empty"
          description="Browse services, products, or packages to get started."
          action={
            <Link href={`/${tenantSlug}/services`}>
              <Button size="sm">Browse services</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-4">
              {items.map((item) => (
                <BasketItemRow
                  key={item.id}
                  tenantSlug={tenantSlug}
                  item={{
                    id: item.id,
                    name: item.service?.name ?? item.product?.name ?? item.package?.name ?? "Item",
                    quantity: item.quantity,
                    unitPriceCents: item.unitPriceCents,
                  }}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <p className="text-sm text-ink-muted">Subtotal</p>
              <p className="text-lg font-semibold">{formatMoney(subtotal)}</p>
            </CardContent>
          </Card>

          <CheckoutCta tenantSlug={tenantSlug} />
        </>
      )}
    </div>
  );
}
