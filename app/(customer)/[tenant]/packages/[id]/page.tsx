import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { AddToBasketButton } from "@/components/customer/add-to-basket-button";
import { addPackageToBasketAction } from "@/lib/actions/basket";
import { Check } from "lucide-react";

export default async function PackageDetailPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: tenantSlug, id } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const db = getTenantDb(tenant.id);
  const pkg = await db.package.findFirst({ where: { id, active: true }, include: { items: { include: { service: true } } } });
  if (!pkg) notFound();

  const session = await auth();
  const isAuthenticated = session?.user.role === "CUSTOMER" && session.user.tenantSlug === tenantSlug;

  return (
    <div className="space-y-4 py-4">
      <div>
        <h1 className="text-xl font-semibold">{pkg.name}</h1>
        <p className="mt-1 text-lg font-semibold">{formatMoney(pkg.priceCents)}</p>
        <p className="text-sm text-ink-muted">
          {pkg.totalUses} total uses{pkg.expiryDays ? ` · valid for ${pkg.expiryDays} days` : ""}
          {pkg.transferable ? " · transferable" : ""}
        </p>
      </div>

      {pkg.description && (
        <Card>
          <CardContent className="p-4 text-sm text-ink-muted">{pkg.description}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-medium">Included services</p>
          <ul className="space-y-1.5">
            {pkg.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm text-ink-muted">
                <Check className="h-4 w-4 text-success" /> {item.service.name}
                {item.quantity > 1 ? ` × ${item.quantity}` : ""}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <AddToBasketButton
        isAuthenticated={!!isAuthenticated}
        loginHref={`/${tenantSlug}/login?next=/${tenantSlug}/packages/${id}`}
        action={addPackageToBasketAction.bind(null, tenantSlug, pkg.id)}
      />
    </div>
  );
}
